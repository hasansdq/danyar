import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requireSchoolAdmin } from '@/lib/api-auth'
import { attendanceEnabled } from '@/lib/attendance-access'
import { buildAttendanceReport } from '@/lib/attendance-report'
import { isValidDateKey } from '@/lib/jalali'

/**
 * GET /api/attendance/report — گزارش و آمار حضور و غیاب مدرسه (فقط مدیر مدرسه)
 * فیلترها: ?classroomId= &teacherId= (ثبت‌کننده) &studentId= &from= &to= &status=
 * وضعیت PRESENT/ABSENT/UNSET — «ثبت‌نشده» جدا از غیبت و در آمار غایب حساب نمی‌شود.
 * جلسات پیش‌نویس در گزارش و آمار محاسبه نمی‌شوند.
 */
export async function GET(req: NextRequest) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const session = res.session

  const enabled = await attendanceEnabled(session.schoolId)
  if (!enabled) return jsonError('حضور و غیاب برای این مدرسه غیرفعال است', 403)

  const sp = req.nextUrl.searchParams
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  const status = sp.get('status') ?? ''
  if (from && !isValidDateKey(from)) return jsonError('تاریخ «از» نامعتبر است', 400)
  if (to && !isValidDateKey(to)) return jsonError('تاریخ «تا» نامعتبر است', 400)
  if (status && !['PRESENT', 'ABSENT', 'UNSET'].includes(status)) {
    return jsonError('وضعیت فیلتر نامعتبر است', 400)
  }

  const report = await buildAttendanceReport(session.schoolId, {
    classroomId: sp.get('classroomId') ?? undefined,
    teacherId: sp.get('teacherId') ?? undefined,
    studentId: sp.get('studentId') ?? undefined,
    from: from || undefined,
    to: to || undefined,
    status: status || undefined,
  })

  return NextResponse.json(report)
}
