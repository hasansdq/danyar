/**
 * پراب کامل زنجیره سوکت روی دامنه پیش‌نمایش زنده — بازتولید دقیق سناریوی کاربر
 *
 * ۱) ورود معلم و مدیر از خود دامنه پیش‌نمایش (کوکی واقعی)
 * ۲) handshake خام polling با کوکی از مسیر مخصوص پیش‌نمایش (XTransformPort=3003)
 * ۳) اتصال کامل socket.io مثل مرورگر (polling → ارتقای websocket)
 * ۴) اتصال فقط-websocket (تشخیص مسیر ارتقا)
 * ۵) دریافت بلادرنگ پیام با دو حساب (مدیر می‌فرستد، معلم روی سوکت می‌گیرد)
 * ۶) قطع اجباری شبکه‌وار + اتصال مجدد خودکار + دریافت دوباره
 *
 * هیچ مقدار محرمانه (کوکی/توکن/sid کامل) چاپ نمی‌شود — فقط وضعیت و کدها.
 */
import { io } from 'socket.io-client'

const PREVIEW =
  process.env.PREVIEW_BASE ??
  'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai'

let PASS = 0, FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const section = (m) => console.log(`\n▸ ${m}`)
const mask = (s) => (s ? `${String(s).slice(0, 6)}…` : '')

function redactErr(e) {
  // پیام خطا برای تشخیص چاپ می‌شود اما محتوای احتمالاً حساس کوتاه می‌ماند
  const t = String(e?.message ?? e)
  return t.length > 160 ? t.slice(0, 160) + '…' : t
}

async function login(username, password) {
  const res = await fetch(`${PREVIEW}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, realm: 'app' }),
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
  const hasSession = /daniar_session=/.test(cookie)
  return { status: res.status, cookie, hasSession }
}

async function api(method, path, body, cookie) {
  const res = await fetch(PREVIEW + path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

/** اتصال سوکت با پیکربندی دلخواه — نتیجه: connect/connect_error با جزئیات */
function connect(opts, label, timeoutMs = 20000, reconnect = false, expectError = false) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const socket = io(`${PREVIEW}/?XTransformPort=3003`, {
      path: '/socket.io',
      reconnection: reconnect,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: timeoutMs,
      ...opts,
    })
    const timer = setTimeout(() => {
      bad(`${label}: تایم‌اوت ${timeoutMs}ms — هیچ پاسخی از زنجیره پیش‌نمایش`)
      try { socket.disconnect() } catch {}
      resolve({ socket: null, error: 'timeout' })
    }, timeoutMs + 1500)
    socket.on('connect', () => {
      clearTimeout(timer)
      if (expectError) {
        bad(`${label}: انتظار خطا داشتیم ولی متصل شد!`)
        try { socket.disconnect() } catch {}
        resolve({ socket, error: null })
        return
      }
      ok(`${label}: متصل شد در ${Date.now() - t0}ms (sid=${mask(socket.id)}) — transport=${socket.io.engine.transport.name}`)
      resolve({ socket, transport: socket.io.engine.transport.name })
    })
    socket.on('connect_error', (e) => {
      clearTimeout(timer)
      if (expectError) {
        ok(`${label}: خطای انتظارفرض شد → «${redactErr(e)}»`)
        try { socket.disconnect() } catch {}
        resolve({ socket: null, error: e })
        return
      }
      bad(`${label}: connect_error → «${redactErr(e)}»`)
      try { socket.disconnect() } catch {}
      resolve({ socket: null, error: e })
    })
  })
}

// ─── ۱) ورود معلم از دامنه پیش‌نمایش ───
section('۱) ورود حساب‌ها از خود دامنه پیش‌نمایش')
const t1 = await login('beheshti.t1', 'Pass@123')
if (t1.status === 200 && t1.hasSession) ok(`ورود معلم beheshti.t1: 200 + کوکی نشست (${mask('daniar_session')} موجود)`)
else { bad(`ورود معلم: status=${t1.status} cookie=${t1.hasSession}`); process.exit(1) }

const adm = await login('beheshti.admin', 'Pass@123')
if (adm.status === 200 && adm.hasSession) ok('ورود مدیر beheshti.admin: 200 + کوکی نشست')
else { bad(`ورود مدیر: status=${adm.status} cookie=${adm.hasSession}`) }

// ─── ۲) handshake خام polling با کوکی ───
section('۲) handshake خام polling از مسیر پیش‌نمایش (با کوکی نشست)')
{
  const u = `${PREVIEW}/socket.io/?EIO=4&transport=polling&XTransformPort=3003`
  const res = await fetch(u, { headers: { cookie: t1.cookie } })
  const body = await res.text()
  const sid = body.match(/"sid":"([^"]+)"/)?.[1]
  if (res.status === 200 && body.startsWith('0{')) ok(`handshake 200 — sid=${mask(sid)} upgrades=${body.match(/"upgrades":\[(.*?)\]/)?.[1]}`)
  else bad(`handshake: status=${res.status} body=${body.slice(0, 120)}`)
}

// ─── ۳) اتصال کامل مثل مرورگر: polling → websocket ───
section('۳) اتصال کامل socket.io مثل مرورگر (polling → ارتقای websocket) با کوکی')
const full = await connect({
  transports: ['polling', 'websocket'],
  extraHeaders: { cookie: t1.cookie },
}, 'معلم — polling+ws (مثل مرورگر، با تلاش مجدد خودکار)', 20000, true)

// ─── ۴) اتصال فقط websocket (تشخیصی: لبهٔ پیش‌نمایش کوکی WS را حذف می‌کند) ───
section('۴) اتصال فقط-websocket (تست مسیر ارتقای WS از پیش‌نمایش)')
const wsOnly = await connect({
  transports: ['websocket'],
  extraHeaders: { cookie: t1.cookie },
}, 'معلم — فقط websocket (انتظار: رد با کد تشخیصی)', 15000, false, true)
if (!wsOnly.socket && String(wsOnly.error?.message ?? '').startsWith('auth:no_session'))
  ok('کد خطای تشخیصی درست: auth:no_session (کوکی روی ارتقای WS در لبهٔ پیش‌نمایش حذف می‌شود — با polling-first بی‌اثر است)')
else if (!wsOnly.socket)
  bad(`کد خطای انتظاراً auth:no_session بود ولی شد: ${wsOnly.error?.message}`)

// ─── ۵) بدون کوکی (تشخیصی: باید کد بی‌خطر واضح بدهد) ───
section('۵) اتصال بدون کوکی (تشخیصی — انتظار: auth:no_session)')
const noAuth = await connect({
  transports: ['polling'],
}, 'بدون کوکی (انتظار: رد با کد تشخیصی)', 12000, false, true)
if (!noAuth.socket && String(noAuth.error?.message ?? '').startsWith('auth:'))
  ok(`کد خطای بی‌خطر و قابل تشخیص رسید: «${noAuth.error.message}»`)
else if (!noAuth.socket)
  bad(`انتظار کد auth:* بود — آمد: ${noAuth.error?.message}`)

// ─── ۶) دریافت بلادرنگ پیام با دو حساب ───
section('۶) دریافت بلادرنگ پیام — مدیر می‌فرستد، معلم روی سوکت می‌گیرد')
if (full.socket && adm.status === 200) {
  // گروه مشترک را از API واقعی پیدا کن
  const chats = await api('GET', '/api/chats', null, t1.cookie)
  const conv = chats.json?.conversations?.find((c) => c.title === 'ریاضی هفتم۱')
  if (!conv) bad('گروه «ریاضی هفتم۱» در گفتگوهای معلم پیدا نشد')
  else {
    ok(`گروه مشترک پیدا شد: ${conv.id}`)
    // مدیر هم وصل شود
    const admSock = await connect({
      transports: ['polling', 'websocket'],
      extraHeaders: { cookie: adm.cookie },
    }, 'مدیر — polling+ws')
    if (admSock.socket) {
      // معلم گوش می‌دهد
      const received = new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 15000)
        full.socket.on('message:new', (d) => { clearTimeout(t); resolve(d) })
      })
      // مدیر می‌فرستد (از API پیش‌نمایش — مثل مرورگر)
      const stamp = Date.now()
      const sent = await api('POST', `/api/chats/group/${conv.id}/messages`, {
        body: `آزمون بلادرنگ پیش‌نمایش ${stamp}`,
        clientId: `pv-${stamp}`,
      }, adm.cookie)
      if (sent.status === 200 || sent.status === 201) ok(`پیام مدیر ثبت شد (${sent.status})`)
      else bad(`ارسال پیام مدیر: ${sent.status} ${sent.text.slice(0, 100)}`)

      const got = await received
      if (got && (got.message?.body ?? got.body ?? '').includes(String(stamp)))
        ok(`معلم پیام را بلادرنگ روی سوکت گرفت: «${String(got.message?.body ?? got.body).slice(0, 40)}…»`)
      else if (got) bad('رویداد رسید ولی محتوایش مطابق نبود')
      else bad('معلم ظرف ۱۵ ثانیه هیچ message:new نگرفت — مسیر broadcast می‌سوزد')

      // ─── ۷) قطع اجباری + اتصال مجدد خودکار ───
      section('۷) قطع اجباری سوکت معلم + اتصال مجدد خودکار + دریافت دوباره')
      const reconnected = new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 20000)
        full.socket.io.on('reconnect', () => { clearTimeout(t); resolve(true) })
      })
      full.socket.io.engine.close() // قطع ناگهانی مثل افت شبکه — socket.io خودش تلاش مجدد می‌کند
      const didReconnect = await reconnected
      if (didReconnect) ok(`اتصال مجدد خودکار انجام شد (transport=${full.socket.io.engine.transport.name})`)
      else bad('اتصال مجدد خودکار تا ۲۰ ثانیه انجام نشد')

      if (didReconnect) {
        const received2 = new Promise((resolve) => {
          const t = setTimeout(() => resolve(null), 15000)
          full.socket.on('message:new', (d) => { clearTimeout(t); resolve(d) })
        })
        const stamp2 = Date.now()
        await api('POST', `/api/chats/group/${conv.id}/messages`, {
          body: `آزمون پس از اتصال مجدد ${stamp2}`,
          clientId: `pv2-${stamp2}`,
        }, adm.cookie)
        const got2 = await received2
        if (got2 && (got2.message?.body ?? got2.body ?? '').includes(String(stamp2)))
          ok('پس از اتصال مجدد، پیام جدید دوباره بلادرنگ رسید (اتاق‌ها بازسازی شدند)')
        else bad('پس از اتصال مجدد، پیام جدید نرسید')
      }
      admSock.socket?.disconnect()
    }
  }
} else {
  bad('پیش‌نیاز مرحله ۶ موجود نیست (اتصال معلم یا ورود مدیر)')
}

// جمع‌بندی
full.socket?.disconnect()
wsOnly.socket?.disconnect()
console.log(`\n═══ نتیجه: ${PASS} موفق / ${FAIL} ناموفق ═══`)
process.exit(FAIL > 0 ? 1 : 0)
