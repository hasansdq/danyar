/** اسکرین‌شات‌های تأیید پس‌زمینه چت روشن/تیره */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const LIGHT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqsvPFwAEwAGjSWDiAAAAAElFTkSuQmCC',
  'base64',
)
const DARK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNko2X/PwAEgAGKSUVvAAAAAElFTkSuQmCC',
  'base64',
)

async function login(page, username, password, realm = 'app') {
  const path = realm === 'super' ? '/superadmin' : '/login'
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="splash-screen"]', { state: 'detached', timeout: 9000 }).catch(() => {})
  await page.waitForTimeout(500)
  await page.fill('#username', username)
  await page.fill('#password', password)
  const robot = page.locator('#notRobot, [role="checkbox"]').first()
  for (let i = 0; i < 15; i++) {
    try {
      if ((await robot.getAttribute('aria-checked')) !== 'true') await robot.click()
      else break
    } catch { await robot.click().catch(() => {}) }
    await sleep(400)
  }
  await page.click('button[type="submit"]')
  for (let i = 0; i < 50; i++) {
    if (!page.url().includes(path)) return
    await sleep(500)
  }
  throw new Error('login failed')
}

const browser = await chromium.launch()
try {
  // پنل با دو بخش
  const su = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 1400 }, colorScheme: 'light' })
  const p = await su.newPage()
  await login(p, 'superadmin', 'Admin@1234', 'super')
  await p.goto(`${BASE}/admin/appearance`, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('text=پس‌زمینه حالت روشن', { timeout: 30000 })
  // آپلود دو تصویر از UI برای اسکرین‌شات واقعی
  await p.locator('input[type="file"]').nth(1).setInputFiles({ name: 'l.png', mimeType: 'image/png', buffer: LIGHT_PNG })
  await p.getByText('پس‌زمینه چت (حالت روشن) فعال شد').waitFor({ timeout: 15000 })
  await p.locator('input[type="file"]').nth(2).setInputFiles({ name: 'd.png', mimeType: 'image/png', buffer: DARK_PNG })
  await p.getByText('پس‌زمینه چت (حالت تیره) فعال شد').waitFor({ timeout: 15000 })
  await p.waitForTimeout(600)
  await p.screenshot({ path: 'download/chatbg-panel-two-sections.png', fullPage: false })
  await p.locator('div.rounded-lg.border', { hasText: 'پس‌زمینه حالت روشن' }).scrollIntoViewIfNeeded()
  await p.waitForTimeout(400)
  await p.screenshot({ path: 'download/chatbg-panel-closeup.png' })
  await su.close()

  // چت موبایل در دو حالت
  const t = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true })
  const tp = await t.newPage()
  await login(tp, 'beheshti.t1', 'Pass@123')
  await tp.evaluate(() => localStorage.setItem('theme', 'light'))
  await tp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await tp.waitForTimeout(1200)
  await tp.waitForSelector('ul.divide-y li button', { timeout: 25000 })
  await tp.locator('ul.divide-y li button').first().click()
  await tp.waitForSelector('.chat-messages-bg', { timeout: 20000 })
  await tp.waitForTimeout(800)
  await tp.screenshot({ path: 'download/chatbg-mobile-light.png' })
  // سوییچ به تیره با دکمه واقعی (خروج از چت → هدر خانه)
  const chatUrl = tp.url()
  await tp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await tp.waitForTimeout(900)
  await tp.locator('button[aria-label="تغییر حالت روشن و تاریک"]').first().click()
  await sleep(700)
  await tp.goto(chatUrl, { waitUntil: 'domcontentloaded' })
  await tp.waitForSelector('.chat-messages-bg', { timeout: 20000 })
  await tp.waitForTimeout(800)
  await tp.screenshot({ path: 'download/chatbg-mobile-dark.png' })

  // پاک‌سازی
  const su2 = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } })
  const p2 = await su2.newPage()
  await login(p2, 'superadmin', 'Admin@1234', 'super')
  await p2.request.patch(`${BASE}/api/admin/branding`, {
    headers: { 'Content-Type': 'application/json' },
    data: { chatBgKey: null, chatBgDarkKey: null },
  })
  console.log('cleanup done')
} finally {
  await browser.close()
}
