import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/api-auth'
import { normalizePhone, maskPhone } from '@/lib/phone'
import { createOtp } from '@/lib/otp'
import { ensureSmsConfig } from '@/lib/sms/config'
import { sendOtpViaProvider } from '@/lib/sms/providers'

/**
 * POST /api/auth/otp/request — درخواست کد ورود پیامکی.
 * پاسخ همیشه عمومی است و وجود یا نبودِ حساب را افشا نمی‌کند.
 * محدودیت‌ها سمت سرور: فاصله ارسال مجدد، سقف درخواست ساعتانه.
 * ورود پیامکی مدیر کل در این مرحله فعال نیست.
 */

// محدودیت سراسری سبک بر اساس IP (جلوگیری از آزار سرویس)
const ipHits = new Map<string, number[]>()
setInterval(() => {
  const cutoff = Date.now() - 60 * 60_000
  for (const [k, arr] of ipHits) {
    const fresh = arr.filter((t) => t > cutoff)
    if (fresh.length) ipHits.set(k, fresh)
    else ipHits.delete(k)
  }
}, 5 * 60_000).unref?.()

const IP_LIMIT_PER_HOUR = 20

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const phone = normalizePhone(body?.phone)
  if (!phone) {
    return jsonError('شماره تلفن معتبر نیست؛ قالب درست: ۰۹xxxxxxxxx', 400)
  }

  const config = await ensureSmsConfig()
  if (!config.smsLoginEnabled) {
    return jsonError('ورود با پیامک در دسترس نیست', 503)
  }
  if (!config.enabled || !config.provider) {
    return jsonError('سرویس پیامکی پیکربندی نشده است؛ با پشتیبانی مدرسه تماس بگیرید', 503)
  }

  // محدودیت IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const now = Date.now()
  const hits = (ipHits.get(ip) ?? []).filter((t) => t > now - 60 * 60_000)
  if (hits.length >= IP_LIMIT_PER_HOUR) {
    return NextResponse.json(
      { error: 'تعداد درخواست‌ها بیش از حد مجاز است؛ بعداً تلاش کنید' },
      { status: 429 },
    )
  }
  hits.push(now)
  ipHits.set(ip, hits)

  // کاربر واجد شرایط: نقش‌های اپ فعال با مدرسه فعال (مدیر کل هرگز با پیامک وارد نمی‌شود)
  const user = await db.user.findUnique({
    where: { phone },
    include: { school: { select: { isActive: true } } },
  })
  const eligible =
    !!user &&
    user.role !== 'SUPER_ADMIN' &&
    user.isActive &&
    (!user.school || user.school.isActive)

  let cooldownSeconds = Math.max(5, config.resendCooldownSeconds)

  if (eligible && user) {
    const otp = await createOtp(phone, config)
    if (!otp.ok) {
      if (otp.reason === 'COOLDOWN') {
        return NextResponse.json(
          { error: `برای ارسال مجدد ${otp.retryAfter} ثانیه صبر کنید`, retryAfter: otp.retryAfter },
          { status: 429 },
        )
      }
      return NextResponse.json(
        { error: 'تعداد درخواست کد برای این شماره بیش از حد مجاز است؛ یک ساعت دیگر تلاش کنید' },
        { status: 429 },
      )
    }
    cooldownSeconds = otp.cooldownSeconds

    let creds: Record<string, string> = {}
    try {
      creds = JSON.parse(config.credentials || '{}') as Record<string, string>
    } catch {
      creds = {}
    }
    const send = await sendOtpViaProvider(config.provider, creds, phone, otp.code)
    await db.smsSendLog.create({
      data: {
        provider: config.provider,
        maskedPhone: maskPhone(phone),
        purpose: 'OTP',
        ok: send.ok,
        error: send.error ?? null,
      },
    })
    if (!send.ok) {
      return jsonError('ارسال پیامک ناموفق بود؛ کمی بعد دوباره تلاش کنید', 502)
    }

    return NextResponse.json({
      ok: true,
      cooldownSeconds,
      expiresInSeconds: otp.expiresInSeconds,
    })
  }

  // پاسخ عمومی — بدون افشای وجود یا نبود حساب
  return NextResponse.json({
    ok: true,
    cooldownSeconds,
    expiresInSeconds: Math.min(Math.max(config.codeTtlSeconds, 30), 600),
  })
}
