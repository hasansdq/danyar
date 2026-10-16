// پراب واقعی زنجیره استریم — بازتولید دقیق سناریوی گزارش کاربر در سطح API
// ۱) ورود معلم ۲) شروع جلسه ۳) درخواست توکن (قبلاً ۵۰۳ «پیکربندی نشده» می‌داد)
// ۴) دسترسی سیگنالینگ WS از مسیر همان‌مبدأ (درگاه + XTransformPort) ۵) پایان جلسه و پاک‌سازی
import { io } from 'socket.io-client'
import WebSocket from 'ws'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const JAR = '/tmp/danyar-probe.jar'
let PASS = 0, FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }

async function api(method, path, body, expect) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: await cookieHeader() },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  if (expect && res.status !== expect) bad(`${method} ${path} → ${res.status} (انتظار ${expect}): ${text.slice(0, 200)}`)
  return { status: res.status, json, text }
}

let cookie = ''
async function cookieHeader() { return cookie }

// ورود
{
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'beheshti.t1', password: 'Pass@123', realm: 'app' }),
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
  if (res.status === 200) ok('ورود معلم beheshti.t1 از درگاه واقعی')
  else { bad(`ورود معلم: ${res.status}`); process.exit(1) }
}

// شروع جلسه (کلاس هفتم۱ + گروه ریاضی — همان ثابت‌های test-live-sfu)
const start = await api('POST', '/api/live-sessions', {
  classroomId: 'cmv1aryqw000alokrajw9ermw',
  notifyGroupId: 'cmv1aryqy000elokrx43nz39n',
  title: 'پراب پیکربندی رسانه',
}, 201)
if (start.status === 201 && start.json?.id) ok(`جلسه ساخته شد: ${start.json.id}`)
else bad('شروع جلسه ناموفق — ادامه بی‌معنا')

if (start.json?.id) {
  const id = start.json.id
  // ورود واقعی معلم به جلسه از سوکت + باز نگه‌داشتن اتصال تا پس از توکن
  // (قطع سوکت = حذف شرکت‌کننده؛ مرورگر هم سوکت را باز نگه می‌دارد)
  let sock = null
  const joined = await new Promise((resolve) => {
    const s = io('http://127.0.0.1:3003', {
      path: '/socket.io',
      extraHeaders: { cookie },
      transports: ['websocket'],
      reconnection: false,
      timeout: 8000,
    })
    const timer = setTimeout(() => { bad('live:join تایم‌اوت شد'); s.disconnect(); resolve(false) }, 9000)
    s.on('connect', () => {
      s.emit('live:join', { sessionId: id }, (ack) => {
        clearTimeout(timer)
        if (ack?.ok) { ok('معلم با live:join واقعی وارد جلسه شد (سوکت)'); sock = s; resolve(true) }
        else { bad(`live:join رد شد: ${ack?.error ?? JSON.stringify(ack)}`); s.disconnect(); resolve(false) }
      })
    })
    s.on('connect_error', (e) => { clearTimeout(timer); bad(`اتصال سوکت: ${e.message}`); resolve(false) })
  })
  if (joined) {
  // توکن — قلب باگ کاربر
  const tok = await api('POST', `/api/live-sessions/${id}/token`, null, 200)
  if (tok.status === 200 && tok.json?.token) {
    ok(`توکن LiveKit صادر شد (${String(tok.json.token).length} حرف، اتاق ${tok.json.room})`)
    ok(`آدرس کلاینت: ${tok.json.url}`)
    if (String(tok.json.url).includes('XTransformPort=7880')) ok('آدرس شامل transform پورت درگاه (الگوی dev) است')
    // اعتبارسنجی امضای توکن با سرور واقعی: اتصال WS سیگنالینگ از مسیر همان‌مبدأ
    // (مثل livekit-client: مسیر /rtc به مبنا اضافه و access_token به کوئری — XTransformPort دست‌نخورده)
    // نکته: LiveKit 1.13.9 ارتقای WS را روی «/rtc» می‌پذیرد (روی /rtc/v1 با 400 رد می‌کند)
    const u = new URL(String(tok.json.url).replace(/^http/, 'ws'))
    u.pathname = (u.pathname.replace(/\/+$/, '') || '') + '/rtc'
    u.searchParams.set('access_token', tok.json.token)
    const wsUrl = u.toString()
    await new Promise((resolve) => {
      const sock = new WebSocket(wsUrl, { handshakeTimeout: 8000 })
      let opened = false
      sock.on('open', () => { opened = true; ok('اتصال سیگنالینگ WS از مسیر همان‌مبدأ برقرار شد (ریشه‌ی «timed out (signal)» سالم)'); sock.close(); resolve() })
      sock.on('error', (e) => { if (!opened) bad(`سیگنالینگ WS شکست خورد: ${e.message}`); resolve() })
      sock.on('unexpected-response', (_, res) => { bad(`سیگنالینگ WS پاسخ ${res.statusCode} داد`); resolve() })
      setTimeout(() => { if (!opened) bad('سیگنالینگ WS تایم‌اوت شد'); try { sock.terminate() } catch {} ; resolve() }, 9000)
    })
  } else {
    bad(`توکن: ${tok.status} — ${String(tok.text).slice(0, 160)}`)
  }
  // پایان جلسه — پاک‌سازی (اول قطع سوکت معلم)
  try { sock?.disconnect() } catch {}
  const end = await api('POST', `/api/live-sessions/${id}/end`, null, 200)
  if (end.status === 200) ok('جلسه آزمون پایان یافت (بدون باقی‌ماندن)')
  else bad(`پایان جلسه: ${end.status}`)
  } else {
    bad('بدون ورود موفق به جلسه، آزمون توکن کنسل شد')
    const end = await api('POST', `/api/live-sessions/${id}/end`).catch(() => ({ status: 0 }))
  }
}

console.log(`\nنتیجه: ${PASS} ✔ / ${FAIL} ✘`)
process.exit(FAIL > 0 ? 1 : 0)
