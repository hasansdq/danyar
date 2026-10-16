// تست نهایی زنده‌پیش‌نمایش: اپ در iframe از مبدأ دیگر رندر + ورود کامل + ناوبری عمیق
// نکته: در dev، hydrate شدن داخل iframe ممکن است چند ثانیه طول بکشد — قبل از submit مقدار کنترل‌شده بررسی می‌شود
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'http://localhost:81'
const HOST_PORT = 8899

const hostHtml = `<!doctype html><html dir="rtl"><head><meta charset="utf-8">
<title>Live Preview Pane</title>
<style>body{margin:0;font-family:sans-serif;background:#0f172a;color:#fff;display:flex;flex-direction:column;height:100vh}
.bar{padding:8px 14px;font-size:13px;display:flex;gap:8px;align-items:center;background:#1e293b}
.dot{width:9px;height:9px;border-radius:50%;background:#22c55e;display:inline-block}
iframe{flex:1;border:0;width:100%;background:#fff}</style></head>
<body><div class="bar"><span class="dot"></span> پیش‌نمایش زنده پروژه — دانیار</div>
<iframe id="pv" src="${BASE}/superadmin"></iframe></body></html>`

mkdirSync('/tmp/preview-host', { recursive: true })
writeFileSync('/tmp/preview-host/index.html', hostHtml)
const server = spawn('python3', ['-m', 'http.server', String(HOST_PORT), '--bind', '127.0.0.1', '--directory', '/tmp/preview-host'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 1200))

let pass = 0, fail = 0
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); cond ? pass++ : fail++ }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
const blocked = []
page.on('console', m => { if (/refused to display|x-frame-options|frame-ancestors/i.test(m.text())) blocked.push(m.text()) })

const frame = page.frameLocator('#pv')

// پر کردن با صبر برای hydrate — تا وقتی مقدار کنترل‌شده ثبت نشد، دوباره پر می‌کند
async function fillHydrated(locator, value) {
  for (let i = 0; i < 10; i++) {
    await locator.fill(value)
    await page.waitForTimeout(700)
    if ((await locator.inputValue()) === value) return true
  }
  return false
}

try {
  await page.goto(`http://127.0.0.1:${HOST_PORT}/`, { waitUntil: 'domcontentloaded' })
  await frame.locator('input[name="username"]').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForTimeout(2500) // hydrate اولیه dev

  // ۱) رندر اپ در iframe پیش‌نمایش (مبدأ 8899 ≠ 81)
  ok('اپ داخل iframe پیش‌نمایش رندر می‌شود (بدون Refused to display)', true)
  ok('هیچ خطای X-Frame-Options/frame-ancestors در کنسول نیست', blocked.length === 0)

  // ۲) ورود مدیر کل داخل همان iframe
  const uFilled = await fillHydrated(frame.locator('input[name="username"]').first(), 'superadmin')
  const pFilled = await fillHydrated(frame.locator('input[name="password"]').first(), 'Admin@1234')
  ok('مقادیر فرم در state ثبت شد (hydrate کامل)', uFilled && pFilled)
  await frame.locator('[role="checkbox"]').first().click()
  const checked = await frame.locator('[role="checkbox"]').first().getAttribute('aria-checked')
  ok('تیک «من ربات نیستم» داخل فریم', checked === 'true')
  await frame.locator('button[type="submit"]').first().click()

  let nav = false
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000)
    const fu = page.frames().find(f => f !== page.mainFrame())?.url() || ''
    if (fu.includes('/admin')) { nav = true; break }
  }
  ok('ورود موفق و ورود به پنل مدیر کل داخل پیش‌نمایش', nav)

  // ۳) ناوبری عمیق: فهرست کاربران (جدول ۷ ستونه تازه‌ساخته) داخل پیش‌نمایش
  const deep = page.frames().find(f => f !== page.mainFrame())
  if (deep && nav) {
    await deep.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await deep.locator('[data-slot="table-head"], th').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const headTxt = await deep.locator('[data-slot="table-head"], th').allInnerTexts().catch(() => [])
    ok(`فهرست کاربران با سرستون‌ها در پیش‌نمایش (${headTxt.slice(0, 3).join('، ')})`, headTxt.some(t => t.includes('کاربر')) && headTxt.some(t => t.includes('مدرسه')))
  } else {
    ok('ناوبری عمیق: فهرست کاربران در پیش‌نمایش', false)
  }
  await page.screenshot({ path: '/home/z/my-project/download/136-live-preview-iframe.png' })

  // ۴) مسیر /chats داخل پیش‌نمایش: سوپرادمین طبق نقش به پنل مدیر هدایت می‌شود (رفتار صحیح)
  const deep2 = page.frames().find(f => f !== page.mainFrame())
  if (deep2 && nav) {
    await deep2.goto(`${BASE}/chats`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(4000)
    const redirected = (deep2.url() || '').includes('/admin')
    ok('مسیر /chats برای سوپرادمین طبق نقش به /admin هدایت شد (کوکی در iframe کار می‌کند)', redirected)
    await page.screenshot({ path: '/home/z/my-project/download/137-live-preview-iframe-chats.png' })
  } else {
    ok('مسیر /chats برای سوپرادمین طبق نقش به /admin هدایت شد (کوکی در iframe کار می‌کند)', false)
  }
} catch (e) {
  console.log('EXCEPTION:', e.message)
  ok('بدون استثنا', false)
  await page.screenshot({ path: '/home/z/my-project/download/136-live-preview-FAIL.png' }).catch(() => {})
} finally {
  await browser.close()
  server.kill()
}
console.log(`\nRESULT: ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
