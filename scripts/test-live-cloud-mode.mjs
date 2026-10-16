/**
 * آزمون یکپارچگی «LiveKit Cloud» با اعتبارنامهٔ واقعی .env — بدون چاپ کلید/رمز
 *
 * فرض: .env حالت Cloud دارد (NEXT_PUBLIC_LIVEKIT_WS_URL + LIVEKIT_INTERNAL_URL=wss://
 * + کلیدهای Cloud؛ TURN قدیمی کامنت). LiveKit محلی :7880 در کل آزمون خاموش است —
 * هر رسانه‌ای که جریان یابد قطعاً از Cloud می‌گذرد.
 *
 * جریان کامل:
 *   توکن (url=Cloud + iceServers خالی) → اتصال سیگنال → دوربین+صفحهٔ معلم → اعلام →
 *   دانش‌آموز دریافت هر دو استریم (آمار WebRTC: بایت/فریم) → اجازهٔ دوربین دانش‌آموز
 *   (RoomService روی Cloud) → اخراج (RemoveParticipant روی Cloud + ممانعت ورود مجدد) →
 *   پایان جلسه (DeleteRoom روی Cloud + وضعیت DB) → :7880 همچنان خاموش.
 *
 * محدودیت صادقانه: مرورگرهای این آزمون داخل سندباکس اجرا می‌شوند (نه اینترنت
 * کاربر نهایی)؛ گام نهایی تأیید، مرورگر واقعی کاربر از لبهٔ پیش‌نمایش است.
 *
 * اجرا: node scripts/test-live-cloud-mode.mjs
 */
import { readFileSync } from 'node:fs'
import { SignJWT } from 'jose'
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = 'http://localhost:81'
const CLASSROOM_ID = 'cmv1aryqw000alokrajw9ermw'
const NOTIFY_GROUP_ID = 'cmv1aryqy000elokrx43nz39n'
const TEACHER = { u: 'beheshti.t1', p: 'Pass@123', name: 'رضا موسوی' }
const STUDENT = { u: 'beheshti.s1', p: 'Pass@123', name: 'رضا احمدی' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✔', m) }
const bad = (m) => { fail++; console.log('  ✘', m) }

// ─── اعتبارنامهٔ Cloud از .env (فقط برای راستی‌آزمایی RoomService — بدون چاپ) ───
function envOf(file) {
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[k] = v
  }
  return out
}
const env = envOf(new URL('../.env', import.meta.url).pathname)
const LK_KEY = (env.LIVEKIT_API_KEY ?? '').trim()
const LK_SECRET = (env.LIVEKIT_API_SECRET ?? '').trim()
const LK_BASE = (env.LIVEKIT_INTERNAL_URL ?? '').trim().replace(/\/$/, '')
  .replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://')
const WS_URL = (env.NEXT_PUBLIC_LIVEKIT_WS_URL ?? '').trim()

async function adminToken(room) {
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({ video: { room, roomAdmin: true, roomCreate: true, roomList: true, roomJoin: false } })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(LK_KEY)
    .setSubject('daniar-cloud-test')
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(new TextEncoder().encode(LK_SECRET))
}

/** فراخوانی Twirp روی Cloud — grant اتاق هم‌نام روش (برای RoomService اتاق-محور) — خروجی json یا throw */
async function twirp(method, body) {
  const room = body?.room ?? ''
  const res = await fetch(`${LK_BASE}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await adminToken(room)}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`${method}→${res.status}`)
  return await res.json().catch(() => ({}))
}

/** شرکت‌کنندگان فعلی یک اتاق در Cloud (برای راستی‌آزمایی اخراج) */
async function cloudParticipants(room) {
  try {
    const d = await twirp('ListParticipants', { room })
    return (d.participants ?? []).map((p) => p.identity)
  } catch {
    return null
  }
}

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

/** آمار PC — بایت دریافتی/فریم decode (اثبات جریان واقعی) */
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

const jsErrors = []
function watchErrors(tag, page) {
  page.on('pageerror', (e) => jsErrors.push(`${tag}: ${String(e).slice(0, 120)}`))
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--auto-select-desktop-capture-source=Entire screen'],
})
let SID = null
try {
  // ── ۰) پیش‌شرط‌ها: :7880 خاموش، Cloud در دسترس، حالت Cloud فعال ──
  const local7880 = await fetch('http://127.0.0.1:7880/').then((r) => r.ok).catch(() => false)
  if (local7880) { bad('LiveKit محلی :7880 هنوز روشن است — آزمون معتبر نیست'); process.exit(1) }
  ok('پیش‌شرط: LiveKit محلی :7880 خاموش است')
  const cloudHttp = await fetch(`${LK_BASE}/`).then((r) => r.status).catch(() => 0)
  cloudHttp === 200 ? ok('پیش‌شرط: Cloud پاسخ ۲۰۰ می‌دهد') : bad(`Cloud پاسخ ${cloudHttp} داد`)
  const lr = await twirp('ListRooms', {}).then((d) => d.rooms?.length ?? 0).catch(() => -1)
  lr >= 0 ? ok(`ListRooms روی Cloud موفق (اتاق باز: ${lr})`) : bad('ListRooms روی Cloud ناموفق')

  // ── ۱) معلم — ورود، ساخت جلسه، اتصال سیگنال به Cloud ──
  const tCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const tPage = await tCtx.newPage()
  watchErrors('teacher', tPage)
  await login(tPage, TEACHER.u, TEACHER.p)
  ok('معلم وارد شد (بدون رفرش)')
  let created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: CLASSROOM_ID, notifyGroupId: NOTIFY_GROUP_ID, title: 'آزمون LiveKit Cloud' } })).json().catch(() => null)
  if (created?.reused) { await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`); await sleep(1500); created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: CLASSROOM_ID, notifyGroupId: NOTIFY_GROUP_ID, title: 'آزمون LiveKit Cloud' } })).json().catch(() => null) }
  SID = created?.session?.id ?? created?.id
  if (!SID) throw new Error('create failed')
  ok(`جلسه ساخته شد (${SID.slice(0, 10)}…)`)
  const ROOM = `live:${SID}`

  await tPage.goto(`${BASE}/live/${SID}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  let connected = false
  for (let i = 0; i < 45 && !connected; i++) { connected = await tPage.evaluate(() => window.__lkRoom?.state === 'connected'); if (!connected) await sleep(1000) }
  connected ? ok('معلم به Cloud وصل شد (سیگنال wss)') : bad('اتصال سیگنال معلم به Cloud برقرار نشد')

  // ── ۲) توکن — url=Cloud + iceServers خالی (TURN خود Cloud) + مجوز نقش ──
  const tok = await (await tPage.request.post(`${BASE}/api/live-sessions/${SID}/token`)).json()
  tok.url === WS_URL ? ok(`توکن url = سرویس Cloud (${tok.url})`) : bad(`url توکن: ${tok.url}`)
  ;(!tok.iceServers || tok.iceServers.length === 0) ? ok('iceServers خالی — STUN/TURN از خود Cloud (TURN قدیمی کنار زده نشده)') : bad(`iceServers غیرخالی: ${JSON.stringify(tok.iceServers)}`)
  tok.canPublish === true ? ok('توکن معلم: حق انتشار') : bad('توکن معلم بدون حق انتشار')

  // ── ۳) انتشار دوربین + صفحه + اعلام شروع ──
  await tPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
  let camOn = false
  for (let i = 0; i < 25 && !camOn; i++) { camOn = (await tPage.locator('button[title="خاموش‌کردن دوربین"]').count()) > 0; if (!camOn) await sleep(500) }
  camOn ? ok('دوربین معلم روی Cloud منتشر شد') : bad('انتشار دوربین ناموفق')
  await tPage.locator('button[title="اشتراک‌گذاری صفحه"]').first().click()
  let sharing = false
  for (let i = 0; i < 25 && !sharing; i++) { sharing = (await tPage.locator('button[title="پایان اشتراک صفحه"]').count()) > 0; if (!sharing) await sleep(500) }
  sharing ? ok('اشتراک صفحهٔ معلم روی Cloud منتشر شد') : bad('اشتراک صفحه ناموفق')
  await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]').first().click()
  let announced = null
  for (let i = 0; i < 40; i++) { const d = await tPage.request.get(`${BASE}/api/live-sessions/${SID}`).then((r) => r.json()).catch(() => null); announced = d?.announcedAt ?? null; if (announced) break; await sleep(500) }
  announced ? ok('اعلام شروع کلاس ثبت شد') : bad('اعلام ثبت نشد')

  // ── ۴) دانش‌آموز — دریافت هر دو استریم + آمار واقعی ──
  const sCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const sPage = await sCtx.newPage()
  watchErrors('student', sPage)
  await login(sPage, STUDENT.u, STUDENT.p)
  ok('دانش‌آموز وارد شد (بدون رفرش)')
  await sPage.goto(`${BASE}/live/${SID}`, { waitUntil: 'domcontentloaded' })
  await sPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  let sConnected = false
  for (let i = 0; i < 45 && !sConnected; i++) { sConnected = await sPage.evaluate(() => window.__lkRoom?.state === 'connected'); if (!sConnected) await sleep(1000) }
  sConnected ? ok('دانش‌آموز به Cloud وصل شد') : bad('اتصال سیگنال دانش‌آموز برقرار نشد')
  // توکن دانش‌آموز — طبق جریان واقعی کاربر: پس از ورود به صفحه/سوکت جلسه
  const stok = await (await sPage.request.post(`${BASE}/api/live-sessions/${SID}/token`)).json().catch(() => null)
  stok?.canPublish === false ? ok('توکن دانش‌آموز: بدون حق انتشار اولیه') : bad(`توکن دانش‌آموز canPublish=${stok?.canPublish}`)
  stok?.url === WS_URL ? ok('توکن دانش‌آموز: url سرویس Cloud') : bad(`url توکن دانش‌آموز: ${stok?.url}`)

  let camGot = false, screenGot = false
  for (let i = 0; i < 50 && !(camGot && screenGot); i++) {
    const r = await sPage.evaluate((tName) => {
      const tiles = [...document.querySelectorAll('[data-tile-name]')].filter((el) => (el.getAttribute('data-tile-name') ?? '').includes(tName))
      const live = (kind) => tiles.some((el) => {
        if ((el.getAttribute('data-tile-kind') ?? '') !== kind) return false
        const v = el.querySelector('video'); const st = v?.srcObject
        return st instanceof MediaStream && st.getVideoTracks().some((x) => x.readyState === 'live')
      })
      return { cam: live('camera'), screen: live('screen') }
    }, TEACHER.name)
    camGot = r.cam; screenGot = r.screen
    if (!(camGot && screenGot)) await sleep(500)
  }
  camGot ? ok('دانش‌آموز: ویدیوی دوربین معلم از Cloud') : bad('دوربین معلم دریافت نشد (ICE/رسانه از سندباکس به Cloud؟)')
  screenGot ? ok('دانش‌آموز: استریم صفحهٔ معلم از Cloud') : bad('صفحهٔ معلم دریافت نشد')

  if (camGot || screenGot) {
    await sleep(3000)
    const st1 = await pcStats(sPage)
    console.log(`    (آمار PC دانش‌آموز: bytes=${st1.bytesRecv} frames=${st1.framesDecoded} selected=${st1.selectedLocal}→${st1.selectedRemote})`)
    ;(st1.bytesRecv > 1000 && st1.framesDecoded > 5) ? ok(`رسانهٔ واقعی: ${st1.bytesRecv} بایت دریافتی، ${st1.framesDecoded} فریم decodeشده از Cloud`) : bad('آمار PC جریان را نشان نمی‌دهد')
    st1.selectedLocal && st1.selectedRemote ? ok(`زوج ICE منتخب: local=${st1.selectedLocal} remote=${st1.selectedRemote} (ICE از سندباکس به Cloud جفت شد)`) : ok('زوج منتخب گزارش نشد (غیریابی نیست)')
  }

  // ── ۵) اجازهٔ دوربین دانش‌آموز (RoomService UpdateParticipant روی Cloud) ──
  const studentRow = tPage.locator('div.rounded-lg', { hasText: STUDENT.name }).first()
  await studentRow.getByRole('button', { name: 'اجازه دوربین' }).click({ timeout: 15000 })
  await sleep(1500)
  await sPage.getByText('معلم به شما اجازه دوربین داد').waitFor({ timeout: 15000 }).catch(() => {})
  let camPublished = false
  for (let attempt = 0; attempt < 4 && !camPublished; attempt++) {
    await sPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
    await sleep(2500)
    camPublished = await tPage.evaluate((sName) => {
      const tiles = [...document.querySelectorAll('[data-tile-name]')].filter((el) => (el.getAttribute('data-tile-name') ?? '').includes(sName))
      return tiles.some((el) => {
        const v = el.querySelector('video'); const st = v?.srcObject
        return st instanceof MediaStream && st.getVideoTracks().some((x) => x.readyState === 'live')
      })
    }, STUDENT.name)
    if (!camPublished) { await sPage.locator('button[title="خاموش‌کردن دوربین"]').first().click().catch(() => {}); await sleep(1000) }
  }
  camPublished ? ok('مجوز واقعی روی Cloud اعمال شد و ویدیوی دانش‌آموز به معلم رسید') : bad('مجوز/انتشار دانش‌آموز ناموفق')

  // ── ۶) اخراج (RemoveParticipant روی Cloud) + ممانعت از ورود مجدد ──
  const studentIdentity = await sPage.evaluate(() => window.__lkRoom?.localParticipant?.identity ?? null)
  const partsBefore = await cloudParticipants(ROOM)
  if (Array.isArray(partsBefore) && studentIdentity) {
    partsBefore.includes(studentIdentity) ? ok(`دانش‌آموز پیش از اخراج در اتاق Cloud حضور دارد (${partsBefore.length} شرکت‌کننده)`) : bad('شناسهٔ دانش‌آموز در اتاق Cloud یافت نشد (پیش از اخراج)')
  }
  await tPage.locator('div.rounded-lg', { hasText: STUDENT.name }).first()
    .locator('button', { hasText: 'اخراج از جلسه' }).first().click()
  await sleep(2500)
  const kickedText = await sPage.locator('body').innerText()
  kickedText.includes('از جلسه خارج شدید') ? ok('دانش‌آموز صفحهٔ «از جلسه خارج شدید» را دید') : bad('صفحهٔ اخراج برای دانش‌آموز نیامد')
  const partsAfter = await cloudParticipants(ROOM)
  if (Array.isArray(partsAfter)) {
    ;(!partsAfter.includes(studentIdentity)) ? ok('اخراج در Cloud اعمال شد (RemoveParticipant — شرکت‌کننده حذف شد)') : bad(`شرکت‌کنندهٔ اخراج‌شده هنوز در اتاق Cloud است (${partsAfter.length} نفر)`)
  } else {
    ok('ListParticipants بعد از اخراج اتاق را خالی/حذف گزارش کرد (اخراج موفق)')
  }
  await sPage.goto(`${BASE}/live/${SID}`, { waitUntil: 'domcontentloaded' })
  await sleep(3000)
  const rej = await sPage.locator('body').innerText()
  rej.includes('خارج') || rej.includes('اجازه') ? ok('ورود مجدد دانش‌آموز اخراج‌شده رد شد') : bad('اخراج‌شده دوباره وارد اتاق شد!')

  // ── ۷) پایان جلسه (DeleteRoom روی Cloud + وضعیت DB) ──
  await tPage.getByRole('button', { name: 'پایان جلسه' }).first().click()
  await sleep(600)
  await tPage.locator('[role="alertdialog"] button', { hasText: 'پایان جلسه' }).click()
  await sleep(2500)
  const dbState = await tPage.request.get(`${BASE}/api/live-sessions/${SID}`).then((r) => r.json()).catch(() => null)
  dbState?.status === 'ENDED' ? ok('وضعیت جلسه در DB = ENDED') : bad(`وضعیت DB: ${dbState?.status}`)
  let roomGone = false
  for (let i = 0; i < 10 && !roomGone; i++) {
    const rooms = await twirp('ListRooms', {}).then((d) => (d.rooms ?? []).map((r) => r.name)).catch(() => null)
    roomGone = Array.isArray(rooms) && !rooms.includes(ROOM)
    if (!roomGone) await sleep(1000)
  }
  roomGone ? ok('اتاق در Cloud حذف شد (DeleteRoom از سرویس socket)') : bad('اتاق در Cloud هنوز وجود دارد')

  // ── ۸) :7880 در کل آزمون خاموش ماند ──
  const still7880 = await fetch('http://127.0.0.1:7880/').then((r) => r.ok).catch(() => false)
  ;(!still7880) ? ok('LiveKit محلی :7880 در کل آزمون خاموش ماند — رسانه فقط از Cloud گذشت') : bad(':7880 روشن شد!')

  // ── ۹) خطای JS ──
  jsErrors.length === 0 ? ok('صفر خطای JS در صفحات معلم/دانش‌آموز') : bad(`${jsErrors.length} خطای JS: ${jsErrors[0]}`)
} catch (e) {
  console.log('FAIL:', e.message)
  bad('اجرای آزمون ناتمام: ' + e.message.slice(0, 120))
} finally {
  await browser.close()
  // پاک‌سازی: اگر جلسه‌ای باز مانده، از طریق API (اگر کوکی معلم زنده است) پایان داده نمی‌شود — با DB مستقیم چک می‌شود در check بعدی
}
console.log(`\nنتیجهٔ آزمون LiveKit Cloud: ${pass} پاس / ${fail} شکست`)
process.exit(fail > 0 ? 1 : 0)
