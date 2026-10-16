/**
 * قلاب بوت Next.js — یک‌بار در راه‌اندازی پروسهٔ سرور (nodejs runtime)
 *
 * خودترمیم زیرساخت سندباکس: hydrate کلیدهای غایب .env + تضمین اجرای LiveKit
 * + نگهبان دوره‌ای سوکت/رسانه. هیچ خطایی به بوت منتقل نمی‌کند — خودترمیم
 * همیشه «بهترین تلاش» است و نباید به‌خاطر آن بالا آمدن اپ متوقف شود.
 * جزئیات: src/lib/media-selfheal.ts
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { bootSelfHeal } = await import('@/lib/media-selfheal')
    bootSelfHeal()
  } catch (e) {
    console.error('[instrumentation] bootSelfHeal error:', e)
  }
}
