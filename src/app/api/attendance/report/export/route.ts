import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { jsonError, requireSchoolAdmin } from '@/lib/api-auth'
import { attendanceEnabled } from '@/lib/attendance-access'
import { buildAttendanceReport } from '@/lib/attendance-report'
import { isValidDateKey, formatJalaliDate, todayDateKey } from '@/lib/jalali'
import { statusLabel } from '@/lib/attendance-access'

/**
 * GET /api/attendance/report/export — خروجی اکسل گزارش فیلترشده (فقط مدیر مدرسه)
 * سه شیت: «گزارش»، «آمار دانش‌آموزان»، «آمار کلاس‌ها» — همه راست‌به‌چپ
 * تاریخ‌ها جلالی؛ «ثبت‌نشده» جدا از غیبت.
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

  const wb = XLSX.utils.book_new()

  // ─── شیت گزارش ───
  const detailAoa: (string | number)[][] = [
    ['کلاس', 'جلسه', 'تاریخ', 'دانش‌آموز', 'وضعیت حضور', 'یادداشت', 'ثبت‌کننده', 'زمان نهایی‌سازی'],
  ]
  for (const r of report.rows) {
    detailAoa.push([
      r.classroomName,
      r.sessionTitle,
      formatJalaliDate(r.dateKey),
      r.studentName,
      statusLabel(r.status),
      r.note ?? '',
      r.creatorName,
      r.finalizedAt ? new Date(r.finalizedAt).toLocaleString('fa-IR') : '',
    ])
  }
  const wsDetail = XLSX.utils.aoa_to_sheet(detailAoa)
  wsDetail['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 20 }]
  ;(wsDetail as unknown as { '!views': unknown[] })['!views'] = [{ RTL: true }]
  XLSX.utils.book_append_sheet(wb, wsDetail, 'گزارش')

  // ─── شیت آمار دانش‌آموزان ───
  const studentAoa: (string | number)[][] = [
    ['دانش‌آموز', 'کلاس', 'حاضر', 'غایب', 'ثبت‌نشده', 'تعداد جلسات نهایی'],
  ]
  for (const s of report.stats.perStudent) {
    studentAoa.push([s.fullName, s.className, s.present, s.absent, s.unset, s.sessions])
  }
  const wsStudent = XLSX.utils.aoa_to_sheet(studentAoa)
  wsStudent['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 18 }]
  ;(wsStudent as unknown as { '!views': unknown[] })['!views'] = [{ RTL: true }]
  XLSX.utils.book_append_sheet(wb, wsStudent, 'آمار دانش‌آموزان')

  // ─── شیت آمار کلاس‌ها ───
  const classAoa: (string | number)[][] = [
    ['کلاس', 'حاضر', 'غایب', 'ثبت‌نشده', 'تعداد جلسات نهایی'],
  ]
  for (const c of report.stats.perClass) {
    classAoa.push([c.name, c.present, c.absent, c.unset, c.sessions])
  }
  const wsClass = XLSX.utils.aoa_to_sheet(classAoa)
  wsClass['!cols'] = [{ wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 18 }]
  ;(wsClass as unknown as { '!views': unknown[] })['!views'] = [{ RTL: true }]
  XLSX.utils.book_append_sheet(wb, wsClass, 'آمار کلاس‌ها')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const fname = `attendance-report-${todayDateKey()}.xlsx`

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
      'Cache-Control': 'no-store',
    },
  })
}
