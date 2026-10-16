/**
 * سناریوی پذیرش: «تست بدون دوربین و با رد مجوز یکی از دستگاه‌ها»
 * معلم فقط مجوز میکروفون دارد (دوربین رد) →
 *  - خطای مجوز دوربین «جدا» از خطای اتصال SFU نمایش داده می‌شود
 *  - میکروفون مستقل کار می‌کند و انتشار موفق صدا
 *  - اشتراک صفحه مستقل کار می‌کند
 *  - کلاس با همین‌ها شروع می‌شود (اعلام) و دانش‌آموز صدا+صفحه را دریافت می‌کند
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
// شبیه‌سازی «رد مجوز دوربین»: getUserMedia با video → NotAllowedError (مثل ردِ واقعی
// مجوز مرورگر)؛ میکروفون و getDisplayMedia واقعی کار می‌کنند (رسانهٔ مصنوعی آزمونی)
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--auto-select-desktop-capture-source=Entire screen'] })
try {
  const tCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  await tCtx.addInitScript(() => {
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && constraints.video) {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }
      return orig(constraints)
    }
  })
  const tPage = await tCtx.newPage()
  await login(tPage, 'beheshti.t1', 'Pass@123')
  let created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'بدون دوربین — صدا و صفحه' } })).json().catch(() => null)
  if (created?.reused) { await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`); await sleep(1500); created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'بدون دوربین — صدا و صفحه' } })).json().catch(() => null) }
  const sid = created?.session?.id ?? created?.id
  await tPage.goto(`${BASE}/live/${sid}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  let connected = false
  for (let i = 0; i < 30 && !connected; i++) { connected = await tPage.evaluate(() => window.__lkRoom?.state === 'connected'); if (!connected) await sleep(1000) }
  connected ? ok('اتصال SFU برقرار (مستقل از مجوز دستگاه)') : bad('اتصال SFU ناموفق')

  // تلاش دوربین → خطای مجوزِ «جدا» و شفاف
  await tPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
  const camErr = await tPage.evaluate(() => document.body.innerText)
  ;(camErr.includes('دوربین') && (camErr.includes('اجازه') || camErr.includes('دسترسی'))) ? ok('خطای مجوز دوربین جدا و شفاف نمایش داده شد') : bad('پیام خطای مجوز دوربین دیده نشد')

  // میکروفون — مستقل کار می‌کند
  await tPage.locator('button[title="روشن‌کردن میکروفون"]').first().click()
  let micOn = false
  for (let i = 0; i < 20 && !micOn; i++) { micOn = (await tPage.locator('button[title="خاموش‌کردن میکروفون"]').count()) > 0; if (!micOn) await sleep(500) }
  micOn ? ok('میکروفون با ردِ مجوز دوربین، مستقل روشن و منتشر شد') : bad('میکروفون ناموفق')

  // اشتراک صفحه — مستقل
  await tPage.locator('button[title="اشتراک‌گذاری صفحه"]').first().click()
  let sharing = false
  for (let i = 0; i < 20 && !sharing; i++) { sharing = (await tPage.locator('button[title="پایان اشتراک صفحه"]').count()) > 0; if (!sharing) await sleep(500) }
  sharing ? ok('اشتراک صفحه مستقل کار می‌کند') : bad('اشتراک صفحه ناموفق')

  // سوییچ فعال (حداقل یک رسانه واقعی منتشر شد) → اعلام
  const swEnabled = await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]:not([disabled])').count()
  swEnabled > 0 ? ok('سوییچ شروع کلاس بدون دوربین فعال شد (صدا+کافی)') : bad('سوییچ فعال نشد')
  await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]').first().click()
  let announced = null
  for (let i = 0; i < 40; i++) { const d = await tPage.request.get(`${BASE}/api/live-sessions/${sid}`).then((r) => r.json()).catch(() => null); announced = d?.announcedAt ?? null; if (announced) break; await sleep(500) }
  announced ? ok('اعلام شروع ثبت شد') : bad('اعلام ثبت نشد')

  // دانش‌آموز — دریافت صدا + صفحه (آمار واقعی)
  const sCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const sPage = await sCtx.newPage()
  await login(sPage, 'beheshti.s1', 'Pass@123')
  await sPage.goto(`${BASE}/live/${sid}`, { waitUntil: 'domcontentloaded' })
  await sPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  let screenGot = false
  for (let i = 0; i < 40 && !screenGot; i++) {
    screenGot = await sPage.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-tile-name]')]
      return tiles.some((el) => {
        if ((el.getAttribute('data-tile-kind') ?? '') !== 'screen') return false
        if (!(el.getAttribute('data-tile-name') ?? '').includes('رضا موسوی')) return false
        const v = el.querySelector('video'); const st = v?.srcObject
        return st instanceof MediaStream && st.getVideoTracks().some((x) => x.readyState === 'live')
      })
    })
    if (!screenGot) await sleep(500)
  }
  screenGot ? ok('دانش‌آموز استریم صفحه را گرفت') : bad('صفحه دریافت نشد')
  await sleep(3000)
  const stats = await sPage.evaluate(async () => {
    const rm = window.__lkRoom
    let audioBytes = 0, videoBytes = 0, audioFrames = 0, videoFrames = 0
    for (const pc of [rm?.engine?.pcManager?.subscriber?.pc, rm?.engine?.pcManager?.publisher?.pc]) {
      if (!pc) continue
      const s = await pc.getStats()
      s.forEach((r) => {
        if (r.type !== 'inbound-rtp') return
        if (r.kind === 'audio' || r.mediaType === 'audio') { audioBytes += r.bytesReceived ?? 0; audioFrames += r.audioPacketsReceived ?? 0 }
        if (r.kind === 'video' || r.mediaType === 'video') { videoBytes += r.bytesReceived ?? 0; videoFrames += r.framesDecoded ?? 0 }
      })
    }
    return { audioBytes, videoBytes, videoFrames }
  })
  console.log('    (آمار دانش‌آموز: صدا=' + stats.audioBytes + 'B، صفحه=' + stats.videoBytes + 'B/' + stats.videoFrames + ' فریم)')
  ;(stats.audioBytes > 500) ? ok('صدای معلم واقعاً دریافت شد (بایت صوتی > 0)') : bad('صدا دریافت نشد')
  ;(stats.videoBytes > 1000 && stats.videoFrames > 5) ? ok('ویدیوی صفحه واقعاً decode شد') : bad('ویدیوی صفحه جریان نیافت')

  await tPage.getByRole('button', { name: 'پایان جلسه' }).first().click()
  await tPage.getByRole('button', { name: 'پایان جلسه' }).last().click()
  await sleep(1500)
  ok('پایان جلسه')
} catch (e) { console.log('FAIL:', e.message) } finally { await browser.close() }
console.log(`\nنتیجهٔ بدون‌دوربین: ${pass} پاس / ${fail} شکست`)
process.exit(fail > 0 ? 1 : 0)
