import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const BASE = process.env.TEST_BASE || 'http://localhost:81'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('response', (r) => {
  if (r.url().includes('/api/auth') || r.url().includes('/login')) {
    console.log('>>', r.request().method(), r.url(), r.status())
  }
})
page.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 150)))
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#username', { timeout: 60000 })
await page.fill('#username', 'beheshti.admin')
await page.fill('#password', 'Pass@123')
await page.click('button[role="checkbox"][aria-label="من ربات نیستم"]')
const checked = await page.getAttribute('button[role="checkbox"][aria-label="من ربات نیستم"]', 'aria-checked')
console.log('robot checkbox aria-checked =', checked)
await page.click('button[type="submit"]')
await page.waitForTimeout(6000)
console.log('URL now:', page.url())
await page.screenshot({ path: '/home/z/my-project/download/debug-login.png', fullPage: true })
const err = await page.locator('p.text-destructive').textContent().catch(() => null)
console.log('error text:', err)
await browser.close()
