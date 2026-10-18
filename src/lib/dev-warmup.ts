/**
 * گرم‌کردن خودکار مسیرهای کلیدی پس از بوت سرور توسعه
 *
 * چرا؟ ری‌استارت‌های نگهبان (watchdog) سرور dev را سرد بالا می‌آورند؛ نخستین
 * درخواست واقعی (مثلاً پنل پیش‌نمایش) باید صبر کند Turbopack صفحها را کامپایل
 * کند — مشاهده‌شده تا ۱۱ ثانیه برای /login. اگر پنل پیش‌نمایش/health-check
 * سکوی میزبان در همین پنجره timeout بزند، «پیش‌نمایش کار نمی‌کند» دیده می‌شود.
 *
 * راه‌حل: بلافاصله بعد از Ready، همین پروسه در پس‌زمینه مسیرهای عمومی پرتردد
 * (ورود اپ، ورود مدیر کل، برندینگ) را درخواست می‌کند تا کامپایل سرد در زمان
 * بوت (پشت صبرِ نگهبان) پرداخت شود و نخستین کلیک کاربر سریع جواب بگیرد.
 *
 * فقط حالت development — در پروداکشن (استندالون) صفحات از قبل کامپایل‌اند.
 * هیچ‌گاه خطا نمی‌دهد؛ گرم‌کردن «بهترین تلاش» است و بوت را مسدود نمی‌کند.
 */

const PORT = Number(process.env.PORT ?? 3000)
const BASE = `http://127.0.0.1:${PORT}`

/** مسیرهای عمومیِ نقطهٔ ورود کاربر — بدون احراز هویت در دسترس‌اند */
const WARM_ROUTES = ['/', '/login', '/superadmin', '/api/branding']

const WAIT_SERVER_MS = 90_000 // سرور حداکثر ۹۰ث برای listen کردن فرصت دارد
const ROUTE_TIMEOUT_MS = 60_000 // کامپایل سرد یک صفحه حداکثر ۶۰ث
const POLL_MS = 2_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** صبر تا سرور به اتصال پاسخ بدهد (هر پاسخ HTTP = listen است) */
async function waitForServer(): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < WAIT_SERVER_MS) {
    try {
      const res = await fetch(`${BASE}/api/branding`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
      })
      if (res.status > 0) return true
    } catch {
      /* هنوز بالا نیامده — دوباره تلاش می‌کنیم */
    }
    await sleep(POLL_MS)
  }
  return false
}

async function warmOne(route: string): Promise<boolean> {
  try {
    // redirect: 'follow' → «/» با 307 به /login می‌رسد و همان مسیر واقعی کاربر گرم می‌شود
    const res = await fetch(`${BASE}${route}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    })
    return res.ok || res.status === 401 || res.status >= 300
  } catch {
    return false
  }
}

/** ورودی instrumentation — بدون await؛ کاملاً جدا از بوت اجرا می‌شود */
export function warmRoutes(): void {
  if (process.env.NODE_ENV !== 'development') return
  const t = setTimeout(() => void run(), 1_500)
  t.unref?.() // تایمر نباید پروسه را زنده نگه دارد
}

async function run(): Promise<void> {
  try {
    const up = await waitForServer()
    if (!up) {
      console.log('[dev-warmup] سرور در مهلت پاسخ نداد — گرم‌کردن رد شد')
      return
    }
    let ok = 0
    for (const route of WARM_ROUTES) {
      if (await warmOne(route)) ok++
    }
    console.log(`[dev-warmup] مسیرهای کلیدی گرم شدند (${ok}/${WARM_ROUTES.length}) — نخستین درخواست پیش‌نمایش سریع پاسخ می‌گیرد`)
  } catch {
    /* گرم‌کردن هرگز نباید خطا بدهد */
  }
}
