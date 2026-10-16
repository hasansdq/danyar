// تست رگرسیون: دانش‌آموز پس از تغییرات — اتصال سوکت + سلامت SW + صفحه گفتگو
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200))
})

// ۱) ورود دانش‌آموز
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#username', { timeout: 30000 })
await page.fill('#username', '1234500001')
await page.fill('#password', '123456')
await page.click('[role="checkbox"][aria-label="من ربات نیستم"]')
await page.click('button[type="submit"]')
try {
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 })
} catch { /* ادامه — چک زیر تشخیص می‌دهد */ }
check('ورود دانش‌آموز موفق', !page.url().includes('/login'), page.url())

// ۲) صفحه گفتگوها
await page.goto(`${BASE}/chats`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
const badge = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[role="status"]')]
  return b.map((x) => x.textContent?.trim()).join(' | ')
})
check('نشان اتصال = متصل', badge.includes('متصل') && !badge.includes('درحال اتصال'), badge)
check('بدون ارور کنسول', consoleErrors.length === 0, consoleErrors.join(' ;; '))

// ۳) سلامت سرویس‌ورکر — نسخه v2 ثبت شده و به دست‌دادن نسخه پاسخ می‌دهد
const swInfo = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return { ok: false, why: 'no sw support' }
  const reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg || !reg.active) return { ok: false, why: 'no active sw' }
  const version = await new Promise((resolve) => {
    const ch = new MessageChannel()
    const t = setTimeout(() => resolve(null), 2000)
    ch.port1.onmessage = (e) => {
      clearTimeout(t)
      resolve(e.data?.version ?? null)
    }
    reg.active.postMessage({ type: 'DANIAR_SW_VERSION' }, [ch.port2])
  })
  return { ok: version === 'daniar-static-v2', version }
})
check('SW فعال نسخه v2 و پاسخ‌گو', swInfo.ok, JSON.stringify(swInfo))

// ۴) جستجوی نشان «درحال اتصال» نباید ابدی باشد — صفحات فرعی هم متصل‌اند
await page.goto(`${BASE}/live`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const liveText = await page.evaluate(() => document.body.innerText.slice(0, 400))
check('صفحه کلاس آنلاین بدون ارور', !liveText.includes('Application error'), liveText.slice(0, 120).replace(/\n/g, ' '))

await page.screenshot({ path: '/home/z/my-project/download/test-student-connect-fixed.png', fullPage: false })
await browser.close()

console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`)
process.exit(fail > 0 ? 1 : 0)
