import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'

/**
 * DELETE /api/calendar/events/[id] — حذف رویداد تقویم
 * - مدیر مدرسه: هر رویداد مدرسه خودش (کلاسی یا کل مدرسه)
 * - معلم: فقط رویدادهایی که خودش ثبت کرده
 * - دانش‌آموز: ممنوع
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const event = await db.classEvent.findUnique({
    where: { id },
    select: { id: true, schoolId: true, createdById: true },
  })
  if (!event) return jsonError('رویداد یافت نشد', 404)

  if (session.role === 'STUDENT') {
    return jsonError('دانش‌آموز اجازه حذف رویداد ندارد', 403)
  }

  if (session.role === 'SCHOOL_ADMIN') {
    if (session.schoolId !== event.schoolId) {
      return jsonError('به این رویداد دسترسی ندارید', 403)
    }
  } else {
    // معلم: فقط رویداد ثبت‌شده خودش
    if (event.createdById !== session.uid) {
      return jsonError('فقط ثبت‌کننده رویداد یا مدیر مدرسه می‌تواند آن را حذف کند', 403)
    }
  }

  await db.classEvent.delete({ where: { id } })
  return NextResponse.json({ ok: true, message: 'رویداد حذف شد' })
}
