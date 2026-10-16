/**
 * دیباگ پیش‌نمایش زنده روی دامنه واقعی preview-chat-*.space-z.ai
 * ورود واقعی دانش‌آموز → صفحه گفتگوها → بررسی بارگذاری فهرست، سوکت، خطاها
 *
 * اجرا: node scripts/debug-preview-domain.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.PREVIEW_BASE ?? 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai'
const USER = process.env.DBG_USER ?? 'beheshti.s1'
const PASS = process.env.DBG_PASS ?? 'Pass@123'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  ignoreHTTPSErrors: true,
})
const page = await ctx.newPage()

const consoleErrs = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200))
})
page.on('pageerror', (e) => consoleErrs.push('PAGEERROR: ' + String(e).slice(0, 200)))
page.on('requestfailed', (r) => {
  const f = r.failure()?.errorText ?? ''
  if (!f.includes('ERR_ABORTED')) console.log('  [REQFAIL]', r.method(), r.url().slice(0, 120), '→', f)
})
page.on('response', (r) => {
  if (r.status() >= 400) console.log('  [HTTP', r.status() + ']', r.request().method(), r.url().slice(0, 140))
})

async function fillHydrated(locator, value) {
  for (let i = 0; i < 12; i++) {
    await locator.click()
    await locator.fill('')
    await locator.fill(value)
    if ((await locator.inputValue()) === value) return
    await new Promise((r) => setTimeout(r, 700))
  }
  throw new Error('fill never stuck')
}

try {
  console.log('▶ باز کردن', BASE)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  console.log('  عنوان:', await page.title())

  await fillHydrated(page.locator('#username'), USER)
  await fillHydrated(page.locator('#password'), PASS)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  const [loginResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ])
  console.log('  پاسخ ورود:', loginResp ? loginResp.status() : 'ندارند')

  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 25000 })
  console.log('  پس از ورود:', page.url())

  // صفحه گفتگوها
  await page.waitForTimeout(3500)
  console.log('▶ آدرس فعلی:', page.url())
  const badge = await page.locator('[data-connection-badge], [class*="connection"]').allTextContents().catch(() => [])
  console.log('  بج‌های احتمالی اتصال:', JSON.stringify(badge))
  const badgeText = await page
    .locator('span', { hasText: /^(متصل|درحال اتصال|قطع اتصال)/ })
    .allTextContents()
    .catch(() => [])
  console.log('  نشان وضعیت:', JSON.stringify(badgeText))

  const convItems = await page.locator('ul.divide-y > li').count()
  console.log('  تعداد آیتم گفتگو در فهرست:', convItems)

  const loading = await page.locator('.animate-spin').count()
  console.log('  اسپینر بارگذاری مانده:', loading)

  // کوکی‌ها
  const cookies = await ctx.cookies()
  console.log(
    '  کوکی‌ها:',
    cookies.map((c) => `${c.name}(${c.sameSite ?? '?'}/${c.secure ? 'S' : '-'})`).join(', '),
  )

  // ورود به اولین گفتگو (اگر هست)
  if (convItems > 0) {
    await page.locator('ul.divide-y > li button').first().click()
    await page.waitForTimeout(3000)
    console.log('  پس از کلیک روی گفتگو:', page.url())
    const composer = await page.locator('textarea, [contenteditable="true"], input[placeholder*="پیام"]').count()
    console.log('  کامپوزر پیام:', composer)
  }

  await page.screenshot({ path: '/home/z/my-project/download/146-preview-domain-debug.png', fullPage: false })
  console.log('  اسکرین‌شات: download/146-preview-domain-debug.png')

  console.log('\n▶ خطاهای کنسول (' + consoleErrs.length + '):')
  consoleErrs.slice(0, 12).forEach((e) => console.log('  •', e))
} catch (err) {
  console.log('❌ خطا:', err.message)
  try { await page.screenshot({ path: '/home/z/my-project/download/146-preview-domain-error.png' }) } catch {}
} finally {
  await browser.close()
}
