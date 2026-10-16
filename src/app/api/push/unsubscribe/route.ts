import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, jsonError } from '@/lib/api-auth'

/**
 * POST /api/push/unsubscribe — لغو اشتراک پوش.
 * - با endpoint: حذف دقیق همین دستگاه (موقع غیرفعال‌سازی در همان مرورگر)
 * - با deviceId: حذف دستگاه‌های شناسایی‌شده (موقع خروج از حساب)
 * - با all: حذف همه اشتراک‌های کاربر
 * فقط اشتراک‌های متعلق به کاربر فعلی حذف می‌شوند.
 */
export async function POST(req: NextRequest) {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session

  const body = await req.json().catch(() => ({}))
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : null
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.slice(0, 64) : null
  const all = body?.all === true

  if (!endpoint && !deviceId && !all) return jsonError('مشخصات اشتراک ارسال نشده است')

  const where = all
    ? { userId: session.uid }
    : endpoint
      ? { userId: session.uid, endpoint }
      : { userId: session.uid, deviceId }

  const result = await db.pushSubscription.deleteMany({ where })
  return NextResponse.json({ ok: true, removed: result.count })
}
