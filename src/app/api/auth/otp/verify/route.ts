import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/api-auth'
import { normalizePhone } from '@/lib/phone'
import { verifyOtp, phoneHmac } from '@/lib/otp'
import { ensureSmsConfig } from '@/lib/sms/config'
import { setSessionCookie, type Role } from '@/lib/session'

/**
 * POST /api/auth/otp/verify — بررسی کد یک‌بارمصرف و ورود.
 * کد مصرف‌شده یا منقضی قابل استفاده نیست؛ سقف تلاش سمت سرور اعمال می‌شود.
 * حساب غیرفعال یا کاربر مدرسه غیرفعال نمی‌تواند وارد شود؛ مدیر کل با پیامک وارد نمی‌شود.
 */

// محدودیت تلاش بررسی بر اساس شماره (ضد جست‌وجوی کد)
const verifyHits = new Map<string, number[]>()
setInterval(() => {
  const cutoff = Date.now() - 15 * 60_000
  for (const [k, arr] of verifyHits) {
    const fresh = arr.filter((t) => t > cutoff)
    if (fresh.length) verifyHits.set(k, fresh)
    else verifyHits.delete(k)
  }
}, 5 * 60_000).unref?.()

const VERIFY_LIMIT_PER_15MIN = 12

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const phone = normalizePhone(body?.phone)
  const rawCode = String(body?.code ?? '').trim()
  const code = rawCode.replace(/\D/g, '')
  if (!phone) return jsonError('شماره تلفن معتبر نیست', 400)
  if (!code || code.length < 4 || code.length > 8) {
    return jsonError('کد وارد شده معتبر نیست', 400)
  }

  const config = await ensureSmsConfig()
  if (!config.smsLoginEnabled || !config.enabled || !config.provider) {
    return jsonError('ورود با پیامک در دسترس نیست', 503)
  }

  const hmac = phoneHmac(phone)
  const now = Date.now()
  const hits = (verifyHits.get(hmac) ?? []).filter((t) => t > now - 15 * 60_000)
  if (hits.length >= VERIFY_LIMIT_PER_15MIN) {
    return NextResponse.json(
      { error: 'تلاش‌های بیش از حد؛ ۱۵ دقیقه دیگر دوباره تلاش کنید' },
      { status: 429 },
    )
  }
  hits.push(now)
  verifyHits.set(hmac, hits)

  const result = await verifyOtp(phone, code, config)
  if (!result.ok) {
    return jsonError('کد وارد شده صحیح نیست یا منقضی شده است', 400)
  }

  const user = await db.user.findUnique({
    where: { phone },
    include: { school: { select: { isActive: true } } },
  })
  if (!user || user.role === 'SUPER_ADMIN') {
    return jsonError('حساب کاربری برای این شماره قابل استفاده نیست', 403)
  }
  if (!user.isActive) {
    return jsonError('حساب کاربری شما غیرفعال شده است', 403)
  }
  if (user.role !== 'SUPER_ADMIN' && (!user.school || !user.school.isActive)) {
    return jsonError('مدرسه شما غیرفعال است؛ با پشتیبانی تماس بگیرید', 403)
  }

  await setSessionCookie({
    uid: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role as Role,
    schoolId: user.schoolId,
  })

  return NextResponse.json({
    ok: true,
    redirect: '/chats',
    user: { username: user.username, fullName: user.fullName, role: user.role },
  })
}
