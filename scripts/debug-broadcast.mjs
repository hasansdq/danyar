/** دیباگ broadcast: شنونده سوکت مدیر + ارسال پیام دانش‌آموز از API واقعی */
import { io } from 'socket.io-client'

const BASE = 'http://localhost:3034'
const GID = 'cmv1aryqy000elokrx43nz39n'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function apiLogin(username, password, realm = 'app') {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, realm }),
  })
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}

const adminCookie = await apiLogin('beheshti.admin', 'Pass@123')
const studentCookie = await apiLogin('beheshti.s1', 'Pass@123')
console.log('cookies:', adminCookie.slice(0, 30), studentCookie.slice(0, 30))

// شنونده — دقیقاً مانند کلاینت اپ: همان‌دامنه + مسیر /socket.io
const socket = io(BASE, { path: '/socket.io', transports: ['polling', 'websocket'], withCredentials: true, extraHeaders: { cookie: adminCookie }, timeout: 10000, reconnection: false })
socket.on('connect_error', (e) => console.log('connect_error:', e.message))
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('connect timeout')), 12000)
  socket.on('connect', () => { clearTimeout(t); resolve() })
})
console.log('admin socket connected:', socket.id)

// ورود به اتاق گروه — کلاینت اپ پس از بررسی عضویت از سرور join می‌شود؛
// اما سوکت سرور اتاق‌ها را خودش بر اساس نقش می‌سازد (roomsForUser). فقط گوش می‌دهیم:
const events = []
const interesting = ['group:message', 'rooms-refreshed', 'message:new', 'group:new', 'chat:event', 'notification:new']
for (const ev of interesting) socket.on(ev, (d) => events.push([ev, JSON.stringify(d).slice(0, 120)]))
socket.onAny((ev, d) => { if (!interesting.includes(ev)) events.push([ev + ' (any)', JSON.stringify(d).slice(0, 100)]) })
await sleep(1500)
console.log('events after idle:', events.length)

// ارسال پیام از API واقعی دانش‌آموز
const r = await fetch(`${BASE}/api/chats/group/${GID}/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: studentCookie },
  body: JSON.stringify({ body: 'برادکست ' + Date.now(), clientId: 'dbg-' + Date.now() }),
})
console.log('POST message:', r.status)
await sleep(4000)
console.log('events received:', events.length)
events.forEach(([e, d]) => console.log(' ', e, '→', d))
socket.close()
process.exit(0)
