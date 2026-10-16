/**
 * بررسی صحت اتصال به LiveKit Cloud از تنظیمات .env — بدون چاپ کلید/رمز
 *
 * چه می‌کند:
 *  ۱) LIVEKIT_INTERNAL_URL را مثل اپ نرمال می‌کند (wss→https) و با توکن مدیریتی
 *     امضاشده با LIVEKIT_API_KEY/SECRET از .env، ListRooms را صدا می‌زند.
 *     ۲۰۰ = کلید/رمز/آدرس Cloud معتبرند (صدور توکن و مدیریت واقعاً کار می‌کنند).
 *  ۲) کنترل منفی: توکن با امضای غلط باید ۴۰۱ بگیرد (یعنی endpoint واقعاً امضا
 *     را راستی‌آزمایی می‌کند و ۲۰۰ تصادفی نیست).
 *
 * خروجی فقط وضعیت/تعداد است — هیچ مقدار محرمانه‌ای چاپ یا لاگ نمی‌شود.
 * اجرا: node scripts/check-livekit-cloud.mjs
 */
import { readFileSync } from 'node:fs'
import { SignJWT } from 'jose'

function envOf(file) {
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[k] = v
  }
  return out
}

const env = envOf(new URL('../.env', import.meta.url).pathname)
const KEY = (env.LIVEKIT_API_KEY ?? '').trim()
const SECRET = (env.LIVEKIT_API_SECRET ?? '').trim()
const RAW_URL = (env.LIVEKIT_INTERNAL_URL ?? '').trim()
// همان نرمال‌سازی اپ (socket-server/livekit.ts): wss→https
const BASE = RAW_URL.replace(/\/$/, '').replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://')
const WS_URL = (env.NEXT_PUBLIC_LIVEKIT_WS_URL ?? '').trim()

if (!KEY || !SECRET || !RAW_URL) {
  console.log('CONFIG_MISSING: LIVEKIT_API_KEY/SECRET/INTERNAL_URL در .env نیست')
  process.exit(1)
}

async function adminToken(secret, room = '') {
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({ video: { room, roomAdmin: true, roomCreate: true, roomList: true, roomJoin: false } })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(KEY)
    .setSubject('daniar-cloud-check')
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(new TextEncoder().encode(secret))
}

const host = (() => { try { return new URL(BASE).host } catch { return '(invalid)' } })()
console.log(`cloud_base_host=${host}`)
console.log(`client_ws_url_set=${WS_URL ? 'yes' : 'no'}`)

// ۱) ListRooms با اعتبارنامهٔ واقعی
let okMain = false
try {
  const res = await fetch(`${BASE}/twirp/livekit.RoomService/ListRooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await adminToken(SECRET)}` },
    body: '{}',
    signal: AbortSignal.timeout(10000),
  })
  const body = await res.json().catch(() => ({}))
  const n = Array.isArray(body.rooms) ? body.rooms.length : -1
  console.log(`listrooms_status=${res.status} rooms=${n}`)
  okMain = res.status === 200 && n >= 0
} catch (e) {
  console.log(`listrooms_status=network-error (${e instanceof Error ? e.message.slice(0, 80) : 'unknown'})`)
}

// ۲) کنترل منفی — امضای غلط باید ۴۰۱ بگیرد
let negOk = false
try {
  const res = await fetch(`${BASE}/twirp/livekit.RoomService/ListRooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await adminToken(SECRET + 'x')}` },
    body: '{}',
    signal: AbortSignal.timeout(10000),
  })
  console.log(`wrong_signature_status=${res.status} (expect 401)`)
  negOk = res.status === 401
} catch {
  console.log('wrong_signature_status=network-error')
}

console.log(okMain ? 'CLOUD_AUTH_OK' : 'CLOUD_AUTH_FAILED')
console.log(negOk ? 'NEGATIVE_CONTROL_OK' : 'NEGATIVE_CONTROL_FAILED')
process.exit(okMain ? 0 : 1)
