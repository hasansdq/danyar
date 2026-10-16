/**
 * محدودکنندهٔ نرخ درون‌حافظه‌ای برای APIهای تشخیصی پایش زیرساخت.
 *
 * - فقط مدیر کل به این APIها می‌رسد؛ سقف‌ها ملایم اما موجودند تا
 *   polling تهاجمی/حلقهٔ خطا فشار بی‌مورد نیاورد.
 * - بدون ذخیرهٔ هیچ دادهٔ شخصی؛ فقط شمارنده و پنجرهٔ زمانی.
 */

interface Bucket {
  windowStart: number
  count: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  ok: boolean
  /** ثانیه تا ریست پنجره (فقط وقتی ok=false معنا دارد) */
  retryAfterSec: number
}

/**
 * @param key کلید یکتا (route + شناسه کاربر)
 * @param max حداکثر تعداد در پنجره
 * @param windowMs طول پنجره
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 })
    return { ok: true, retryAfterSec: 0 }
  }
  if (b.count < max) {
    b.count += 1
    return { ok: true, retryAfterSec: 0 }
  }
  return {
    ok: false,
    retryAfterSec: Math.max(1, Math.ceil((b.windowStart + windowMs - now) / 1000)),
  }
}

/** پاک‌سازی دوره‌ای سطل‌های منقضی — جلوگیری از رشد بی‌نهایت حافظه */
export function sweepRateLimits(): void {
  const now = Date.now()
  for (const [k, b] of buckets) {
    // سطل‌هایolder از ۱۰ برابر طول پنجره‌شان
    if (now - b.windowStart > 10 * 60_000) buckets.delete(k)
  }
}
