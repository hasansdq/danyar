#!/usr/bin/env node
/**
 * جداسازی عیب دریافت بلادرنگ: رله داخلی یا عضویت اتاق؟
 *  ۱) اتصال سوکت معلم از مسیر پیش‌نمایش
 *  ۲) emit مستقیم از طریق /internal/emit به اتاق group:{id} با رمز صحیح .env
 *  ۳) اگر رسید → اتاق‌ها سالم‌اند و مشکل در فراخوانی notify از next است
 *     اگر نرسید → مشکل عضویت اتاق در سرور سوکت است
 *  ۴) همچنین عضویت‌های واقعی سوکت را از رویداد echo داخلی می‌پرسیم
 */
import { io } from 'socket.io-client'
import { readFileSync } from 'fs'

const GATEWAY = 'http://127.0.0.1:81'
const GROUP_TITLE = 'ریاضی هفتم۱'

// رمز داخلی مستقیماً از .env
const envRaw = readFileSync('/home/z/my-project/.env', 'utf8')
const INTERNAL_SECRET = envRaw.match(/^SOCKET_INTERNAL_SECRET=(.*)$/m)?.[1]?.trim()

const session = (
  (await (
    await fetch(`${GATEWAY}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'beheshti.t1', password: 'Pass@123', realm: 'app' }),
    })
  ).headers.getSetCookie?.() ?? []).find((c) => c.startsWith('daniar_session='))
)?.split(';')[0]
if (!session) throw new Error('کوکی نشست نگرفت')
console.log('✔ لاگین معلم')

const chats = await (await fetch(`${GATEWAY}/api/chats`, { headers: { Cookie: session } })).json()
const group = (chats.conversations ?? []).find((c) => c.title === GROUP_TITLE)
if (!group) throw new Error('گروه پیدا نشد')
console.log(`✔ گروه: ${group.title} id=${group.id}`)

const socket = io(`${GATEWAY}/?XTransformPort=3003`, {
  path: '/socket.io',
  transports: ['polling', 'websocket'],
  extraHeaders: { Cookie: session },
  reconnection: false,
})
await new Promise((res, rej) => {
  socket.on('connect', res)
  socket.on('connect_error', (e) => rej(new Error(e.message)))
  setTimeout(() => rej(new Error('تایم‌اوت اتصال')), 10000)
})
console.log(`✔ سوکت وصل شد sid=${socket.id} transport=${socket.io.engine.transport.name}`)

// هر رویدادی که می‌رسد لاگ کن (برای دیدن rooms-refreshed و …)
const seen = []
socket.onAny((ev, ...args) => {
  seen.push(ev)
  console.log(`  ← رویداد: ${ev}`, JSON.stringify(args).slice(0, 120))
})

// emit مستقیم به اتاق گروه از طریق رله داخلی
const marker = `direct-relay-${Date.now()}`
const relay = await fetch('http://127.0.0.1:3003/internal/emit', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
  body: JSON.stringify({ rooms: [`group:${group.id}`], event: '__direct_probe', data: { marker } }),
})
const relayBody = await relay.json().catch(() => ({}))
console.log(`رله مستقیم: HTTP ${relay.status} → ${JSON.stringify(relayBody)} (marker=${marker})`)

await new Promise((r) => setTimeout(r, 1500))
const got = seen.includes('__direct_probe')
console.log(got ? '✔✔ رویداد مستقیم به سوکت معلم رسید — اتاق‌ها سالم‌اند' : '✘ رویداد مستقیم نرسید — مشکل عضویت اتاق است')
console.log('کل رویدادهای دریافتی:', seen.join(', ') || '(هیچ)')

socket.disconnect()
process.exit(got ? 0 : 1)
