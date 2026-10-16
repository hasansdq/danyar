/** دیباگ ارسال پیام از UI — وضعیت دکمه، درخواست‌ها، متا */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const BASE = 'http://localhost:81'
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('request', (r) => { if (r.method() === 'POST') console.log('[POST]', r.url().replace(BASE, '')) })
page.on('response', (r) => { if (r.request().method() === 'POST') console.log('[POST-RES]', r.status(), r.url().replace(BASE, '')) })
page.on('requestfailed', (r) => console.log('[FAIL]', r.method(), r.url().replace(BASE, ''), r.failure()?.errorText))
page.on('console', (m) => { if (m.type() === 'error') console.log('[CONSOLE]', m.text().slice(0, 150)) })

async function fillHydrated(locator, value) {
  for (let i = 0; i < 12; i++) {
    await locator.click(); await locator.fill(''); await locator.fill(value)
    if ((await locator.inputValue()) === value) return
    await new Promise((r) => setTimeout(r, 700))
  }
  throw new Error('fill never stuck')
}

await page.goto(`${BASE}/login`)
await fillHydrated(page.locator('#username'), 'beheshti.s1')
await fillHydrated(page.locator('#password'), 'Pass@123')
await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
await page.click('button[type="submit"]')
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 })
await page.waitForSelector('[aria-label="جست‌وجو"]', { timeout: 15000 })
await page.locator('ul.divide-y > li button', { hasText: 'ریاضی' }).first().click()
await page.waitForURL((u) => /\/chats\/group\//.test(u.pathname), { timeout: 15000 })
await page.waitForTimeout(2500)

const composer = page.locator('textarea').first()
console.log('composer count:', await composer.count())
console.log('canSend meta text:', await page.locator('text=مجاز نیست').count())
await fillHydrated(composer, 'دیباگ ارسال ' + Date.now())
const btn = page.locator('button[aria-label="ارسال"]')
console.log('send btn count:', await btn.count(), '| disabled:', await btn.isDisabled().catch((e) => 'ERR:' + e.message))
await btn.click()
await page.waitForTimeout(3500)
const lastBubble = await page.locator('[class*="bubble"], [data-status], div:has-text("دیباگ ارسال")').allTextContents().catch(() => [])
console.log('bubbles with msg:', lastBubble.slice(0, 2))
await browser.close()
