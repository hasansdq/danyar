// بازتولی از طریق URL عمومی پیش‌نمایش — دقیقاً محیط کاربر
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const consoleErrors = []
const socketLog = []
let wsOpened = false
let wsClosed = false

page.on('console', (msg) => {
  const t = msg.type()
  if (t === 'error' || t === 'warning') consoleErrors.push(`[${t}] ${msg.text().slice(0, 250)}`)
})
page.on('response', (res) => {
  const url = res.url()
  if (url.includes('socket.io')) {
    const m = /[?&](?:EIO=4&)?transport=(polling|websocket)/.exec(url)
    socketLog.push(`${res.status()} ${m?.[1] ?? '?'} ${url.split('?')[0]}`)
  }
})
page.on('websocket', (ws) => {
  wsOpened = true
  ws.on('close', () => { wsClosed = true })
  ws.on('socketerror', (e) => socketLog.push(`WS-ERROR: ${String(e).slice(0, 200)}`))
})
page.on('requestfailed', (req) => {
  if (req.url().includes('socket.io')) {
    socketLog.push(`FAILED ${req.method()} ${req.url().slice(0, 120)} → ${req.failure()?.errorText}`)
  }
})

// 1) ورود دانش‌آموز
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.fill('#username', '1234500001')
await page.fill('#password', '123456')
await page.click('[role="checkbox"][aria-label="من ربات نیستم"]')
await page.click('button[type="submit"]')
try {
  await page.waitForSelector('[role="status"]', { timeout: 30000 })
} catch { /* ادامه */ }
await page.waitForTimeout(3000)
console.log('STEP login: url =', page.url())

// 2) صبر برای اتصال سوکت
await page.waitForTimeout(12000)
const badge = await page.evaluate(() => {
  const badges = [...document.querySelectorAll('[role="status"]')]
  return badges.map((b) => b.textContent?.trim()).join(' | ')
})
console.log('STEP after-15s: badges =', JSON.stringify(badge))

await page.waitForTimeout(10000)
const badge2 = await page.evaluate(() => {
  const badges = [...document.querySelectorAll('[role="status"]')]
  return badges.map((b) => b.textContent?.trim()).join(' | ')
})
console.log('STEP after-25s: badges =', JSON.stringify(badge2))

console.log('--- socket.io traffic ---')
for (const s of socketLog.slice(0, 25)) console.log(s)
console.log('websocket opened:', wsOpened, 'closed:', wsClosed)
console.log('--- console errors/warnings ---')
console.log(consoleErrors.length ? consoleErrors.slice(-12).join('\n') : '(none)')

await page.screenshot({ path: '/home/z/my-project/download/repro-student-public-url.png', fullPage: false })
await browser.close()
