import { NextResponse } from 'next/server'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import { attendanceEnabled, accessibleClassrooms } from '@/lib/attendance-access'

/**
 * GET /api/attendance/classes — کلاس‌های قابل دسترس بر اساس نقش:
 * معلم: فقط کلاس‌هایی که از طریق گروه‌ها به آن‌ها منتسب است
 * مدیر مدرسه: همه کلاس‌های مدرسه خودش
 * (دانش‌آموز مجاز نیست — 403)
 */
export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role === 'STUDENT') {
    return jsonError('دانش‌آموز به این بخش دسترسی ندارد', 403)
  }

  const enabled = await attendanceEnabled(session.schoolId)
  if (!enabled) return jsonError('حضور و غیاب برای این مدرسه غیرفعال است', 403)

  const classrooms = await accessibleClassrooms(session)
  return NextResponse.json({ classrooms })
}
