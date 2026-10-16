/** دیباگ ارسال پیام گروهی — وضعیت سوکت، خطای شبکه، لیست پیام‌ها */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = 'http://localhost:3034'
const GID = 'cmv1aryqy000elokrx43nz39n'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function browserLogin(page, username, password) {
  await page.goto(BASE + '/login')
  await page.fill('#username', username)
  await page.fill('#password', password)
  const rb = page.locator('[role="checkbox"][aria-label="من ربات نیستم"]')
  for (let i = 0; i < 10; i++) {
    if ((await rb.getAttribute('aria-checked')) === 'true') break
    await rb.click().catch(() => {})
    await sleep(300)
  }
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)))
const responses = []
page.on('response', (r) => { if (r.url().includes('/api/chats')) responses.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`) })
page.on('websocket', (ws) => {
  console.log('WS OPEN:', ws.url())
  ws.on('close', () => console.log('WS CLOSED'))
})

await browserLogin(page, 'beheshti.s1', 'Pass@123')
console.log('logged in →', new URL(page.url()).pathname)
await page.goto(`${BASE}/chats/group/${GID}`)
await page.waitForSelector('[aria-label="متن پیام"]:visible', { timeout: 15000 })

// وضعیت سوکت از داخل صفحه
const socketInfo = await page.evaluate(async () => {
  return await new Promise((resolve) => {
    setTimeout(() => resolve('no-window-info'), 100)
  })
})

const MSG = 'دیباگ ' + Date.now()
await page.fill('[aria-label="متن پیام"]:visible', MSG)
await page.click('[aria-label="ارسال"]:visible')
console.log('clicked send:', MSG)
await sleep(6000)

// آیا پیام خودِ فرستنده در لیست دیده می‌شود؟
const own = await page.locator(`text=${MSG}`).count()
console.log('own message visible count:', own)

// ریلود → آیا از دیتابیس می‌آید؟
const allResponses = []
page.on('response', (r) => allResponses.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`))
await page.reload()
await page.waitForSelector('[aria-label="متن پیام"]:visible', { timeout: 15000 })
await sleep(2000)
const ownAfterReload = await page.locator(`text=${MSG}`).count()
console.log('after reload visible count:', ownAfterReload)
const bodyText = await page.locator('main, [class*="flex-1"]').first().innerText().catch(() => 'NO MAIN')
console.log('page url after reload:', page.url())
console.log('has error state:', bodyText.includes('خطا') || bodyText.includes('یافت نشد'))
console.log('\nall responses after reload:')
allResponses.slice(0, 25).forEach((r) => console.log(' ', r))

console.log('\nchat API responses:')
responses.slice(-15).forEach((r) => console.log(' ', r))
console.log('\nconsole errors:')
errors.slice(-10).forEach((e) => console.log(' ', e))
await page.screenshot({ path: '.verify-runtime/shots/debug-send.png' })
await browser.close()
process.exit(0)
