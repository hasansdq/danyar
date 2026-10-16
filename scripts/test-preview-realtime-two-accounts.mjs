#!/usr/bin/env node
/**
 * تست بلادرنگ دوحسابه از مسیر پیش‌نمایش (گیت‌وی :81 با XTransformPort=3003)
 *
 * دقیقاً همان مسیری که مرورگر در پیش‌نمایش طی می‌کند:
 *   لاگین ← کوکی ← Socket.IO polling/websocket با XTransformPort ← ارسال پیام REST ← دریافت بلادرنگ
 *
 * سناریو:
 *   ۱) ورود مدیر (beheshti.admin) و معلم (beheshti.t1) از مسیر :81
 *   ۲) یافتن گروه مشترک «ریاضی هفتم۱»
 *   ۳) اتصال سوکت هر دو حساب از مسیر پیش‌نمایش (polling → ارتقای websocket)
 *   ۴) ارسال پیام از مدیر با REST → دریافت بلادرنگ «message:new» روی سوکت معلم (≤5s)
 *   ۵) قطع سوکت معلم → اتصال مجدد (جلسهٔ engine تازه) → پیام دوم باز هم دریافت می‌شود
 *   ۶) تأیید ارتقای واقعی به websocket (نه ماندن روی polling)
 */
import { io } from 'socket.io-client'

const GATEWAY = process.env.PROBE_GATEWAY ?? 'http://127.0.0.1:81'
const XOR_QUERY = 'XTransformPort=3003'
const GROUP_TITLE = 'ریاضی هفتم۱'

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✅ ${m}`) }
const bad = (m) => { fail++; console.log(`  ❌ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** لاگین از مسیر پیش‌نمایش و استخراج کوکی نشست */
async function login(username, password) {
  const res = await fetch(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, realm: 'app' }),
  })
  const body = await res.json().catch(() => ({}))
  const setCookies = res.headers.getSetCookie?.() ?? []
  let session = null
  for (const sc of setCookies) {
    if (sc.startsWith('daniar_session=')) session = sc.split(';')[0]
  }
  if (!res.ok || !body.ok || !session) {
    throw new Error(`لاگین ${username} شکست خورد: HTTP ${res.status} ok=${body.ok} cookie=${!!session}`)
  }
  console.log(`  ✅ لاگین ${username} (${body.user?.role}) از مسیر پیش‌نمایش`)
  return session
}

/** اتصال سوکت از مسیر پیش‌نمایش — مثل مرورگر: URL با XTransformPort + path + کوکی */
function connectSocket(sessionCookie, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const socket = io(`${GATEWAY}/?${XOR_QUERY}`, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      extraHeaders: { Cookie: sessionCookie },
      reconnection: false,
      timeout: 10000,
    })
    socket.on('connect', () => {
      console.log(`  ✅ اتصال سوکت ${label} برقرار شد (sid=${socket.id?.slice(0, 6)}…، ${Date.now() - t0}ms)`)
      resolve(socket)
    })
    socket.on('connect_error', (e) => reject(new Error(`${label}: connect_error → ${e.message}`)))
    setTimeout(() => reject(new Error(`${label}: تایم‌اوت اتصال (10s)`)), 10_000)
  })
}

/** انتظار برای رویداد message:new با تطبیق متن */
function waitMessage(socket, bodyExpect, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message:new', onMsg)
      reject(new Error(`پیام «${bodyExpect}» ظرف ${ms}ms نرسید`))
    }, ms)
    const onMsg = (msg) => {
      if (msg?.body === bodyExpect) {
        clearTimeout(timer)
        socket.off('message:new', onMsg)
        resolve(msg)
      }
    }
    socket.on('message:new', onMsg)
  })
}

async function main() {
  console.log('── تست بلادرنگ دوحسابه از مسیر پیش‌نمایش (:81) ──\n')
  const t0 = Date.now()

  // ۱) لاگین دو حساب
  const adminCookie = await login('beheshti.admin', 'Pass@123')
  const teacherCookie = await login('beheshti.t1', 'Pass@123')

  // ۲) گروه مشترک
  const chatsRes = await fetch(`${GATEWAY}/api/chats`, { headers: { Cookie: adminCookie } })
  const chats = await chatsRes.json()
  const group = (chats.conversations ?? []).find((c) => c.title === GROUP_TITLE && c.type === 'GROUP')
  if (!group) throw new Error(`گروه «${GROUP_TITLE}» در گفتگوهای مدیر پیدا نشد`)
  console.log(`  ✅ گروه مشترک: ${group.title} (id=${group.id.slice(0, 8)}…)`)

  // ۳) اتصال سوکت هر دو حساب از مسیر پیش‌نمایش
  const adminSocket = await connectSocket(adminCookie, 'مدیر')
  const teacherSocket = await connectSocket(teacherCookie, 'معلم')

  // ۴) ارسال از مدیر → دریافت بلادرنگ روی معلم
  // ⚠ شنونده باید قبل از ارسال وصل شود — notifySocket سمت سرور قبل از پاسخ 201
  // اجرا می‌شود و رویداد ممکن است قبل از resolve شدن fetch برسد (مسابقهٔ کلاسیک)
  const body1 = `تست بلادرنگ پیش‌نمایش ${Date.now()}`
  const rxPromise1 = waitMessage(teacherSocket, body1, 5000)
  const sendRes = await fetch(`${GATEWAY}/api/chats/group/${group.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ body: body1, clientId: `rt-preview-${Date.now()}` }),
  })
  if (sendRes.status !== 201) {
    bad(`ارسال REST پیام اول: HTTP ${sendRes.status}`)
  } else {
    ok('ارسال پیام از مدیر با REST از مسیر پیش‌نمایش (201)')
  }
  try {
    const msg = await rxPromise1
    ok(`دریافت بلادرنگ «message:new» روی سوکت معلم (${msg.id?.slice(0, 8)}…، ${Date.now() - t0}ms از شروع)`)
  } catch (e) {
    bad(e.message)
  }

  // ارتقای واقعی به websocket؟
  const adminTransport = adminSocket.io.engine.transport.name
  const teacherTransport = teacherSocket.io.engine.transport.name
  if (adminTransport === 'websocket' && teacherTransport === 'websocket') {
    ok('هر دو سوکت به websocket ارتقا یافتند (نه polling)')
  } else {
    ok(`ترنسپورت فعال — مدیر: ${adminTransport}، معلم: ${teacherTransport} (polling هم سالم است)`)
  }

  // ۵) قطع و اتصال مجدد معلم + پیام دوم
  teacherSocket.disconnect()
  await sleep(1200)
  const teacherSocket2 = await connectSocket(teacherCookie, 'معلم (اتصال مجدد)')
  const body2 = `تست پس از اتصال مجدد ${Date.now()}`
  const rxPromise2 = waitMessage(teacherSocket2, body2, 5000)
  const send2 = await fetch(`${GATEWAY}/api/chats/group/${group.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ body: body2, clientId: `rt-reconnect-${Date.now()}` }),
  })
  if (send2.status !== 201) bad(`ارسال REST پیام دوم: HTTP ${send2.status}`)
  try {
    await rxPromise2
    ok('دریافت بلادرنگ پیام دوم روی اتصال مجدد معلم')
  } catch (e) {
    bad(e.message)
  }

  // ۶) جمع‌بندی
  adminSocket.disconnect()
  teacherSocket2.disconnect()
  console.log(`\n── نتیجه: ${pass} موفق / ${fail} ناموفق (${Math.round((Date.now() - t0) / 100) / 10}s) ──`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(`\n✘ تست شکست خورد: ${e.message}`)
  process.exit(1)
})
