/**
 * مقایسه سه پیکربندی اتصال socket.io روی پیش‌نمایش و لوکال
 */
import { io } from '/home/z/my-project/node_modules/socket.io-client/build/esm/index.js'

const PREVIEW = 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai'
const LOCAL = 'http://localhost:81'

const login = await fetch(`${LOCAL}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'beheshti.s1', password: 'Pass@123', realm: 'app' }),
})
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]

async function test(label, base, opts, waitMs = 6000) {
  await new Promise((resolve) => {
    let done = false
    const started = Date.now()
    const socket = io(base + '/?XTransformPort=3003', {
      path: '/socket.io',
      withCredentials: true,
      reconnection: false,
      timeout: 9000,
      extraHeaders: { cookie },
      ...opts,
    })
    const finish = (m) => {
      if (!done) { done = true; console.log(`  [${label}] ${m} (${Date.now() - started}ms)`); socket.close(); resolve() }
    }
    socket.on('connect', () => {
      const t0 = socket.io.engine.transport.name
      setTimeout(() => finish(`✅ متصل؛ ترنسپورت اولیه: ${t0} → فعلی: ${socket.io.engine.transport.name}`), waitMs)
    })
    socket.on('connect_error', (e) => finish(`❌ ${e.message}`))
    setTimeout(() => finish('⏱️ timeout'), waitMs + 5000)
  })
}

console.log('▶ پیکربندی A: polling اول + ارتقا (پیشنهادی):')
await test('preview-A', PREVIEW, { transports: ['polling', 'websocket'] })
await test('local-A', LOCAL, { transports: ['polling', 'websocket'] })

console.log('▶ پیکربندی B: ws اول + tryAllTransports:')
await test('preview-B', PREVIEW, { transports: ['websocket', 'polling'], tryAllTransports: true })
