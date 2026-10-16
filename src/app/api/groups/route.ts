import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolAdmin, jsonError } from '@/lib/api-auth'

/** فهرست همه گروه‌های درسی مدرسه (برای تب مجزای «گروه‌های درسی» پنل مدیر) */
export async function GET() {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response

  const groups = await db.subjectGroup.findMany({
    where: { classroom: { schoolId: res.session.schoolId } },
    orderBy: [{ classroom: { name: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      archivedAt: true,
      lockedForStudents: true,
      classroomId: true,
      classroom: { select: { id: true, name: true } },
      _count: { select: { assignments: true, memberOverrides: true, messages: true } },
    },
  })

  return NextResponse.json({ groups })
}

/** ایجاد گروه درسی برای یک کلاس — با عضوگیری خودکار دانش‌آموزان کلاس + انتساب معلمان */
export async function POST(req: NextRequest) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const classroomId = String(body?.classroomId ?? '')

  if (name.length < 2) return jsonError('نام گروه باید حداقل ۲ کاراکتر باشد')

  const classroom = await db.classroom.findFirst({
    where: { id: classroomId, schoolId: res.session.schoolId },
  })
  if (!classroom) return jsonError('کلاس یافت نشد', 404)

  const duplicate = await db.subjectGroup.findFirst({
    where: { classroomId, name },
  })
  if (duplicate) return jsonError('گروهی با این نام در این کلاس وجود دارد', 409)

  // معلمان گروه (چندانتخابی) — همه باید معلم فعال همین مدرسه باشند
  const rawTeacherIds: unknown[] = Array.isArray(body?.teacherIds) ? body.teacherIds : []
  const teacherIds: string[] = [
    ...new Set(rawTeacherIds.map((v) => String(v)).filter(Boolean)),
  ]
  if (teacherIds.length) {
    const validTeachers = await db.user.findMany({
      where: { id: { in: teacherIds }, schoolId: res.session.schoolId, role: 'TEACHER', isActive: true },
      select: { id: true },
    })
    if (validTeachers.length !== teacherIds.length) {
      return jsonError('یکی از معلمان انتخابی در این مدرسه یافت نشد', 400)
    }
  }

  const group = await db.subjectGroup.create({
    data: {
      name,
      classroomId,
      // انتساب معلمان انتخابی — دانش‌آموزان کلاس با ثبت‌نام خودکار عضو می‌شوند
      // و مدیر مدرسه هم به‌عنوان ستاد خودکار عضو است
      ...(teacherIds.length
        ? { teachingAssignments: { create: teacherIds.map((teacherId) => ({ teacherId })) } }
        : {}),
    },
  })
  return NextResponse.json({ group }, { status: 201 })
}
