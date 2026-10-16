/**
 * ردیابی دقیق سوکت روی دامنه پیش‌نمایش — تا ۳۵ ثانیه صبر + لاگ همه درخواست‌های socket.io
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.PREVIEW_BASE ?? 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai'
const USER = process.env.PV_USER ?? 'beheshti.t1'
const PASS = process.env.PV_PASS ?? 'Pass@123'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()

const t0 = Date.now()
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`

page.on('request', (r) => {
  if (r.url().includes('socket.io') || r.url().includes('XTransformPort'))
    console.log(`  ${ts()} [REQ]`, r.resourceType(), r.method(), r.url().slice(BASE.length, BASE.length + 120))
})
page.on('websocket', (ws) => {
  console.log(`  ${ts()} [WS-OPEN-ATTEMPT]`, ws.url().slice(0, 150))
  ws.on('close', () => console.log(`  ${ts()} [WS-CLOSED]`, ws.url().slice(0, 150)))
  ws.on('socketerror', (e) => console.log(`  ${ts()} [WS-ERROR]`, String(e).slice(0, 150)))
})
page.on('response', (r) => {
  if (r.url().includes('socket.io'))
    console.log(`  ${ts()} [RES ${r.status()}]`, r.url().slice(BASE.length, BASE.length + 120))
})
page.on('requestfailed', (r) => {
  if (r.url().includes('socket.io'))
    console.log(`  ${ts()} [FAIL]`, r.url().slice(BASE.length, BASE.length + 120), '→', r.failure()?.errorText)
})
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    console.log(`  ${ts()} [CONSOLE-${m.type().toUpperCase()}]`, m.text().slice(0, 180))
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
  console.log('▶ ورود روی', BASE)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await fillHydrated(page.locator('#username'), USER)
  await fillHydrated(page.locator('#password'), PASS)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 25000 })
  console.log(`  ${ts()} وارد شد → ${page.url()}`)

  // تا ۳۵ ثانیه وضعیت نشان را هر ثانیه چک کن
  let last = ''
  for (let i = 0; i < 35; i++) {
    const badge = await page
      .locator('span', { hasText: /^(متصل$|متصل‌? |درحال اتصال|قطع اتصال)/ })
      .allTextContents()
      .catch(() => [])
    const cur = JSON.stringify(badge)
    if (cur !== last) {
      console.log(`  ${ts()} نشان: ${cur}`)
      last = cur
    }
    if (badge.some((b) => b.includes('متصل') && !b.includes('درحال'))) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  await page.screenshot({ path: '/home/z/my-project/download/147-preview-socket-debug.png', fullPage: false })
  console.log(`  ${ts()} اسکرین‌شات 147`)
} catch (err) {
  console.log('❌', err.message)
} finally {
  await browser.close()
}
