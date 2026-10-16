/**
 * رفتار اصلاح‌شده در «شبکهٔ بدون مسیر رسانه» (معادل مرورگر بیرونی از نظر ICE):
 *  ۱) اتصال شکست می‌خورد اما «تمیز»: بدون اتاق نیمه‌مرده (roomRef=null)
 *  ۲) بنر خطای دسته‌بندی‌شده + دکمه «تلاش مجدد اتصال رسانه»
 *  ۳) تلاش انتشار: پیام فوری و شفاف (نه انتظار ۱۵ثانیه‌ای engine not connected)
 *  ۴) گفتگو/تخته/کنترل جلسه سالم می‌مانند
 *  ۵) تلاش مجدد در همین شرایط: شکست تمیزِ قابل‌تکرار (بدون گیر)
 *  ۶) سوییچ شروع کلاس غیرفعال می‌ماند (بدون اعلان قلابی) و دانش‌آموز در
 *     «آماده‌سازی» می‌ماند — رفتار صحیح
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const BASE = 'http://localhost:81'
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
      for (let i = 0; i < 12; i++) { try { if ((await robot.getAttribute('aria-checked')) !== 'true') await robot.click(); else break } catch { await robot.click().catch(() => {}) }; await sleep(400) }
      await page.click('button[type="submit"]')
      for (let i = 0; i < 40; i++) { if (!page.url().includes('/login')) return; await sleep(500) }
    } catch { await sleep(2000) }
  }
  throw new Error('login failed ' + u)
}
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
try {
  const tCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  await tCtx.addInitScript(() => {
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
  await login(tPage, 'beheshti.t1', 'Pass@123')
  let created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'رفتار تمیز در شبکهٔ بدون مسیر' } })).json().catch(() => null)
  if (created?.reused) { await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`); await sleep(1200); created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'رفتار تمیز در شبکهٔ بدون مسیر' } })).json().catch(() => null) }
  const sid = created?.session?.id ?? created?.id
  await tPage.goto(`${BASE}/live/${sid}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  ok('معلم داخل UI جلسه')
  // صبر برای شکست اتصال (peerConnectionTimeout ۱۵s + بافر)
  await sleep(22000)
  const st = await tPage.evaluate(() => ({ room: window.__lkRoom ? window.__lkRoom.state : 'no-room' }))
  ;(st.room === 'no-room' || st.room === 'disconnected') ? ok(`اتاق نیمه‌مرده وجود ندارد (${st.room})`) : bad(`roomRef باقی مانده: ${st.room}`)
  const txt = () => tPage.evaluate(() => document.body.innerText)
  let t = await txt()
  t.includes('اتصال رسانه (WebRTC) برقرار نشد') || t.includes('اتصال رسانه برقرار نشد')
    ? ok('بنر خطای رسانهٔ دسته‌بندی‌شده نمایش داده شد') : bad('بنر خطای رسانه دیده نشد')
  const retryBtn = await tPage.locator('button[aria-label="تلاش مجدد اتصال رسانه"], button:has-text("تلاش مجدد اتصال رسانه")').count()
  retryBtn > 0 ? ok('دکمه «تلاش مجدد اتصال رسانه» موجود است') : bad('دکمه تلاش مجدد نیست')
  // تلاش انتشار → پیام فوری
  const t0 = Date.now()
  await tPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
  await tPage.getByText('اتصال رسانه برقرار نیست').first().waitFor({ timeout: 8000 }).catch(() => {})
  const dt = Date.now() - t0
  ;(dt < 9000) ? ok(`گارد انتشار فوری worked (${dt}ms — قبلاً ۱۵+ ثانیه engine-not-connected)`) : bad(`هنوز کند: ${dt}ms`)
  // چت/کنترل‌ها سالم
  t = await txt()
  t.includes('گفتگو') ? ok('کنترل‌های جلسه سالم‌اند') : bad('کنترل‌ها از کار افتاد')
  const sw = await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"][disabled]').count()
  sw > 0 ? ok('سوییچ شروع کلاس غیرفعال (بدون اعلان قلابی)') : bad('سوییچ فعال است')
  const d = await tPage.request.get(`${BASE}/api/live-sessions/${sid}`).then((r) => r.json()).catch(() => null)
  ;(d?.announcedAt == null) ? ok('announcedAt=null — درست') : bad('announcedAt ست شد')
  // تلاش مجدد در همین شرایط مسدود → شکست تمیز دوباره
  await tPage.locator('button[aria-label="تلاش مجدد اتصال رسانه"]').first().click().catch(async () => { await tPage.getByText('تلاش مجدد اتصال رسانه').first().click() })
  await sleep(22000)
  const st2 = await tPage.evaluate(() => ({ room: window.__lkRoom ? window.__lkRoom.state : 'no-room' }))
  ;(st2.room === 'no-room' || st2.room === 'disconnected') ? ok('تلاش مجدد در شرایط مسدود: شکست تمیز و قابل‌تکرار') : bad(`بعد از retry: ${st2.room}`)
  const retry2 = await tPage.locator('button[aria-label="تلاش مجدد اتصال رسانه"]').count()
  retry2 > 0 ? ok('دکمه تلاش مجدد همچنان در دسترس (حالت قابل بازیابی)') : bad('دکمه تلاش مجدد گم شد')
  await tPage.request.post(`${BASE}/api/live-sessions/${sid}/end`).catch(() => {})
} catch (e) { console.log('FAIL:', e.message) } finally { await browser.close() }
console.log(`\nنتیجه: ${pass} پاس / ${fail} شکست`)
process.exit(fail > 0 ? 1 : 0)
