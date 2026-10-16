'use client'

/**
 * ترمیم خودکار حالت‌های گیرکردهٔ مرورگر (سرویس‌ورکر/کش کهنه)
 *
 * زمینه: سرویس‌ورکر نسخه‌های قبلی، چانک‌های dev را کش می‌کرد و پس از HMR
 * باعث ارور «module factory is not available» و گیرکردن نشان اتصال روی
 * «درحال اتصال…» می‌شد. این ماژول با دست‌دادن نسخه، SW کهنه را تشخیص و
 * بدون دخالت کاربر ترمیم می‌کند؛ دکمه «تلاش مجدد» نشان اتصال هم همین
 * مسیر را برای فرار دستی از هر حالت گیرکرده اجرا می‌کند.
 */

/** نسخهٔ کش انتظارداشته — با STATIC_CACHE در public/sw.js هماهنگ نگه داشته شود */
export const EXPECTED_SW_VERSION = 'daniar-static-v2'

const HEAL_FLAG = 'daniar-sw-heal'
const REPAIR_FLAG = 'daniar-sw-repair'

/** لغو ثبت همهٔ سرویس‌ورکرها + پاک‌سازی همهٔ کش‌ها + نوسازی صفحه (یک‌بار در هر نشست) */
export async function repairAndReload(): Promise<void> {
  try {
    if (sessionStorage.getItem(REPAIR_FLAG)) {
      // قبلاً ترمیم شده و باز گیر کرده‌ایم — نوسازی ساده تا حلقه نسازیم
      window.location.reload()
      return
    }
    sessionStorage.setItem(REPAIR_FLAG, '1')
  } catch {
    /* ignore */
  }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister().catch(() => null)))
    }
  } catch {
    /* ignore */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => null)))
    }
  } catch {
    /* ignore */
  }
  window.location.reload()
}

/**
 * بررسی نسخهٔ سرویس‌ورکر فعال:
 * - اگر SW کنترل‌کننده‌ای هست و نسخهٔ درست پاسخ داد → سالم
 * - اگر پاسخ نداد (SW کهنهٔ بدون هندلر نسخه) یا نسخهٔ نادرست بود → ترمیم خودکار
 * - بدون SW (بازدید اول) → کاری نکن
 */
export async function checkSwVersion(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    // قبلاً در این نشست ترمیم/بررسی شده — دوباره نپرس (حلقهٔ نوسازی ممنوع)
    if (sessionStorage.getItem(HEAL_FLAG)) return
    sessionStorage.setItem(HEAL_FLAG, '1')

    const reg = navigator.serviceWorker.controller
      ? await navigator.serviceWorker.getRegistration('/')
      : await navigator.serviceWorker.getRegistration()
    if (!reg || !reg.active) return // بدون SW — مشکلی نیست
    const active = reg.active

    const version = await new Promise<string | null>((resolve) => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => resolve(null), 2000)
      channel.port1.onmessage = (e) => {
        clearTimeout(timer)
        const data = e.data as { type?: string; version?: string } | null
        resolve(data && data.type === 'DANIAR_SW_VERSION' && typeof data.version === 'string' ? data.version : null)
      }
      try {
        active.postMessage({ type: 'DANIAR_SW_VERSION' }, [channel.port2])
      } catch {
        clearTimeout(timer)
        resolve(null)
      }
    })

    if (version !== EXPECTED_SW_VERSION) {
      await repairAndReload()
    }
  } catch {
    /* ignore — بررسی نسخه هرگز نباید بارگذاری صفحه را بشکند */
  }
}
