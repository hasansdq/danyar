// بازتولی: دانش‌آموز دائما «درحال اتصال…» می‌بیند و متصل نمی‌شود
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const consoleErrors = []
const socketFails = []
const socketRequests = []

page.on('console', (msg) => {
  const t = msg.type()
  if (t === 'error' || t === 'warning') consoleErrors.push(`[${t}] ${msg.text().slice(0, 300)}`)
})
page.on('requestfailed', (req) => {
  if (req.url().includes('socket.io')) {
    socketFails.push(`${req.method()} ${req.url()} → ${req.failure()?.errorText}`)
  }
})
page.on('response', (res) => {
  const url = res.url()
  if (url.includes('socket.io')) {
    if (!url.includes('transport=polling') || res.status() !== 200 || true) {
      socketRequests.push(`${res.status()} ${url.replace(BASE, '')}${url.includes('EIO=4') ? '' : ''}`)
    }
  }
})

// 1) ورود دانش‌آموز
const loginResponses = []
page.on('response', (res) => {
  if (res.url().includes('/api/auth/login')) {
    loginResponses.push(`${res.status()} ${res.url()}`)
    res.text().then((t) => loginResponses.push('body: ' + t.slice(0, 200))).catch(() => null)
  }
})
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#username', '1234500001')
await page.fill('#password', '123456')
await page.click('[role="checkbox"][aria-label="من ربات نیستم"]')
await page.click('button[type="submit"]')
try {
  await page.waitForURL('**/chats', { timeout: 20000 })
} catch {
  console.log('STEP login: NAV FAILED, url =', page.url())
  const errText = await page.evaluate(() => document.body.innerText.slice(0, 500))
  console.log('page text:', errText)
  await page.screenshot({ path: '/home/z/my-project/download/repro-student-login-fail.png' })
}
console.log('STEP login: OK →', page.url())

// 2) صفحه گفتگوها — صبر برای اتصال سوکت
await page.waitForTimeout(15000)
const badge = await page.evaluate(() => {
  const badges = [...document.querySelectorAll('[role="status"]')]
  return badges.map((b) => b.textContent?.trim()).join(' | ')
})
console.log('STEP chats-after-15s: status badges =', JSON.stringify(badge))

// وضعیت واقعی سوکت از zustand (اگر در دسترس باشد)
const wsFrames = []
page.on('websocket', (ws) => {
  wsFrames.push(`ws-open: ${ws.url()}`)
  ws.on('close', () => wsFrames.push(`ws-close: ${ws.url()}`))
})

await page.waitForTimeout(8000)
const badge2 = await page.evaluate(() => {
  const badges = [...document.querySelectorAll('[role="status"]')]
  return badges.map((b) => b.textContent?.trim()).join(' | ')
})
console.log('STEP chats-after-23s: status badges =', JSON.stringify(badge2))

console.log('--- socket.io responses (last 12) ---')
for (const r of socketRequests.slice(-12)) console.log(r)
console.log('--- socket.io failed requests ---')
console.log(socketFails.length ? socketFails.join('\n') : '(none)')
console.log('--- websockets ---')
console.log(wsFrames.length ? wsFrames.join('\n') : '(none)')
console.log('--- console errors/warnings (last 15) ---')
for (const c of consoleErrors.slice(-15)) console.log(c)

await page.screenshot({ path: '/home/z/my-project/download/repro-student-connect.png', fullPage: false })
await browser.close()
