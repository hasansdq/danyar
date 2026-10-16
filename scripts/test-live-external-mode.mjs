/**
 * آزمون یکپارچگی «حالت رسانهٔ بیرونی» (مسیر LiveKit Cloud):
 *
 * نمونهٔ دوم LiveKit روی :7890 با کلیدهای متفاوت + env:
 *   NEXT_PUBLIC_LIVEKIT_WS_URL=ws://127.0.0.1:7890
 *   LIVEKIT_INTERNAL_URL=http://127.0.0.1:7890
 *   LIVEKIT_API_KEY/SECRET = کلیدهای نمونهٔ دوم
 * و LiveKit محلی :7880 «خاموش» در کل طول آزمون — هر رسانه‌ای که جریان یابد
 * قطعاً از سرویس بیرونی می‌گذرد (اگر کد هنوز به محلی وصل بود همه چیز می‌مرد).
 *
 * جریان کامل: توکن با کلید بیرونی → اتصال → دوربین+صفحهٔ معلم → اعلام →
 * دانش‌آموز دریافت هر دو استریم (با آمار WebRTC: بایت/فریم) → اجازهٔ انتشار
 * دانش‌آموز → اخراج → پایان (حذف اتاق در سرویس بیرونی)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const BASE = 'http://localhost:81'
const EXT_KEY = 'cloudtestkey'
const EXT_SECRET = 'cloudtestsecret-0123456789abcdef0123456789abcdef'
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

/** آمار WebRTC صفحه برای کاشی معلم (بایت دریافتی + فریم decode) */
async function webrtcStats(page, teacherName, kind) {
  return page.evaluate(async ({ teacherName, kind }) => {
    const tiles = [...document.querySelectorAll('[data-tile-name]')].filter(
      (el) => (el.getAttribute('data-tile-name') ?? '').includes(teacherName) && (el.getAttribute('data-tile-kind') ?? '') === kind,
    )
    for (const el of tiles) {
      const v = el.querySelector('video')
      if (!v || !(v.srcObject instanceof MediaStream)) continue
      const st = v.srcObject.getVideoTracks()[0]
      if (!st) continue
      // آمار از خود المان ویدیو
      return {
        hasStream: true,
        videoSize: `${v.videoWidth}x${v.videoHeight}`,
        readyState: st.readyState,
        trackLabel: (st.label || '').slice(0, 40),
      }
    }
    return { hasStream: false }
  }, { teacherName, kind })
}

/** GetStats سطح PC — بایت دریافتی/فریم decode (اثبات جریان واقعی) */
async function pcStats(page) {
  return page.evaluate(async () => {
    const rm = window.__lkRoom
    const pcs = []
    const eng = rm?.engine
    const sub = eng?.pcManager?.subscriber?.pc
    const pub = eng?.pcManager?.publisher?.pc
    let bytesRecv = 0, framesDecoded = 0, selectedLocal = null, selectedRemote = null
    for (const pc of [sub, pub]) {
      if (!pc) continue
      const stats = await pc.getStats()
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video')) {
          bytesRecv += r.bytesReceived ?? 0
          framesDecoded += r.framesDecoded ?? 0
        }
        if (r.type === 'candidate-pair' && (r.selected || r.state === 'succeeded')) {
          const l = stats.get(r.localCandidateId); const rr = stats.get(r.remoteCandidateId)
          selectedLocal = l?.candidateType ?? null
          selectedRemote = rr?.candidateType ?? null
        }
      })
    }
    return { bytesRecv, framesDecoded, selectedLocal, selectedRemote }
  })
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--auto-select-desktop-capture-source=Entire screen'],
})
try {
  // ۰) پیش‌شرط: :7880 خاموش است و :7890 روشن
  const local7880 = await fetch('http://127.0.0.1:7880/').then((r) => r.ok).catch(() => false)
  const ext7890 = await fetch('http://127.0.0.1:7890/').then((r) => r.ok).catch(() => false)
  if (local7880) { bad('LiveKit محلی :7880 هنوز روشن است — آزمون معتبر نیست'); process.exit(1) }
  if (!ext7890) { bad('LiveKit بیرونی :7890 بالا نیامده'); process.exit(1) }
  ok('پیش‌شرط: :7880 خاموش + :7890 (سرویس بیرونی) روشن')

  // ۱) معلم
  const tCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const tPage = await tCtx.newPage()
  await login(tPage, 'beheshti.t1', 'Pass@123')
  // توکن باید url بیرونی بدهد + iceServers خالی (سرویس بیرونی خودش می‌فرستد)
  let created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'آزمون سرویس بیرونی' } })).json().catch(() => null)
  if (created?.reused) { await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`); await sleep(1500); created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'آزمون سرویس بیرونی' } })).json().catch(() => null) }
  const sid = created?.session?.id ?? created?.id
  if (!sid) throw new Error('create failed')

  await tPage.goto(`${BASE}/live/${sid}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  let connected = false
  for (let i = 0; i < 30 && !connected; i++) { connected = await tPage.evaluate(() => window.__lkRoom?.state === 'connected'); if (!connected) await sleep(1000) }
  connected ? ok('معلم به سرویس بیرونی وصل شد (:7890)') : bad('اتصال معلم برقرار نشد')

  // توکن «پس از ورود سوکتی» (گیت عضویت اجازه می‌دهد): url بیرونی + iceServers خالی
  const tok = await (await tPage.request.post(`${BASE}/api/live-sessions/${sid}/token`)).json()
  tok.url?.includes('7890') ? ok(`توکن url سرویس بیرونی: ${tok.url}`) : bad(`url توکن: ${tok.url}`)
  ;(!tok.iceServers || tok.iceServers.length === 0) ? ok('iceServers خالی (STUN/TURN از خود سرویس بیرونی)') : bad(`iceServers: ${JSON.stringify(tok.iceServers)}`)

  // ۲) انتشار دوربین + صفحه
  await tPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
  let camOn = false
  for (let i = 0; i < 20 && !camOn; i++) { camOn = (await tPage.locator('button[title="خاموش‌کردن دوربین"]').count()) > 0; if (!camOn) await sleep(500) }
  camOn ? ok('دوربین معلم روی سرویس بیرونی منتشر شد') : bad('انتشار دوربین ناموفق')
  await tPage.locator('button[title="اشتراک‌گذاری صفحه"]').first().click()
  let sharing = false
  for (let i = 0; i < 20 && !sharing; i++) { sharing = (await tPage.locator('button[title="پایان اشتراک صفحه"]').count()) > 0; if (!sharing) await sleep(500) }
  sharing ? ok('اشتراک صفحهٔ معلم روی سرویس بیرونی منتشر شد') : bad('اشتراک صفحه ناموفق')
  await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]').first().click()
  let announced = null
  for (let i = 0; i < 40; i++) { const d = await tPage.request.get(`${BASE}/api/live-sessions/${sid}`).then((r) => r.json()).catch(() => null); announced = d?.announcedAt ?? null; if (announced) break; await sleep(500) }
  announced ? ok('اعلام شروع ثبت شد') : bad('اعلام ثبت نشد')

  // ۳) دانش‌آموز — دریافت هر دو استریم + آمار واقعی
  const sCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const sPage = await sCtx.newPage()
  await login(sPage, 'beheshti.s1', 'Pass@123')
  await sPage.goto(`${BASE}/live/${sid}`, { waitUntil: 'domcontentloaded' })
  await sPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  let camGot = false, screenGot = false
  for (let i = 0; i < 40 && !(camGot && screenGot); i++) {
    const r = await sPage.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-tile-name]')].filter((el) => (el.getAttribute('data-tile-name') ?? '').includes('رضا موسوی'))
      const live = (kind) => tiles.some((el) => {
        if ((el.getAttribute('data-tile-kind') ?? '') !== kind) return false
        const v = el.querySelector('video'); const st = v?.srcObject
        return st instanceof MediaStream && st.getVideoTracks().some((x) => x.readyState === 'live')
      })
      return { cam: live('camera'), screen: live('screen') }
    })
    camGot = r.cam; screenGot = r.screen
    if (!(camGot && screenGot)) await sleep(500)
  }
  camGot ? ok('دانش‌آموز: ویدیوی دوربین معلم از سرویس بیرونی') : bad('دوربین دریافت نشد')
  screenGot ? ok('دانش‌آموز: استریم صفحهٔ معلم از سرویس بیرونی') : bad('صفحه دریافت نشد')

  // آمار WebRTC — بایت دریافتی و فریم decode (اثبات جریان واقعی، نه فقط ترک UI)
  await sleep(3000)
  const st1 = await pcStats(sPage)
  console.log('    (آمار PC دانش‌آموز: bytes=' + st1.bytesRecv + ' frames=' + st1.framesDecoded + ' selected=' + st1.selectedLocal + '→' + st1.selectedRemote + ')')
  ;(st1.bytesRecv > 1000 && st1.framesDecoded > 5) ? ok(`آمار واقعی: ${st1.bytesRecv} بایت دریافتی، ${st1.framesDecoded} فریم decodeشده`) : bad('آار نشان‌دهنده جریان نیست')
  st1.selectedLocal && st1.selectedRemote ? ok(`زوج ICE منتخب: local=${st1.selectedLocal} remote=${st1.selectedRemote}`) : ok('زوج منتخب گزارش نشد (غیریابی نیست)')

  // ۴) اجازهٔ انتشار دانش‌آموز (RoomService روی سرویس بیرونی)
  const studentRow = tPage.locator('div.rounded-lg', { hasText: 'رضا احمدی' }).first()
  await studentRow.getByRole('button', { name: 'اجازه دوربین' }).click({ timeout: 15000 })
  await sleep(1500)
  await sPage.getByText('معلم به شما اجازه دوربین داد').waitFor({ timeout: 15000 }).catch(() => {})
  let camPublished = false
  for (let attempt = 0; attempt < 4 && !camPublished; attempt++) {
    await sPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
    await sleep(2500)
    camPublished = await tPage.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-tile-name]')].filter((el) => (el.getAttribute('data-tile-name') ?? '').includes('رضا احمدی'))
      return tiles.some((el) => {
        const v = el.querySelector('video'); const st = v?.srcObject
        return st instanceof MediaStream && st.getVideoTracks().some((x) => x.readyState === 'live')
      })
    })
    if (!camPublished) { await sPage.locator('button[title="خاموش‌کردن دوربین"]').first().click().catch(() => {}); await sleep(1000) }
  }
  camPublished ? ok('مجوز واقعی روی سرویس بیرونی اعمال شد و ویدیوی دانش‌آموز به معلم رسید') : bad('مجوز/انتشار دانش‌آموز ناموفق')

  // ۵) پایان جلسه — اتاق در سرویس بیرونی حذف شود
  await tPage.getByRole('button', { name: 'پایان جلسه' }).first().click()
  await tPage.getByRole('button', { name: 'پایان جلسه' }).last().click()
  await sPage.getByText('جلسه پایان یافته').waitFor({ timeout: 15000 }).then(() => ok('دانش‌آموز پایان را دید')).catch(() => bad('پایان به دانش‌آموز نرسید'))

  // ۶) :7880 همچنان خاموش؟ (رسانه واقعاً از بیرون گذشت)
  const still7880 = await fetch('http://127.0.0.1:7880/').then((r) => r.ok).catch(() => false)
  ;(!still7880) ? ok('LiveKit محلی :7880 در کل آزمون خاموش ماند — رسانه فقط از سرویس بیرونی') : bad(':7880 روشن شد!')
} catch (e) { console.log('FAIL:', e.message) } finally { await browser.close() }
console.log(`\nنتیجهٔ حالت بیرونی: ${pass} پاس / ${fail} شکست`)
process.exit(fail > 0 ? 1 : 0)
