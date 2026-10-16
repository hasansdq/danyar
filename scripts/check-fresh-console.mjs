// بررسی کنسول در بازدید تازه — آیا نشان «Issue» ناشی از خطای واقعی است یا نویز تست‌های قبلی؟
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const browser = await chromium.launch()
const page = await browser.newPage()
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
page.on('pageerror', e => errs.push('PAGEERROR: ' + String(e).slice(0, 140)))

await page.goto('http://localhost:81/superadmin', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
console.log('superadmin fresh-load console errors:', errs.length)
errs.forEach(e => console.log('  -', e))

errs.length = 0
// ورود و بازدید پنل
await page.locator('input[name="username"]').fill('superadmin')
await page.locator('input[name="password"]').fill('Admin@1234')
await page.locator('[role="checkbox"]').first().click()
await page.locator('button[type="submit"]').first().click()
await page.waitForURL('**/admin**', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(4000)
console.log('admin after-login console errors:', errs.length)
errs.forEach(e => console.log('  -', e))
await page.screenshot({ path: '/home/z/my-project/download/138-fresh-admin-no-issue.png' })
await browser.close()
