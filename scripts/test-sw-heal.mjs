// تست ترمیم خودکار — شبیه‌سازی واقعی مرورگر گیرکرده:
// /sw.js با محتوای نسخه ۱ سرو می‌شود (کش‌کننده، بدون هندلر نسخه).
// صفحه باید SW کهنه را تشخیص دهد، حذف/پاک‌سازی کند و SW واقعی v2 جای آن بنشیند.
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

/** محتوای sw.js نسخه ۱ — کش‌کننده همه‌چیز + بدون هندلر DANIAR_SW_VERSION */
const OLD_SW = `
const CACHE = 'fake-old-cache-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(event.request).then(
        (hit) => hit || fetch(event.request).then((res) => {
          try { c.put(event.request, res.clone()) } catch {}
          return res
        }),
      ),
    ),
  )
})
`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

// ۱) همه درخواست‌های /sw.js محتوای قدیمی می‌گیرند (مرورگر گیرکرده کاربر)
await ctx.route('**/sw.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: OLD_SW }))
await page.goto(`${BASE}/login`, { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(1500)

const before = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations()
  const keys = 'caches' in window ? await caches.keys() : []
  return { regs: regs.map((r) => r.active?.scriptURL ?? '?'), keys, controlled: !!navigator.serviceWorker.controller }
})
console.log('قبل از ترمیم:', before)
check('SW قدیمی کنترل‌گر صفحه است', before.controlled && before.keys.includes('fake-old-cache-v1'), JSON.stringify(before))

// ۲) ناوبری به /chats — SW قدیمی همچنان سرو می‌شود (بدون به‌روزرسانی خودکار؛ محتوای بایت‌یکسان)
//    → push-bridge نسخه را می‌پرسد، پاسخی نمی‌گیرد → ترمیم خودکار (حذف SW + پاک‌سازی کش + نوسازی)
await page.goto(`${BASE}/chats`, { waitUntil: 'load' })
await page.waitForTimeout(4500) // ۲s مهلت نسخه + ترمیم + نوسازی

// ۳) پس از ترمیم، رهگیری برداشته می‌شود تا ثبت مجدد، نسخه واقعی v2 را بگیرد
await ctx.unroute('**/sw.js')
await page.waitForTimeout(4000)

const after = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations()
  const keys = 'caches' in window ? await caches.keys() : []
  let version = null
  const reg = await navigator.serviceWorker.getRegistration('/')
  if (reg && reg.active) {
    version = await new Promise((resolve) => {
      const ch = new MessageChannel()
      const t = setTimeout(() => resolve(null), 2000)
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data?.version ?? null) }
      reg.active.postMessage({ type: 'DANIAR_SW_VERSION' }, [ch.port2])
    })
  }
  return { keys, version, hasActive: !!(reg && reg.active) }
})
console.log('بعد از ترمیم:', after)
check('کش قدیمی پاک شد', !after.keys.includes('fake-old-cache-v1'), JSON.stringify(after.keys))
check('SW سالم v2 فعال و پاسخ‌گوست', after.version === 'daniar-static-v2', JSON.stringify(after))

await browser.close()
console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`)
process.exit(fail > 0 ? 1 : 0)
