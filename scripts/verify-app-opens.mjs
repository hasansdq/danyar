// راستی‌آزمایی باز شدن دانیار پس از رفع ارور module factory
// - بررسی نبود اروراورلی Next.js در /login و /
// - ورود مدیر و رندر کامل شِل (سایدبار) در صفحه اصلی
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE || 'http://localhost:81'
let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log(`  ✓ ${msg}`) } else { fail++; console.log(`  ✗ ${msg}`) } }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fa' })
const page = await ctx.newPage()

const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message))

async function hasErrorOverlay() {
  return page.evaluate(() => {
    const t = document.body?.innerText || ''
    return t.includes('Runtime Error') || t.includes('module factory is not available')
  })
}

try {
  // ۱) صفحه ورود
  console.log('— /login')
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(1500)
  ok(!(await hasErrorOverlay()), 'بدون اورلی Runtime Error در /login')
  ok((await page.locator('input[type="password"]').count()) > 0, 'فرم ورود رندر شد')

  // ۲) ورود مدیر مدرسه
  console.log('— ورود beheshti.admin')
  const userInput = page.locator('input[name="username"], #username, input[type="text"]').first()
  await userInput.fill('beheshti.admin')
  await page.locator('input[type="password"]').first().fill('Pass@123')
  const robot = page.locator('[role="checkbox"][aria-label="من ربات نیستم"]')
  if (await robot.count()) await robot.click()
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(4000)

  // ۳) صفحه اصلی (همان که با ارور avatar/app-shell باز نمی‌شد)
  console.log('— / (گفتگوها، شِل کامل)')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(2500)
  ok(!(await hasErrorOverlay()), 'بدون اورلی Runtime Error در /')
  ok(await page.locator('aside').count() > 0, 'سایدبار دسکتاپ رندر شد (app-shell سالم)')
  const sidebarText = await page.locator('aside').innerText().catch(() => '')
  ok(sidebarText.includes('گفتگوها'), 'آیتم گفتگوها در سایدبار')
  ok(sidebarText.includes('تقویم آموزشی'), 'آیتم تقویم آموزشی در سایدبار')

  // ۴) سرویس‌ورکر جدید v2
  console.log('— /sw.js')
  const swRes = await page.request.get(`${BASE}/sw.js`)
  const swText = await swRes.text()
  ok(swText.includes('daniar-static-v2'), 'سرویس‌ورکر نسخه v2 سرو می‌شود')
  ok(!swText.includes("url.pathname.startsWith('/_next/static/')"), '/_next/static/ دیگر کش نمی‌شود')

  await page.screenshot({ path: '/home/z/my-project/download/app-open-fixed.png', fullPage: false })
} catch (e) {
  fail++
  console.log('  ✗ خطای اسکریپت: ' + e.message)
}

if (consoleErrors.length) {
  console.log('— خطاهای کنسول (اولین ۵ مورد):')
  for (const e of consoleErrors.slice(0, 5)) console.log('   · ' + e.slice(0, 200))
}
ok(consoleErrors.filter((e) => e.includes('module factory')).length === 0, 'هیچ ارور module factory در کنسول')

await browser.close()
console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`)
process.exit(fail ? 1 : 0)
