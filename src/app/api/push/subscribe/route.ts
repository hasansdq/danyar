import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, jsonError } from '@/lib/api-auth'
import { getVapidStatus, getPushConfig } from '@/lib/push'

/**
 * POST /api/push/subscribe — ثبت (یا اتصال مجدد) اشتراک پوش همین دستگاه
 * به حساب کاربر فعلی. اشتراک با endpoint یکتا upsert می‌شود؛ بنابراین
 * ورود حساب جدید روی همان مرورگر، اشتراک را به حساب تازه متصل می‌کند و
 * دریافت اعلان حساب قبلی متوقف می‌شود.
 */
export async function POST(req: NextRequest) {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session

  if (!getVapidStatus().configured) return jsonError('پوش روی سرور پیکربندی نشده است', 503)
  if (!(await getPushConfig()).platformEnabled)
    return jsonError('پوش در سطح پلتفرم غیرفعال است', 403)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : ''
  const deviceId =
    typeof body.deviceId === 'string' ? body.deviceId.slice(0, 64) : null
  const label = typeof body.label === 'string' ? body.label.slice(0, 80) : null

  if (!endpoint || !p256dh || !auth) return jsonError('داده‌های اشتراک ناقص است')
  // endpoint باید آدرس معتبر سرویس پوش باشد
  try {
    const u = new URL(endpoint)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return jsonError('آدرس سرویس پوش نامعتبر است')
    }
  } catch {
    return jsonError('آدرس سرویس پوش نامعتبر است')
  }
  if (p256dh.length > 512 || auth.length > 512 || endpoint.length > 2048) {
    return jsonError('داده‌های اشتراک بیش از حد مجاز است')
  }

  // upsert بر اساس endpoint — ثبت تکراری نمی‌سازد و حساب را درست متصل می‌کند
  const sub = await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: session.uid, endpoint, p256dh, auth, deviceId, label, enabled: true },
    update: {
      userId: session.uid,
      p256dh,
      auth,
      deviceId,
      label,
      enabled: true,
    },
    select: { id: true, enabled: true },
  })

  return NextResponse.json({ ok: true, id: sub.id, enabled: sub.enabled })
}
