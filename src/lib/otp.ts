import { createHmac, createHash, randomInt, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'

/**
 * کد یک‌بارمصرف ورود — کد همیشه هش‌شده ذخیره می‌شود (SHA-256 با HMAC شماره).
 * خود شماره هم ذخیره نمی‌شود (فقط HMAC آن برای یافتن ردیف‌ها).
 * محدودیت‌ها سمت سرور اعمال می‌شوند: انقضا، فاصله ارسال مجدد،
 * سقف درخواست ساعتانه و سقف تلاش برای هر کد.
 */

function serverSecret(): string {
  return process.env.SESSION_SECRET ?? 'daniar-dev-secret-change-me-in-production'
}

export function phoneHmac(phone: string): string {
  return createHmac('sha256', serverSecret()).update(`otp:phone:${phone}`).digest('hex')
}

function codeHash(phone: string, code: string): string {
  return createHash('sha256')
    .update(`${phoneHmac(phone)}:${code}:daniar-otp-v1`)
    .digest('hex')
}

/** محدودیت فاصله ارسال مجدد برای همه شماره‌ها (حتی بدون حساب) — در حافظه فرآیند */
const lastRequest = new Map<string, number>()
setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000
  for (const [k, ts] of lastRequest) if (ts < cutoff) lastRequest.delete(k)
}, 5 * 60_000).unref?.()

export interface SmsRuntimeConfig {
  codeTtlSeconds: number
  resendCooldownSeconds: number
  maxAttemptsPerCode: number
  maxRequestsPerHour: number
}

export type CreateOtpResult =
  | { ok: true; code: string; cooldownSeconds: number; expiresInSeconds: number }
  | { ok: false; reason: 'COOLDOWN' | 'RATE'; retryAfter: number }

export async function createOtp(
  phone: string,
  cfg: SmsRuntimeConfig,
): Promise<CreateOtpResult> {
  const hmac = phoneHmac(phone)
  const now = Date.now()

  // فاصله ارسال مجدد — برای هر شماره‌ای اعمال می‌شود (بدون افشای وجود حساب)
  const last = lastRequest.get(hmac) ?? 0
  const cooldownMs = Math.max(5, cfg.resendCooldownSeconds) * 1000
  const sinceLast = now - last
  if (last && sinceLast < cooldownMs) {
    return {
      ok: false,
      reason: 'COOLDOWN',
      retryAfter: Math.ceil((cooldownMs - sinceLast) / 1000),
    }
  }

  // سقف درخواست ساعتانه بر اساس کدهای ساخته‌شده
  const since = new Date(now - 60 * 60_000)
  const recent = await db.otpCode.count({
    where: { phoneHmac: hmac, createdAt: { gte: since } },
  })
  if (recent >= Math.max(1, cfg.maxRequestsPerHour)) {
    return { ok: false, reason: 'RATE', retryAfter: 60 * 60 }
  }

  // مصرف نشدن «فاصله مجاز» با پاسخ موفق/ناموفق باید ثبت شود
  lastRequest.set(hmac, now)

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const ttl = Math.min(Math.max(cfg.codeTtlSeconds, 30), 600)
  await db.otpCode.create({
    data: {
      phoneHmac: hmac,
      codeHash: codeHash(phone, code),
      expiresAt: new Date(now + ttl * 1000),
    },
  })
  return {
    ok: true,
    code,
    cooldownSeconds: Math.max(5, cfg.resendCooldownSeconds),
    expiresInSeconds: ttl,
  }
}

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID' | 'LOCKED' }

export async function verifyOtp(
  phone: string,
  code: string,
  cfg: SmsRuntimeConfig,
): Promise<VerifyOtpResult> {
  const hmac = phoneHmac(phone)
  const row = await db.otpCode.findFirst({
    where: {
      phoneHmac: hmac,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!row) return { ok: false, reason: 'INVALID' }

  if (row.attempts >= Math.max(1, cfg.maxAttemptsPerCode)) {
    // قفل شدن کد پس از سقف تلاش
    await db.otpCode
      .update({ where: { id: row.id }, data: { consumedAt: new Date() } })
      .catch(() => null)
    return { ok: false, reason: 'LOCKED' }
  }

  await db.otpCode.update({
    where: { id: row.id },
    data: { attempts: { increment: 1 } },
  })

  const expected = Buffer.from(row.codeHash, 'hex')
  const actual = Buffer.from(codeHash(phone, code), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'INVALID' }
  }

  await db.otpCode
    .update({ where: { id: row.id }, data: { consumedAt: new Date() } })
    .catch(() => null)
  return { ok: true }
}
