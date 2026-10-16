/**
 * ایزوله‌سازی مشکل کوکی در websocket — مقایسه localhost:81 با دامنه پیش‌نمایش
 */
import { io } from '/home/z/my-project/node_modules/socket.io-client/build/esm/index.js'
import WebSocket from '/home/z/my-project/node_modules/ws/index.js'

const PREVIEW = 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai'
const LOCAL = 'http://localhost:81'

const login = await fetch(`${LOCAL}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'beheshti.s1', password: 'Pass@123', realm: 'app' }),
})
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
console.log('cookie ok:', cookie.startsWith('daniar_session='))

async function sioTest(label, base, extra = {}) {
  await new Promise((resolve) => {
    let done = false
    const socket = io(base + '/?XTransformPort=3003', {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      timeout: 8000,
      extraHeaders: { cookie },
      ...extra,
    })
    const finish = (m) => {
      if (!done) { done = true; console.log(`  [${label}] ${m}`); socket.close(); resolve() }
    }
    socket.on('connect', () => finish('✅ متصل'))
    socket.on('connect_error', (e) => finish(`❌ ${e.message}`))
    setTimeout(() => finish('⏱️ timeout'), 8000)
  })
}

console.log('▶ socket.io-client ws-only:')
await sioTest('local:81', LOCAL)
await sioTest('preview', PREVIEW)

// خام: ws با هدر کوکی → دیدن پاسخ 40/44
console.log('▶ raw ws handshake + بسته 40:')
async function rawWs(label, url, headers) {
  await new Promise((resolve) => {
    const ws = new WebSocket(url, { headers })
    let buf = ''
    const done = (m) => { console.log(`  [${label}] ${m}`); try { ws.close() } catch {}; resolve() }
    ws.on('open', () => ws.send('40'))
    ws.on('message', (d) => {
      buf += d.toString()
      if (buf.length > 400) return done('payload: ' + buf.slice(0, 400))
      if (buf.startsWith('40') || buf.startsWith('44')) done('پاسخ نیم‌اسپیس: ' + buf.slice(0, 120))
    })
    ws.on('error', (e) => done('ws error: ' + e.message))
    setTimeout(() => done('پاسخ دریافتی: ' + buf.slice(0, 200) || 'هیچ'), 6000)
  })
}
const wsUrl = (base) =>
  base.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket&XTransformPort=3003'
await rawWs('raw-local', wsUrl(LOCAL), { cookie })
await rawWs('raw-preview', wsUrl(PREVIEW), { cookie })
