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
  }))

  const present = records.filter((r) => r.status === 'PRESENT').length
  const absent = records.filter((r) => r.status === 'ABSENT').length

  return NextResponse.json({
    records: rows,
    stats: { total: records.length, present, absent },
  })
}
