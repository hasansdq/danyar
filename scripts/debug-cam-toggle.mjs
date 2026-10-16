// پروب دیباگ: کلیک دکمه دوربین معلم — چه اتفاقی می‌افتد؟
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = 'http://localhost:81'
const API = 'http://localhost:3000'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function apiLogin(username, password = 'Pass@123') {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, realm: 'app' }),
  })
  return 'daniar_session=' + /daniar_session=([^;]+)/.exec(r.headers.get('set-cookie'))[1]
}
async function api(cookie, path, opts = {}) {
  const r = await fetch(`${API}${path}`, { ...opts, headers: { cookie, ...(opts.headers ?? {}) } })
  return { status: r.status, data: await r.json().catch(() => null) }
}

const t1Cookie = await apiLogin('beheshti.t1')
const lr = await api(t1Cookie, '/api/live-sessions')
for (const c of lr.data?.classrooms ?? []) {
  if (c.activeSession) await api(t1Cookie, `/api/live-sessions/${c.activeSession.id}/end`, { method: 'POST' })
}
const CLS7 = lr.data.classrooms.find((c) => c.name === 'هفتم۱').id
const GMATH7 = lr.data.classrooms.find((c) => c.name === 'هفتم۱').groups.find((g) => g.name === 'ریاضی هفتم۱').id
const created = await api(t1Cookie, '/api/live-sessions', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ classroomId: CLS7, notifyGroupId: GMATH7, title: 'پروب دوربین' }),
})
const SID = created.data.id
await api(t1Cookie, `/api/live-sessions/${SID}/announce`, { method: 'POST' })

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture', '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') console.log('console-error:', m.text().slice(0, 160)) })
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)))

await page.goto(`${BASE}/login`)
await page.fill('#username', 'beheshti.t1')
await page.fill('#password', 'Pass@123')
await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
await page.click('button[type="submit"]')
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 })
await page.goto(`${BASE}/live/${SID}`)
await page.waitForSelector('footer [aria-label="خروج از جلسه"]', { timeout: 25000 })
await sleep(2500)

const dump = async (tag) => {
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('footer [aria-label]')].map((e) => e.getAttribute('aria-label')))
  const toasts = await page.evaluate(() =>
    [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent ?? ''))
  const vids = await page.evaluate(() => {
    const v = [...document.querySelectorAll('video')]
    return v.map((x) => {
      const tile = x.closest('[data-tile-self]') ?? x.parentElement
      const tr = x.srcObject instanceof MediaStream ? x.srcObject.getVideoTracks() : []
      return {
        self: tile?.getAttribute('data-tile-self') === '1',
        live: tr[0] ? tr[0].readyState === 'live' : false,
        enabled: tr[0] ? tr[0].enabled : null,
      }
    })
  })
  console.log(`[${tag}] footer labels:`, JSON.stringify(labels))
  console.log(`[${tag}] toasts:`, JSON.stringify(toasts))
  console.log(`[${tag}] videos:`, JSON.stringify(vids))
}

await dump('قبل کلیک')
const camBtn = page.locator('[aria-label="خاموش‌کردن دوربین"]').first()
const cnt = await page.locator('[aria-label="خاموش‌کردن دوربین"]').count()
console.log('تعداد دکمه «خاموش‌کردن دوربین»:', cnt)
await camBtn.click()
console.log('کلیک انجام شد')
await sleep(1500)
await dump('بعد کلیک')

await browser.close()
await api(t1Cookie, `/api/live-sessions/${SID}/end`, { method: 'POST' })
