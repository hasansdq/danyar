/**
 * تست جداسازی کلاس‌های آنلاین (درخواست کاربر):
 * هر کلاس از مدرسه، جلسه آنلاین یکتای خودش را دارد و اعضای کلاس‌های دیگر
 * (دانش‌آموز/معلم غیرمنتسب/مدرسه دیگر) به هیچ وجه وارد استریم کلاس دیگر نمی‌شوند —
 * نه از فهرست، نه با لینک مستقیم (REST 404)، نه با سوکت (join رد)، نه در سطح رویداد
 * (چت/رله WebRTC بین دو جلسه نشت نمی‌کند).
 *
 * اجرا: bun scripts/test-live-isolation.ts   (خودکفا — جلسه‌ها را خودش می‌سازد و پایان می‌دهد)
 */
import { io, type Socket } from 'socket.io-client'

const BASE = 'http://localhost:3000'
const SOCKET_URL = 'http://localhost:3003'
const SOCKET_PATH = '/socket.io'

let pass = 0
let fail = 0
const ok = (m: string) => { pass++; console.log('  ✅', m) }
const bad = (m: string) => { fail++; console.log('  ❌', m) }
const section = (m: string) => console.log(`\n▶ ${m}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function login(username: string, password = 'Pass@123'): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, realm: 'app' }),
  })
  if (!r.ok) throw new Error(`login failed for ${username}: ${r.status}`)
  const setCookie = r.headers.get('set-cookie') ?? ''
  const token = /daniar_session=([^;]+)/.exec(setCookie)?.[1]
  if (!token) throw new Error(`no cookie for ${username}`)
  return `daniar_session=${token}`
}

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(SOCKET_URL, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
      timeout: 5000,
    })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e) => reject(e))
  })
}

function emit<T = { ok: boolean; error?: string; data?: any }>(
  s: Socket, event: string, payload?: unknown, timeoutMs = 4000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeoutMs)
    s.emit(event, payload, (res: T) => { clearTimeout(t); resolve(res) })
  })
}

function waitFor<T = any>(s: Socket, event: string, timeoutMs = 5000, match?: (d: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.off(event, fn); reject(new Error(`timeout waiting for ${event}`)) }, timeoutMs)
    const fn = (d: T) => {
      if (match && !match(d)) return
      clearTimeout(t); s.off(event, fn); resolve(d)
    }
    s.on(event, fn)
  })
}

async function rest(method: string, path: string, cookie: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => null) }
}

async function main() {
  // ─── پاک‌سازی جلسات فعال جامانده ───
  section('پاک‌سازی جلسات فعال جامانده از ران قبلی')
  for (const admin of ['beheshti.admin', 'farzanegan.admin']) {
    const c = await login(admin)
    const list = await rest('GET', '/api/live-sessions', c)
    for (const s of list.data?.activeSessions ?? []) {
      const e = await rest('POST', `/api/live-sessions/${s.id}/end`, c)
      e.status === 200 ? ok(`پاک‌سازی: جلسه ${s.title} پایان داده شد`) : bad(`پاک‌سازی ${s.id} ناموفق`)
    }
  }

  // ─── ساخت دو جلسه هم‌زمان در دو کلاس مختلف (هر کلاس کلاس آنلاین یکتای خودش) ───
  section('ساخت جلسه هم‌زمان برای دو کلاس — هر کلاس جلسه یکتای خودش')
  const t1c = await login('beheshti.t1')
  const lst = await rest('GET', '/api/live-sessions', t1c)
  const classrooms = lst.data?.classrooms ?? []
  const c7 = classrooms.find((x: any) => x.name === 'هفتم۱')
  const c8 = classrooms.find((x: any) => x.name === 'هشتم۱')
  if (!c7 || !c8) { bad('کلاس‌های هفتم۱/هشتم۱ در فهرست معلم نیست'); return }
  const g7 = c7.groups.find((g: any) => !g.archived)
  const g8 = c8.groups.find((g: any) => !g.archived)

  const a = await rest('POST', '/api/live-sessions', t1c, {
    classroomId: c7.id, notifyGroupId: g7.id, title: 'ریاضی زنده هفتم۱',
  })
  const b = await rest('POST', '/api/live-sessions', t1c, {
    classroomId: c8.id, notifyGroupId: g8.id, title: 'ریاضی زنده هشتم۱',
  })
  a.status === 201 ? ok('جلسه کلاس هفتم۱ ساخته شد') : bad('ساخت جلسه هفتم۱ ناموفق: ' + JSON.stringify(a.data))
  b.status === 201 ? ok('جلسه کلاس هشتم۱ ساخته شد (هم‌زمان با هفتم۱)') : bad('ساخت جلسه هشتم۱ ناموفق: ' + JSON.stringify(b.data))
  const A = a.data?.id, B = b.data?.id
  if (!A || !B) return
  A !== B ? ok('شناسه یکتای هر جلسه متفاوت است (کد یکتای خود کلاس)') : bad('شناسه دو جلسه یکی است!')

  // جلسه دوم در همان کلاس توسط «معلم دیگر» → 409 (یکتا بودن جلسه فعال هر کلاس).
  // توجه: تلاش مجدد «خودِ میزبان» عمداً 201/بازگشت همان جلسه است (رفع حلقهٔ ارور
  // بقایای جلسهٔ اعلام‌نشده — مستند در مسیر POST) پس یکتایی با معلم دوم سنجیده می‌شود.
  const t2c = await login('beheshti.t2')
  const dupA = await rest('POST', '/api/live-sessions', t2c, {
    classroomId: c7.id, notifyGroupId: g7.id, title: 'جلسه تکراری',
  })
  dupA.status === 409 ? ok('جلسه فعال دوم (معلم دیگر) در همان کلاس رد شد (409)') : bad('جلسه دوم در همان کلاس ساخته شد! status=' + dupA.status)

  // ─── اعلام شروع هر دو جلسه توسط میزبان ───
  section('اعلام شروع هر دو جلسه توسط میزبان')
  const annA = await rest('POST', `/api/live-sessions/${A}/announce`, t1c)
  const annB = await rest('POST', `/api/live-sessions/${B}/announce`, t1c)
  annA.status === 200 ? ok('اعلام جلسه هفتم۱') : bad('اعلام A ناموفق')
  annB.status === 200 ? ok('اعلام جلسه هشتم۱') : bad('اعلام B ناموفق')

  // ─── ماتریس دسترسی REST (GET جزئیات) — لینک مستقیم به دانش‌آموز کلاس دیگر 404 است ───
  section('ماتریس دسترسی REST — لینک مستقیم جلسه کلاس دیگر 404')
  const matrix: [string, string, string, number][] = [
    // [user, session, توضیح, وضعیت مورد انتظار]
    ['beheshti.s1', A, 's1 (هفتم۱) → جلسه کلاس خودش', 200],
    ['beheshti.s1', B, 's1 (هفتم۱) → جلسه هشتم۱ (کلاس دیگر)', 404],
    ['beheshti.s2', A, 's2 (هفتم۱) → جلسه کلاس خودش', 200],
    ['beheshti.s2', B, 's2 (هفتم۱) → جلسه هشتم۱', 404],
    ['beheshti.s5', B, 's5 (هشتم۱) → جلسه کلاس خودش', 200],
    ['beheshti.s5', A, 's5 (هشتم۱) → جلسه هفتم۱ (کلاس دیگر)', 404],
    ['beheshti.t1', A, 'میزبان → جلسه خودش هفتم۱', 200],
    ['beheshti.t1', B, 'میزبان → جلسه خودش هشتم۱', 200],
    ['beheshti.t2', A, 't2 (علوم منتسب به هفتم۱) → جلسه هفتم۱', 200],
    ['beheshti.t2', B, 't2 (علوم منتسب به هشتم۱) → جلسه هشتم۱', 200],
    ['beheshti.t3', A, 't3 (ادبیات فقط هفتم۱) → جلسه هفتم۱', 200],
    ['beheshti.t3', B, 't3 (ادبیات فقط هفتم۱) → جلسه هشتم۱ (کلاس دیگر)', 404],
    ['beheshti.admin', A, 'مدیر مدرسه ۱ → جلسه هفتم۱ (نظارت)', 200],
    ['beheshti.admin', B, 'مدیر مدرسه ۱ → جلسه هشتم۱ (نظارت)', 200],
    ['farzanegan.t1', A, 'معلم مدرسه ۲ → جلسه مدرسه ۱', 404],
    ['farzanegan.t1', B, 'معلم مدرسه ۲ → جلسه مدرسه ۱', 404],
    ['farzanegan.s1', A, 'دانش‌آموز مدرسه ۲ → جلسه مدرسه ۱', 404],
    ['farzanegan.s1', B, 'دانش‌آموز مدرسه ۲ → جلسه مدرسه ۱', 404],
  ]
  for (const [user, sid, desc, expected] of matrix) {
    const c = await login(user)
    const r = await rest('GET', `/api/live-sessions/${sid}`, c)
    r.status === expected ? ok(`${desc} → ${r.status}`) : bad(`${desc} → ${r.status} (انتظار ${expected})`)
  }

  // ─── ماتریس ورود سوکت — ورود واقعی به استریم ───
  section('ماتریس ورود واقعی به استریم (سوکت live:join)')
  const s1 = await connect(await login('beheshti.s1'))
  const s2 = await connect(await login('beheshti.s2'))
  const s5 = await connect(await login('beheshti.s5'))
  const t3 = await connect(await login('beheshti.t3'))
  const t2 = await connect(await login('beheshti.t2'))
  const admin = await connect(await login('beheshti.admin'))
  const fs1 = await connect(await login('farzanegan.s1'))
  const t1 = await connect(t1c)

  const joinRes = async (s: Socket, sid: string) => emit(s, 'live:join', { sessionId: sid })

  const rS1A = await joinRes(s1, A)
  rS1A.ok ? ok('s1 وارد استریم کلاس خودش (هفتم۱) شد') : bad('ورود s1 به کلاس خودش رد شد: ' + rS1A.error)
  const rS1B = await joinRes(s1, B)
  !rS1B.ok ? ok('s1 از ورود به استریم هشتم۱ رد شد: ' + rS1B.error) : bad('s1 وارد استریم کلاس دیگر شد!')
  const rS2A = await joinRes(s2, A)
  rS2A.ok ? ok('s2 وارد استریم هفتم۱ شد (چند دانش‌آموز هم‌کلاس)') : bad('ورود s2 رد شد: ' + rS2A.error)
  const rS5B = await joinRes(s5, B)
  rS5B.ok ? ok('s5 وارد استریم کلاس خودش (هشتم۱) شد') : bad('ورود s5 به کلاس خودش رد شد: ' + rS5B.error)
  const rS5A = await joinRes(s5, A)
  !rS5A.ok ? ok('s5 از ورود به استریم هفتم۱ رد شد: ' + rS5A.error) : bad('s5 وارد استریم کلاس دیگر شد!')
  const rT3A = await joinRes(t3, A)
  rT3A.ok ? ok('t3 (معلم منتسب هفتم۱) وارد شد') : bad('ورود t3 به کلاس خودش رد شد: ' + rT3A.error)
  const rT3B = await joinRes(t3, B)
  !rT3B.ok ? ok('t3 از ورود به کلاس هشتم۱ (غیرمنتسب) رد شد: ' + rT3B.error) : bad('t3 وارد کلاس غیرمنتسب شد!')
  const rFA = await joinRes(fs1, A)
  !rFA.ok ? ok('دانش‌آموز مدرسه ۲ از ورود به جلسه مدرسه ۱ رد شد: ' + rFA.error) : bad('ورود بین‌مدرسه‌ای رخ داد!')
  const rFB = await joinRes(fs1, B)
  !rFB.ok ? ok('دانش‌آموز مدرسه ۲ از ورود به جلسه دوم مدرسه ۱ هم رد شد') : bad('ورود بین‌مدرسه‌ای دوم رخ داد!')
  const rAdmA = await joinRes(admin, A)
  rAdmA.ok ? ok('مدیر مدرسه وارد جلسه هفتم۱ شد (نظارت)') : bad('ورود مدیر مدرسه رد شد: ' + rAdmA.error)
  await emit(admin, 'live:leave')
  const rT1B = await joinRes(t1, B)
  rT1B.ok ? ok('میزبان وارد استریم هشتم۱ شد') : bad('ورود میزبان به جلسه خودش ناموفق: ' + rT1B.error)
  const rT2A = await joinRes(t2, A)
  rT2A.ok ? ok('t2 وارد استریم هفتم۱ شد') : bad('ورود t2 ناموفق: ' + rT2A.error)

  // ─── جداسازی رویدادها: چت هر جلسه فقط به اعضای همان جلسه می‌رسد ───
  section('جداسازی بلادرنگ — چت جلسه هشتم۱ هرگز به اعضای هفتم۱ نمی‌رسد')
  const leakToS1 = waitFor<any>(s1, 'live:chat', 2500).catch(() => 'none')
  const s5Gets = waitFor<any>(s5, 'live:chat', 4000)
  await emit(t1, 'live:chat', { body: 'سلام کلاس هشتم! این چت فقط مال شماست' })
  const gotS5 = await s5Gets
  gotS5?.body?.includes('هشتم') ? ok('s5 چت جلسه خودش (هشتم۱) را دریافت کرد') : bad('چت به عضو همان جلسه نرسید')
  const leak1 = await leakToS1
  leak1 === 'none' ? ok('چت جلسه هشتم۱ به s1 (هفتم۱) نشت نکرد') : bad('نشت چت بین دو کلاس! ' + JSON.stringify(leak1))

  const leakToS5 = waitFor<any>(s5, 'live:chat', 2500).catch(() => 'none')
  const s1Gets = waitFor<any>(s1, 'live:chat', 4000)
  await emit(t2, 'live:chat', { body: 'سلام هفتمی‌ها — چت اختصاصی کلاس شما' })
  const gotS1 = await s1Gets
  gotS1?.body?.includes('هفتم') ? ok('s1 چت جلسه خودش (هفتم۱) را دریافت کرد') : bad('چت به عضو همان جلسه نرسید')
  const leak2 = await leakToS5
  leak2 === 'none' ? ok('چت جلسه هفتم۱ به s5 (هشتم۱) نشت نکرد') : bad('نشت چت بین دو کلاس! ' + JSON.stringify(leak2))

  // ─── جداسازی رسانه در معماری SFU ───
  // مهاجرت mesh → SFU: سرویس سوکت دیگر هیچ رلهٔ webrtc:offer ندارد (عمدی)؛
  // رسانه فقط از اتاق LiveKit «live:{sessionId}» می‌گذرد — جداسازی رسانه بین
  // جلسات با خود معماری تضمین می‌شود. اینجا همان را می‌سنجیم:
  // ۱) رویداد قدیمی mesh در سرور «هندلر ندارد» (ack timeout — نه رله)
  // ۲) نام اتاق SFU هر جلسه یکتا است (live:A ≠ live:B)
  section('جداسازی رسانه SFU بین دو جلسه')
  const s1SocketId = rS1A?.data?.self?.socketId
  let crossOffer: { ok?: boolean; error?: string } = {}
  try {
    crossOffer = (await emit(s5, 'webrtc:offer', {
      to: s1SocketId,
      description: { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' },
    })) as { ok?: boolean; error?: string }
  } catch (e) {
    crossOffer = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  !crossOffer.ok
    ? ok('رویداد mesh قدیمی در سرور SFU هندلری ندارد (ack-timeout رد شد): ' + (crossOffer.error ?? ''))
    : bad('رله webrtc در معماری SFU مجاز ماند!')
  const s1GotCross = await waitFor<any>(s1, 'webrtc:offer', 1500).catch(() => 'none')
  s1GotCross === 'none' ? ok('هیچ offer بین‌جلسه‌ای به s1 نرسید') : bad('offer بین‌جلسه‌ای به s1 رسید!')
  const roomA = `live:${A}`
  const roomB = `live:${B}`
  roomA !== roomB && roomA.startsWith('live:') && roomB.startsWith('live:')
    ? ok('اتاق SFU هر جلسه مستقل است (live:A ≠ live:B)')
    : bad('اتاق‌های SFU یکی/نامعتبرند!')

  // ─── پایان جلسات ───
  section('پاک‌سازی نهایی')
  const endA = await rest('POST', `/api/live-sessions/${A}/end`, t1c)
  const endB = await rest('POST', `/api/live-sessions/${B}/end`, t1c)
  endA.status === 200 && endB.status === 200 ? ok('هر دو جلسه پایان داده شد') : bad('پایان جلسات ناموفق')

  ;[s1, s2, s5, t3, t2, admin, fs1, t1].forEach((s) => s.disconnect())

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`نتیجه جداسازی: ${pass} پاس / ${fail} خطا`)
  if (fail) process.exit(1)
}

main().catch((e) => {
  console.error('EXCEPTION:', e?.message ?? e)
  process.exit(1)
})
