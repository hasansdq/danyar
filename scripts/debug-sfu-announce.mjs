import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const BASE = 'http://localhost:81'
const CLASSROOM = 'cmv1aryqw000alokrajw9ermw'
const NOTIFY_GROUP = 'cmv1aryqy000elokrx43nz39n'

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 200)) })
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))
page.on('request', (r) => { if (r.url().includes('/api/live-sessions')) console.log('[req]', r.method(), r.url().replace(BASE, '')) })
page.on('response', (r) => { if (r.url().includes('/api/live-sessions')) console.log('[res]', r.status(), r.url().replace(BASE, '')) })

// login
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#username', 'beheshti.t1')
await page.fill('#password', 'Pass@123')
const robot = page.locator('#notRobot, [role="checkbox"]').first()
for (let i = 0; i < 10; i++) {
  try { if ((await robot.getAttribute('aria-checked')) !== 'true') await robot.click(); else break } catch {}
  await page.waitForTimeout(300)
}
await page.click('button[type="submit"]')
await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 30000 })

const createRes = await page.request.post(`${BASE}/api/live-sessions`, {
  data: { classroomId: CLASSROOM, notifyGroupId: NOTIFY_GROUP, title: 'تشخیصی announce' },
})
const created = await createRes.json()
console.log('created:', created?.id ?? created)
const sessionId = created?.session?.id ?? created?.id

await page.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-tile-self]', { timeout: 45000 })
console.log('in-room ✓')
await page.waitForTimeout(12000)
// وضعیت بنرها و رسانه
const state = await page.evaluate(() => {
  const banners = [...document.querySelectorAll('div')].filter((d) => d.className?.includes?.('border-b')).map((d) => d.textContent?.slice(0, 120))
  const vids = [...document.querySelectorAll('video')].map((v) => ({ hasStream: v.srcObject instanceof MediaStream, tracks: v.srcObject?.getVideoTracks?.().length ?? 0 }))
  return { banners: banners.filter(Boolean).slice(-5), vids, toast: [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent?.slice(0, 120)) }
})
console.log(JSON.stringify(state, null, 1))
await browser.close()
