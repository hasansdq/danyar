// تست E2E: دانش‌آموز به جلسه فعال واقعی می‌رود — چه می‌بیند؟
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const SESSION = process.env.SESSION_ID ?? 'cmv4847a9000vpqnaeebxojb3'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ['camera', 'microphone'],
})
const page = await ctx.newPage()

const consoleErrors = []
const socketLog = []
page.on('console', (msg) => {
  const t = msg.type()
  if (t === 'error') consoleErrors.push(`[${t}] ${msg.text().slice(0, 250)}`)
})
page.on('response', (res) => {
  const url = res.url()
  if (url.includes('socket.io') && url.includes('transport=polling') && !url.includes('sid=')) {
    socketLog.push(`handshake ${res.status()}`)
  }
  if (url.includes('/api/live-sessions/')) socketLog.push(`api ${res.status()} ${url.replace(BASE, '')}`)
})

// ورود دانش‌آموز
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#username', '1234500001')
await page.fill('#password', '123456')
await page.click('[role="checkbox"][aria-label="من ربات نیستم"]')
await page.click('button[type="submit"]')
await page.waitForTimeout(4000)
console.log('STEP login:', page.url())

// رفتن مستقیم به جلسه فعال
await page.goto(`${BASE}/live/${SESSION}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(12000)
const state1 = await page.evaluate(() => document.body.innerText.slice(0, 600))
console.log('STEP room-after-12s:\n' + state1)

await page.waitForTimeout(10000)
const state2 = await page.evaluate(() => document.body.innerText.slice(0, 600))
console.log('STEP room-after-22s:\n' + state2)

console.log('--- traffic ---')
console.log(socketLog.join('\n'))
console.log('--- console errors ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)')

await page.screenshot({ path: '/home/z/my-project/download/repro-student-live-room.png', fullPage: false })
await browser.close()
