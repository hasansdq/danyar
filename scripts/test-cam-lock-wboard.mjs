// تست E2E سوکتی: قفل دوربین دانش‌آموز + تخته سفید معلم (همگام‌سازی)
// روی مدرسه beheshti (جلسه تست مستقل — جلسه واقعی کاربر دست‌نخورده می‌ماند)
import { io } from 'socket.io-client'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

async function apiLogin(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, realm: 'app' }),
  })
  const setCookie = r.headers.getSetCookie?.() ?? []
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
  if (!r.ok) throw new Error(`login failed ${username}: ${r.status}`)
  return cookie
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = io(`${BASE}/?XTransformPort=3003`, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      withCredentials: true,
      extraHeaders: { cookie },
      timeout: 15000,
    })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e) => reject(new Error('connect_error: ' + e.message)))
  })
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, (res) => resolve(res ?? { ok: false, error: 'no-ack' })))
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler)
      reject(new Error(`timeout waiting ${event}`))
    }, timeoutMs)
    const handler = (data) => {
      if (!predicate(data)) return
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(data)
    }
    socket.on(event, handler)
  })
}

// ─── راه‌اندازی ───
const tCookie = await apiLogin('beheshti.t1', 'Pass@123')
const s1Cookie = await apiLogin('beheshti.s1', 'Pass@123')
const s2Cookie = await apiLogin('beheshti.s2', 'Pass@123')

// کلاس هفتم۱ و گروه اطلاع‌رسانی (از دیتابیس — endpoint کلاس‌ها برای معلم باز نیست)
const cls = { id: 'cmv1aryqw000alokrajw9ermw', name: 'هفتم۱' }
const notifyGroup = 'cmv1aryr1000ilokroeeafkaj'

// پایان جلسات یتیم قبلی beheshti
const listRes = await fetch(`${BASE}/api/live-sessions`, { headers: { cookie: tCookie } })
const list = await listRes.json().catch(() => [])
for (const s of Array.isArray(list) ? list : []) {
  if (s.status === 'ACTIVE') {
    await fetch(`${BASE}/api/live-sessions/${s.id}/end`, { method: 'POST', headers: { cookie: tCookie } }).catch(() => null)
  }
}

// جلسه تازه
const createRes = await fetch(`${BASE}/api/live-sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: tCookie },
  body: JSON.stringify({ classroomId: cls.id, notifyGroupId: notifyGroup, title: 'تست قفل دوربین و تخته سفید' }),
})
const created = await createRes.json()
if (!createRes.ok) throw new Error('ساخت جلسه ناموفق: ' + JSON.stringify(created))
const sessionId = created.id ?? created.session?.id
console.log('جلسه تست:', sessionId)

// ─── اتصال سه کاربر ───
const tSock = await connect(tCookie)
const s1Sock = await connect(s1Cookie)
const s2Sock = await connect(s2Cookie)

const joinT = await emitAck(tSock, 'live:join', { sessionId })
check('معلم میزبان وارد شد', joinT.ok === true, JSON.stringify(joinT).slice(0, 120))
const joinS1 = await emitAck(s1Sock, 'live:join', { sessionId })
check('دانش‌آموز ۱ وارد شد', joinS1.ok === true, JSON.stringify(joinS1).slice(0, 120))
const joinS2 = await emitAck(s2Sock, 'live:join', { sessionId })
check('دانش‌آموز ۲ وارد شد', joinS2.ok === true, JSON.stringify(joinS2).slice(0, 120))

// ─── ۱) قفل دوربین دانش‌آموز ───
const camBlocked = await emitAck(s1Sock, 'live:media', { camOn: true })
check('دوربین دانش‌آموز بدون اجازه رد می‌شود', camBlocked.ok === false && (camBlocked.error ?? '').includes('دوربین'), JSON.stringify(camBlocked))

// مجوز دوربین → روشن می‌شود
const permChangedPromise = waitFor(s1Sock, 'live:permission-changed', (d) => d.canCam === true)
const permitRes = await emitAck(tSock, 'live:permit', { userId: joinS1.data.self.userId, canCam: true })
check('معلم مجوز دوربین می‌دهد', permitRes.ok === true, JSON.stringify(permitRes))
const permEvt = await permChangedPromise
check('دانش‌آموز رویداد اجازه دوربین گرفت', permEvt.canCam === true)
const camOn = await emitAck(s1Sock, 'live:media', { camOn: true })
check('دوربین دانش‌آموز با اجازه روشن شد', camOn.ok === true, JSON.stringify(camOn))

// قطع مجوز → دوربین فوراً خاموش
const permOffPromise = waitFor(s1Sock, 'live:permission-changed', (d) => d.canCam === false)
const partOffPromise = waitFor(s1Sock, 'live:participant-update', (d) => d.participant.userId === joinS1.data.self.userId && d.participant.camOn === false)
await emitAck(tSock, 'live:permit', { userId: joinS1.data.self.userId, canCam: false })
const permOff = await permOffPromise
const partOff = await partOffPromise
check('قطع مجوز → canCam=false به دانش‌آموز رسید', permOff.canCam === false)
check('قطع مجوز → دوربین روشن خودکار خاموش شد', partOff.participant.camOn === false)

// ─── ۲) تخته سفید ───
const wbStudentToggle = await emitAck(s1Sock, 'live:wboard-toggle', { active: true })
check('دانش‌آموز نمی‌تواند تخته را فعال کند', wbStudentToggle.ok === false && (wbStudentToggle.error ?? '').includes('معلم'), JSON.stringify(wbStudentToggle))

const wbActiveS1 = waitFor(s1Sock, 'live:wboard-active', (d) => d.active === true)
const wbActiveS2 = waitFor(s2Sock, 'live:wboard-active', (d) => d.active === true)
const wbToggle = await emitAck(tSock, 'live:wboard-toggle', { active: true })
check('معلم تخته را فعال کرد', wbToggle.ok === true && wbToggle.data?.active === true, JSON.stringify(wbToggle))
await Promise.all([wbActiveS1, wbActiveS2])
check('هر دو دانش‌آموز فعال شدن تخته را گرفتند', true)

const stroke = { type: 'stroke', tool: 'pen', color: '#111827', width: 4, points: [[0.1, 0.1], [0.3, 0.3], [0.5, 0.2]] }
const opS1 = waitFor(s1Sock, 'live:wboard-op', (d) => d.op?.type === 'stroke')
const opS2 = waitFor(s2Sock, 'live:wboard-op', (d) => d.op?.type === 'stroke')
const opRes = await emitAck(tSock, 'live:wboard-op', { op: stroke })
check('معلم ترسیم ارسال کرد', opRes.ok === true, JSON.stringify(opRes))
const [r1, r2] = await Promise.all([opS1, opS2])
check('دانش‌آموز ۱ ترسیم را دریافت کرد', r1.op.tool === 'pen' && r1.op.points.length === 3)
check('دانش‌آموز ۲ ترسیم را دریافت کرد', r2.op.tool === 'pen' && r2.op.points.length === 3)

const studentOp = await emitAck(s1Sock, 'live:wboard-op', { op: stroke })
check('دانش‌آموز نمی‌تواند روی تخته بکشد', studentOp.ok === false && (studentOp.error ?? '').includes('معلم'), JSON.stringify(studentOp))

const undoS1 = waitFor(s1Sock, 'live:wboard-op', (d) => d.op?.type === 'undo')
const undoRes = await emitAck(tSock, 'live:wboard-op', { op: { type: 'undo' } })
check('برگشت (undo) معلم انجام شد', undoRes.ok === true)
await undoS1

// clear — رویداد مستقل برای همه شامل فرستنده
const clearS1 = waitFor(s1Sock, 'live:wboard-clear')
const clearRes = await emitAck(tSock, 'live:wboard-op', { op: { type: 'clear' } })
check('پاک‌سازی معلم انجام شد', clearRes.ok === true)
await clearS1
check('دانش‌آموز پاک‌سازی را گرفت', true)

// ترسیم جدید بعد از پاک‌سازی → ورود مجدد s2 باید وضعیت کامل بگیرد
await emitAck(tSock, 'live:wboard-op', { op: stroke })
await new Promise((r) => setTimeout(r, 300))
// اتصال مجدد s2 (سوکت تازه)
s2Sock.disconnect()
const s2Sock2 = await connect(s2Cookie)
const rejoin = await emitAck(s2Sock2, 'live:join', { sessionId })
check('ورود مجدد دانش‌آموز ۲ موفق', rejoin.ok === true)
check('ورود مجدد وضعیت تخته را گرفت (فعال + ۱ ترسیم)', rejoin.data?.wboard?.active === true && rejoin.data?.wboard?.ops?.length === 1, JSON.stringify(rejoin.data?.wboard))

// خاموش‌کردن تخته → عملیات ترسیم رد می‌شود
const offS1 = waitFor(s1Sock, 'live:wboard-active', (d) => d.active === false)
const offRes = await emitAck(tSock, 'live:wboard-toggle', { active: false })
check('معلم تخته را بست', offRes.ok === true)
await offS1
const opWhenOff = await emitAck(tSock, 'live:wboard-op', { op: stroke })
check('ترسیم روی تخته بسته رد می‌شود', opWhenOff.ok === false && (opWhenOff.error ?? '').includes('فعال نیست'), JSON.stringify(opWhenOff))

// ─── پاک‌سازی ───
tSock.disconnect(); s1Sock.disconnect(); s2Sock2.disconnect()
const endRes = await fetch(`${BASE}/api/live-sessions/${sessionId}/end`, { method: 'POST', headers: { cookie: tCookie } })
check('جلسه تست پایان یافت', endRes.ok)

console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`)
process.exit(fail > 0 ? 1 : 0)
