import { NextResponse } from 'next/server'
import { requireAppRole } from '@/lib/api-auth'
import { calendarAccessibleClassrooms } from '@/lib/calendar-events'

/**
 * GET /api/calendar/classes — کلاس‌های قابل دسترس در تقویم آموزشی بر اساس نقش:
 * مدیر مدرسه: همه کلاس‌های مدرسه | معلم: کلاس‌های منتسب | دانش‌آموز: کلاس‌های ثبت‌نام‌شده
 */
export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const classrooms = await calendarAccessibleClassrooms(res.session)
  return NextResponse.json({ classrooms })
}
