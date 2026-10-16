/** دیباگ: بعد از لاگین صفحه، آیا page.request احراز هویت می‌شود؟ فقط نام کوکی/وضعیت چاپ می‌شود. */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function probe(BASE) {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream'] })
  const ctx = await browser.newContext({ baseURL: BASE })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await page.fill('#username', 'beheshti.t1')
  await page.fill('#password', 'Pass@123')
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
    if (!page.url().includes('/login')) break
    await sleep(500)
  }
  const url = page.url()
  const cookies = (await ctx.cookies()).map((c) => ({ name: c.name, domain: c.domain, secure: c.secure, sameSite: c.sameSite }))
  const me = await page.request.get(`${BASE}/api/me`)
  const ls = await page.evaluate(() => Object.keys(localStorage))
  console.log(JSON.stringify({ BASE, finalUrl: url.replace(/([?&])(token|key)=[^&]*/g, '$1<redacted>'), cookies, meStatus: me.status(), localStorageKeys: ls }, null, 2))
  await browser.close()
}

await probe('http://127.0.0.1:81')
await probe('http://localhost:81')
