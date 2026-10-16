/** اسکرین‌شات تأییدی: آمار مدرسه در «مدیریت مدرسه» + نشان اتصال زیر جستجو */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const browser = await chromium.launch({ headless: true })

async function login(ctx, username) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`)
  await p.fill('#username', username)
  await p.fill('#password', 'Pass@123')
  await p.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await p.click('button[type="submit"]')
  await p.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 })
  return p
}

try {
  // دسکتاپ مدیر مدرسه — آمار کامل
  const ctxM = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const pm = await login(ctxM, 'beheshti.admin')
  await pm.goto(`${BASE}/modir/classes`)
  await pm.locator('span.text-2xl').first().waitFor({ state: 'visible', timeout: 10000 })
  await pm.waitForTimeout(1500)
  await pm.screenshot({ path: '/home/z/my-project/download/122-modir-merged-dashboard.png' })
  await pm.close()

  // موبایل دانش‌آموز — فهرست گفتگوها با نشان «متصل»
  const ctxS = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const ps = await login(ctxS, 'beheshti.s1')
  await ps.evaluate(() => { localStorage.setItem('daniar-theme', 'dark'); localStorage.setItem('theme', 'dark') })
  await ps.goto(`${BASE}/`)
  await ps.locator('[role="status"][aria-label="اتصال برقرار است"]').waitFor({ state: 'visible', timeout: 20000 })
  await ps.waitForTimeout(1200)
  await ps.screenshot({ path: '/home/z/my-project/download/124-mobile-dark-chats.png' })
  await ps.close()
  console.log('done')
} finally {
  await browser.close()
}
