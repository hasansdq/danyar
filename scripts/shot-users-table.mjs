/**
 * اسکرین‌شات نزدیک از جدول فهرست کاربران (دسکتاپ + موبایل) + شکار خطاهای کنسول
 * اجرا: TEST_BASE=http://localhost:81 node scripts/shot-users-table.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const SHOT = '/home/z/my-project/download'

const browser = await chromium.launch({ headless: true })

async function grab(viewport, name, doLogin = true) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)))
  await page.goto(`${BASE}/superadmin`)
  if (doLogin) {
    await page.fill('input[name="username"]', 'superadmin')
    await page.fill('input[name="password"]', 'Admin@1234')
    await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
    await page.click('button[type="submit"]')
    await page.waitForLoadState('networkidle')
  }
  await page.goto(`${BASE}/admin/users`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(900)
  const table = page.locator('[data-slot="table"]').first()
  await table.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  // کادر «فهرست کاربران» کامل در قاب
  const card = page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="table"]') }).first()
  await card.screenshot({ path: `${SHOT}/${name}.png` })
  console.log(`${name}: shot done | console errors: ${errors.length}`)
  errors.slice(0, 5).forEach((e) => console.log('  [err]', e))
  await ctx.close()
}

await grab({ width: 1280, height: 800 }, '129-users-table-card-desktop')
await grab({ width: 390, height: 780 }, '130-users-table-card-mobile')

await browser.close()
