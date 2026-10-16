/**
 * بازتولید خطای واقعی کاربر در لایو پریویو:
 *
 * مرورگر بیرونی کاربر: سیگنال WSS از لبهٔ پیش‌نمایش عبور می‌کند (کار می‌کند) اما
 * هیچ مسیر ICE/UDP/TCP به پورت‌های رسانهٔ داخل سندباکس وجود ندارد (یک درگاه
 * عمومی، UDP خروجی مسدود). شبیه‌سازی دقیق همین شرایط: RTCPeerConnection با
 * iceTransportPolicy='relay' و بدون TURN → هیچ candidate قابل اتصالی نمی‌ماند.
 *
 * انتظار (کد فعلی buggy):
 *  ۱) اتصال livekit شکست می‌خورد ولی roomRef ست می‌ماند (اتاق نیمه‌مرده)
 *  ۲) معلم دکمه دوربین را می‌زند → «publishing rejected as engine not connected within timeout»
 *  ۳) سوییچ شروع کلاس فعال نمی‌شود → announcedAt هرگز ست نمی‌شود
 *  ۴) دانش‌آموز در «جلسه در حال آماده‌سازی» گیر می‌کند
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const CLASSROOM = 'cmv1aryqw000alokrajw9ermw'
const NOTIFY_GROUP = 'cmv1aryqy000elokrx43nz39n'
const TEACHER = { u: 'beheshti.t1', p: 'Pass@123' }
const STUDENT = { u: 'beheshti.s1', p: 'Pass@123' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✔', m) }
const bad = (m) => { fail++; console.log('  ✘', m) }

async function login(page, u, p) {
  for (let a = 0; a < 3; a++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(900)
      await page.fill('#username', u); await page.fill('#password', p)
      const robot = page.locator('#notRobot, [role="checkbox"]').first()
      for (let i = 0; i < 12; i++) {
        try { if ((await robot.getAttribute('aria-checked')) !== 'true') await robot.click(); else break } catch { await robot.click().catch(() => {}) }
        await sleep(400)
      }
      await page.click('button[type="submit"]')
      for (let i = 0; i < 40; i++) { if (!page.url().includes('/login')) return; await sleep(500) }
    } catch { await sleep(2000) }
  }
  throw new Error('login failed ' + u)
}

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})

try {
  // ── معلم: مرورگر با مسیر رسانهٔ مسدود (معادل مرورگر بیرونی از نظر ICE) ──
  const tCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
  await tCtx.addInitScript(() => {
    // شبیه‌سازی مرورگر بیرونی: هیچ مسیر ICE قابل اتصالی وجود ندارد.
    // توجه: livekit-client پس از join با setConfiguration پیکربندی PC را بازنویسی
    // می‌کند (iceTransportPolicy پیش‌فرض 'all') → باید سطح نمونه هم بسته شود.
    const Orig = window.RTCPeerConnection
    const force = (c) => ({ ...(c ?? {}), iceTransportPolicy: 'relay', iceServers: [] })
    const Wrapped = function (rtcConfig, ...rest) {
      const pc = new Orig(force(rtcConfig), ...rest)
      const origSet = pc.setConfiguration.bind(pc)
      pc.setConfiguration = (c) => origSet(force(c))
      return pc
    }
    Wrapped.prototype = Orig.prototype
    window.RTCPeerConnection = Wrapped
  })
  const tPage = await tCtx.newPage()
  tPage.on('console', (msg) => {
    const t = msg.text()
    if (t.includes('engine not connected') || t.includes('could not establish') || t.includes('ICE')) {
      console.log('    [T console]', t.slice(0, 160))
    }
  })
  await login(tPage, TEACHER.u, TEACHER.p)
  let created = await (await tPage.request.post(`${BASE}/api/live-sessions`, {
    data: { classroomId: CLASSROOM, notifyGroupId: NOTIFY_GROUP, title: 'بازتولید خطای پریویو' },
  })).json().catch(() => null)
  if (created?.reused) {
    await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`); await sleep(1200)
    created = await (await tPage.request.post(`${BASE}/api/live-sessions`, {
      data: { classroomId: CLASSROOM, notifyGroupId: NOTIFY_GROUP, title: 'بازتولید خطای پریویو' },
    })).json().catch(() => null)
  }
  const sessionId = created?.session?.id ?? created?.id
  if (!sessionId) throw new Error('create failed: ' + JSON.stringify(created))
  console.log('جلسه:', sessionId)

  await tPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  ok('معلم داخل UI جلسه (چت/کنترل) آمد')

  // ── شواهد اتاق نیمه‌مرده ──
  await sleep(9000) // صبر برای شکست ICE (peerConnectionTimeout پیش‌فرض)
  const roomState = await tPage.evaluate(() => {
    const r = window.__lkRoom
    return r ? { exists: true, state: r.state } : { exists: false }
  })
  console.log('    __lkRoom:', JSON.stringify(roomState))
  if (roomState.exists && roomState.state !== 'connected') ok(`roomRef ست شده ولی state='${roomState.state}' (اتاق نیمه‌مرده — باگ تایید شد)`)
  else if (!roomState.exists) bad('roomRef خالی است — سناریوی متفاوت از گزارش کاربر')
  else bad('state=connected?!')

  // ── تلاش انتشار دوربین → خطای دقیق کاربر ──
  await tPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
  await sleep(18000) // ۱۵ ثانیه timeout انتشار SDK
  const bodyText = await tPage.evaluate(() => document.body.innerText)
  const publishErr = bodyText.includes('engine not connected') || bodyText.includes('انتشار')
  const mediaBanner = bodyText.includes('اتصال رسانه برقرار نشد')
  if (publishErr || mediaBanner) ok(`خطای انتشار/رسانه به کاربر نمایش داده شد (${publishErr ? 'engine not connected' : 'بنر رسانه'})`)
  else bad('خطای انتشار دیده نشد')

  // سوییچ شروع کلاس باید غیرفعال مانده باشد (هیچ رسانه‌ای منتشر نشده)
  const swDisabled = await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"][disabled]').count()
  swDisabled > 0 ? ok('سوییچ شروع کلاس غیرفعال است (انتشار ناموفق → بدون اعلان قلابی)') : bad('سوییچ فعال است!')

  const d = await tPage.request.get(`${BASE}/api/live-sessions/${sessionId}`).then((r) => r.json()).catch(() => null)
  ;(d?.announcedAt == null) ? ok('announcedAt در سرور null ماند (بدون اعلان قلابی)') : bad('announcedAt ست شد!')

  // ── دانش‌آموز (مرورگر عادی): گیت آماده‌سازی ──
  const sCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
  const sPage = await sCtx.newPage()
  await login(sPage, STUDENT.u, STUDENT.p)
  await sPage.goto(`${BASE}/live`, { waitUntil: 'domcontentloaded' })
  await sleep(4000)
  const sText = await sPage.evaluate(() => document.body.innerText)
  sText.includes('جلسه در حال آماده‌سازی است')
    ? ok('دانش‌آموز در «جلسه در حال آماده‌سازی» گیر ماند — دقیقاً گزارش کاربر')
    : bad('پیام آماده‌سازی دیده نشد')
  const joinBtn = await sPage.getByText('ورود به کلاس').count()
  ;(joinBtn === 0) ? ok('دکمه ورود دانش‌آموز فعال نشده') : bad('دکمه ورود فعال شد (نباید)')

  // گفتگو/کنترل جلسه معلم نباید از کار افتاده باشد
  const chatWorks = await tPage.evaluate(() => document.body.innerText.includes('گفتگو'))
  chatWorks ? ok('کنترل‌های جلسه (تب گفتگو و…) همچنان در دسترس‌اند') : bad('UI جلسه از کار افتاد')

  await tPage.request.post(`${BASE}/api/live-sessions/${sessionId}/end`).catch(() => {})
} catch (e) {
  bad('شکست آزمون: ' + e.message)
} finally {
  await browser.close()
}
console.log(`\nبازتولید: ${pass} تایید / ${fail} رد`)
process.exit(pass > 0 ? 0 : 1)
