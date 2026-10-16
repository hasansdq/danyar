/** دیباگ متمرکز: صوت و اشتراک صفحه + وضعیت PCها از داخل مرورگر */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = 'http://localhost:81'
const API = 'http://localhost:3000'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function apiLogin(username) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'Pass@123', realm: 'app' }),
  })
  return 'daniar_session=' + /daniar_session=([^;]+)/.exec(r.headers.get('set-cookie'))[1]
}
async function api(cookie, path, opts = {}) {
  const r = await fetch(`${API}${path}`, { ...opts, headers: { cookie, ...(opts.headers ?? {}) } })
  return { status: r.status, data: await r.json().catch(() => null) }
}

const t1 = await apiLogin('beheshti.t1')
const lr = await api(t1, '/api/live-sessions')
for (const c of lr.data?.classrooms ?? []) if (c.activeSession) await api(t1, `/api/live-sessions/${c.activeSession.id}/end`, { method: 'POST' })

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture', '--autoplay-policy=no-user-gesture-required'],
})
const ctxT = await browser.newContext({ viewport: { width: 1366, height: 850 } })
const ctxS = await browser.newContext({ viewport: { width: 1280, height: 800 } })

async function login(ctx, username) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('#username', username)
  await page.fill('#password', 'Pass@123')
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 })
  return page
}

const pt = await login(ctxT, 'beheshti.t1')
await pt.goto(`${BASE}/live`)
await pt.waitForTimeout(1200)
const card7 = pt.locator('div.rounded-xl.border', { hasText: 'هفتم۱' }).first()
await card7.locator('button', { hasText: 'شروع جلسه' }).click()
await pt.waitForTimeout(600)
const dlg = pt.locator('[role="dialog"]')
await dlg.locator('#live-title').fill('دیباگ رسانه')
await dlg.locator('[role="combobox"]').click()
await pt.locator('[role="option"]', { hasText: 'ریاضی هفتم۱' }).click()
await dlg.locator('button', { hasText: 'شروع جلسه' }).click()
await pt.waitForURL('**/live/**', { timeout: 15000 })
await pt.waitForTimeout(2500)
const SID = new URL(pt.url()).pathname.split('/').pop()
console.log('session', SID)

const ps = await login(ctxS, 'beheshti.s1')
await ps.goto(`${BASE}/live/${SID}`)
await ps.waitForTimeout(4000)

console.log('\n── TEACHER PC state ──')
console.log(JSON.stringify(await pt.evaluate(() => window.__liveDebug?.()), null, 1).slice(0, 1800))
console.log('\n── STUDENT PC state ──')
console.log(JSON.stringify(await ps.evaluate(() => window.__liveDebug?.()), null, 1).slice(0, 1800))

// میکروفون معلم روشن
await pt.locator('button[title*="میکروفون"]').first().click()
await sleep(2000)
console.log('\n── after teacher mic on: STUDENT remote ──')
console.log(JSON.stringify(await ps.evaluate(() => window.__liveDebug?.().remote), null, 1))
const audCount = await ps.evaluate(() => document.querySelectorAll('audio').length)
console.log('student <audio> elements:', audCount)

// اشتراک صفحه معلم
await pt.locator('button[title*="اشتراک‌گذاری صفحه"]').first().click()
await sleep(3000)
console.log('\n── after share: TEACHER senders ──')
console.log(JSON.stringify(await pt.evaluate(() => window.__liveDebug?.().peers), null, 1).slice(0, 1200))
console.log('\n── after share: STUDENT remote ──')
console.log(JSON.stringify(await ps.evaluate(() => window.__liveDebug?.().remote), null, 1))

// تست توست محلی (اعتبارسنجی helper)
await ps.locator('button[aria-label*="دست"]').first().click()
await sleep(700)
const toasts = await ps.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent))
console.log('\nstudent toasts after hand raise:', JSON.stringify(toasts))

await browser.close()
process.exit(0)
