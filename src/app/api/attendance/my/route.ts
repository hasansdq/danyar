import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import { attendanceEnabled } from '@/lib/attendance-access'
import { isValidDateKey } from '@/lib/jalali'

/**
 * GET /api/attendance/my — «حضور و غیاب من» (فقط دانش‌آموز)
 * فقط سوابق «نهایی‌شده» خود دانش‌آموز؛ جلسات پیش‌نویس هرگز نمایش داده نمی‌شوند
 * و دانش‌آموز به هیچ اطلاعات دانش‌آموز دیگری دسترسی ندارد.
 * فیلتر اختیاری: ?from= &to= (کلید تاریخ جلالی)
 */
export async function GET(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role !== 'STUDENT') {
    return jsonError('این بخش مخصوص دانش‌آموزان است', 403)
  }

  const enabled = session.schoolId ? await attendanceEnabled(session.schoolId) : false
  if (!enabled) return jsonError('حضور و غیاب برای این مدرسه غیرفعال است', 403)

  const sp = req.nextUrl.searchParams
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  if (from && !isValidDateKey(from)) return jsonError('تاریخ «از» نامعتبر است', 400)
  if (to && !isValidDateKey(to)) return jsonError('تاریخ «تا» نامعتبر است', 400)

  // فقط کلاس‌هایی که دانش‌آموز واقعاً در آن‌ها ثبت‌نام دارد
  // (از/تا در یک فیلتر dateKey ادغام می‌شوند — دو کلید هم‌نام spread، «از» را بازنویسی می‌کند)
  const records = await db.attendanceRecord.findMany({
    where: {
      studentId: session.uid,
      session: {
        status: 'FINALIZED',
        classroom: { schoolId: session.schoolId },
        ...((from || to)
          ? { dateKey: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
    },
    include: {
      session: {
        include: {
          classroom: { select: { id: true, name: true } },
          creator: { select: { id: true, fullName: true } },
        },
      },
    },
    orderBy: { session: { dateKey: 'desc' } },
  })

  const rows = records.map((r) => ({
    sessionId: r.session.id,
    dateKey: r.session.dateKey,
    title: r.session.title,
    classroomName: r.session.classroom.name,
    status: r.status,
    note: r.note,
    finalizedAt: r.session.finalizedAt,
    // ثبت‌کنندهٔ جلسه (درخواست کاربر: دانش‌آموز لیست غیبت‌ها را با ثبت‌کننده ببیند)
    creatorName: r.session.creator?.fullName ?? '—',
  }))

  // تخلفات ثبت‌شدهٔ این دانش‌آموز (درخواست کاربر — نمایش در «حضور و غیاب من»)
  const violations = await db.studentViolation.findMany({
    where: {
      studentId: session.uid,
      classroom: { schoolId: session.schoolId },
      ...((from || to)
        ? { dateKey: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    include: {
      creator: { select: { fullName: true } },
      classroom: { select: { name: true } },
    },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
  })

  // نمرات ثبت‌شدهٔ این دانش‌آموز (درخواست کاربر — تب «نمره‌ها» در گزارش کار):
  // فقط نمرات جلسات نهایی‌شده + نمرات بدون جلسه (اگر جلسه حذف شده باشد)
  const grades = await db.studentGrade.findMany({
    where: {
      studentId: session.uid,
      classroom: { schoolId: session.schoolId },
      OR: [{ session: { status: 'FINALIZED' } }, { sessionId: null }],
      ...((from || to)
        ? { dateKey: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    include: {
      creator: { select: { id: true, fullName: true } },
      classroom: { select: { name: true } },
      lesson: { select: { id: true, name: true } },
    },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
  })

  const present = records.filter((r) => r.status === 'PRESENT').length
  const absent = records.filter((r) => r.status === 'ABSENT').length

  return NextResponse.json({
    records: rows,
    violations: violations.map((v) => ({
      id: v.id,
      dateKey: v.dateKey,
      classroomName: v.classroom.name,
      text: v.text,
      creatorName: v.creator?.fullName ?? '—',
      createdAt: v.createdAt,
    })),
    // نمرات — عنوان نمره، خود نمره، معلم (ثبت‌کننده)، درس و تاریخ (درخواست کاربر)
    grades: grades.map((g) => ({
      id: g.id,
      dateKey: g.dateKey,
      classroomName: g.classroom.name,
      title: g.title,
      lessonName: g.lesson?.name ?? null,
      score: g.score,
      teacherName: g.creator?.fullName ?? '—',
      createdAt: g.createdAt,
    })),
    stats: {
      total: records.length,
      present,
      absent,
      violations: violations.length,
      grades: grades.length,
    },
  })
}
