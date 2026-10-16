/**
 * تست کنترل‌شده socket.io-client روی دامنه پیش‌نمایش با کوکی واقعی
 * — سه حالت: websocket-only، polling-only، هر دو
 */
import { io } from '/home/z/my-project/node_modules/socket.io-client/build/esm/index.js'

const BASE = process.env.PREVIEW_BASE ?? 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai'

// ورود سرور-به-سرور برای گرفتن کوکی نشست معتبر
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'beheshti.s1', password: 'Pass@123', realm: 'app' }),
})
const setCookie = login.headers.get('set-cookie') ?? ''
const cookie = setCookie.split(';')[0]
console.log('login:', login.status, '| cookie:', cookie.slice(0, 30) + '…')
if (!login.ok || !cookie) process.exit(1)

async function tryConnect(label, transports, timeoutMs = 15000) {
  await new Promise((resolve) => {
    let done = false
    const finish = (msg) => {
      if (done) return
      done = true
      console.log(`  [${label}] ${msg}`)
      socket.close()
      resolve()
    }
    const started = Date.now()
    const socket = io(BASE + '/?XTransformPort=3003', {
      path: '/socket.io',
      transports,
      withCredentials: true,
      reconnection: false,
      timeout: timeoutMs,
      extraHeaders: { cookie },
    })
    socket.on('connect', () => finish(`✅ متصل شد (${socket.io.engine.transport.name}) در ${Date.now() - started}ms`))
    socket.on('connect_error', (e) => finish(`❌ connect_error: ${e.message} در ${Date.now() - started}ms`))
    setTimeout(() => finish(`⏱️ تایم‌اوت ${timeoutMs}ms بدون اتصال`), timeoutMs)
  })
}

await tryConnect('websocket-only', ['websocket'])
await tryConnect('polling-only', ['polling'])
await tryConnect('both(ws,polling)', ['websocket', 'polling'])
