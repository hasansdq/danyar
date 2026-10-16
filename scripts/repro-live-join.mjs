// بازتولی دقیق ورود معلم به جلسه آنلاین — login + socket.io connect + live:join
import { io } from 'socket.io-client'

const BASE = process.env.TEST_BASE || 'http://localhost:81'
const SESSION_ID = process.argv[2] || 'cmv46m3860001pqna5jsao2n7'

// ۱) ورود معلم
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'farzanegan.t1', password: 'Pass@123', realm: 'app' }),
})
const setCookies = loginRes.headers.getSetCookie?.() ?? []
const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
console.log('login status:', loginRes.status, '| cookie len:', cookie.length)
if (!loginRes.ok) {
  console.log(await loginRes.text())
  process.exit(1)
}

// ۲) اتصال سوکت — همان تنظیمات اپ: polling اول، مسیر /socket.io، کوکی همراه
const socket = io(`${BASE}/?XTransformPort=3003`, {
  path: '/socket.io',
  transports: ['polling', 'websocket'],
  withCredentials: true,
  extraHeaders: { cookie },
  timeout: 10000,
})

const timeout = setTimeout(() => {
  console.log('RESULT: TIMEOUT — no ack in 20s')
  process.exit(1)
}, 20000)

socket.on('connect', () => {
  console.log('socket connected:', socket.id)
  socket.emit('live:join', { sessionId: SESSION_ID }, (res) => {
    clearTimeout(timeout)
    console.log('live:join ack =>', JSON.stringify(res, (k, v) => (k === 'chat' ? undefined : v)).slice(0, 400))
    socket.disconnect()
    process.exit(res?.ok ? 0 : 2)
  })
})
socket.on('connect_error', (e) => console.log('connect_error:', e.message))
