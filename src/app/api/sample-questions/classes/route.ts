import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import { sampleQEnabled, teacherAllowedClassrooms } from '@/lib/sampleq-access'

/**
 * GET /api/sample-questions/classes — منابع لازم فرم نمونه‌سؤال بر اساس نقش:
 * - معلم: فقط کلاس‌های مجاز خودش + گروه‌های درسی همان کلاس‌ها (برای «ارسال پیام به گروه»)
 * - مدیر مدرسه: همه کلاس‌ها و گروه‌های مدرسه (برای فیلتر و مشاهده)
 * - دانش‌آموز: مجاز نیست (403)
 */
export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role === 'STUDENT') {
    return jsonError('دانش‌آموز به این بخش دسترسی ندارد', 403)
  }

  const enabled = await sampleQEnabled(session.schoolId)
  if (!enabled) return jsonError('نمونه‌سؤالات برای این مدرسه غیرفعال است', 403)

  if (session.role === 'TEACHER') {
    const classrooms = await teacherAllowedClassrooms(session.uid, session.schoolId)
    const ids = classrooms.map((c) => c.id)
    const groups = ids.length
      ? await db.subjectGroup.findMany({
          where: { classroomId: { in: ids }, archivedAt: null },
          select: {
            id: true,
            name: true,
            classroomId: true,
            classroom: { select: { name: true } },
          },
          orderBy: { name: 'asc' },
        })
      : []
    return NextResponse.json({
      classrooms,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        classroomId: g.classroomId,
        classroomName: g.classroom?.name ?? '',
      })),
    })
  }

  // مدیر مدرسه: همه کلاس‌ها و گروه‌های مدرسه خودش
  const classrooms = await db.classroom.findMany({
    where: { schoolId: session.schoolId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      _count: {
        select: { enrollments: { where: { student: { isActive: true } } } },
      },
    },
  })
  const groups = await db.subjectGroup.findMany({
    where: { classroom: { schoolId: session.schoolId } },
    select: {
      id: true,
      name: true,
      classroomId: true,
      archivedAt: true,
      classroom: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({
    classrooms: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      studentCount: c._count.enrollments,
    })),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      classroomId: g.classroomId,
      classroomName: g.classroom?.name ?? '',
      archived: !!g.archivedAt,
    })),
  })
}
