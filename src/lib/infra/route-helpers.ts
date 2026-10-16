import { NextResponse } from 'next/server'
import type { SessionPayload } from '@/lib/session'
import { rateLimit, sweepRateLimits } from './rate-limit'

/**
 * ابزار مشترک APIهای پایش — گارد نقش (requireSuperAdmin)، rate-limit
 * و پاسخ بدون کش. همهٔ APIهای زیرساخت از همین مسیر محافظت می‌شوند تا
 * کنترل دسترسی سمت سرور تضمین شود.
 */

export interface GuardOk {
  session: SessionPayload
}
export interface GuardBlocked {
  response: NextResponse
}

/**
 * احراز هویت مدیر کل + محدودسازی نرخ بر اساس شناسهٔ واقعی کاربر.
 * ترتیب مهم است: اول نقش (۴۰۱/۴۰۳)، بعد نرخ (۴۲۹).
 */
export async function guardSuperAdminApi(
  routeKey: string,
  max: number,
  windowMs: number,
): Promise<GuardOk | GuardBlocked> {
  const { requireSuperAdmin } = await import('@/lib/api-auth')
  const res = await requireSuperAdmin()
  if ('response' in res) return { response: res.response }
  sweepRateLimits()
  const rl = rateLimit(`${routeKey}:${res.session.uid}`, max, windowMs)
  if (!rl.ok) {
    return {
      response: NextResponse.json(
        { error: `درخواست‌های بیش از حد — ${rl.retryAfterSec} ثانیه دیگر تلاش کنید` },
        { status: 429, headers: { 'retry-after': String(rl.retryAfterSec) } },
      ),
    }
  }
  return { session: res.session }
}

/** پاسخ JSON بدون کش — حتی اگر هدر سراسری جایی جاماند */
export function infraJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  })
}
