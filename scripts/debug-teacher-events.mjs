#!/usr/bin/env node
/** دیباگ: همان سناریوی دوحسابه ولی با لاگ کامل همهٔ رویدادهای سوکت معلم */
import { io } from 'socket.io-client'

const GATEWAY = 'http://127.0.0.1:81'

async function login(u, p) {
  const res = await fetch(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: p, realm: 'app' }),
  })
  return ((res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('daniar_session=')) ?? '').split(';')[0]
}

const adminCookie = await login('beheshti.admin', 'Pass@123')
const teacherCookie = await login('beheshti.t1', 'Pass@123')
const chats = await (await fetch(`${GATEWAY}/api/chats`, { headers: { Cookie: adminCookie } })).json()
const group = chats.conversations.find((c) => c.title === 'ریاضی هفتم۱')

const mk = (cookie, label) =>
  new Promise((res) => {
    const s = io(`${GATEWAY}/?XTransformPort=3003`, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    })
    s.on('connect', () => {
      console.log(`✔ ${label} وصل — sid=${s.id?.slice(-6)} transport=${s.io.engine.transport.name}`)
      res(s)
    })
  })

const admin = await mk(adminCookie, 'مدیر')
const teacher = await mk(teacherCookie, 'معلم')

// لاگ کامل همهٔ رویدادهای معلم
teacher.onAny((ev, ...args) => {
  console.log(`  ← معلم: ${ev} ${JSON.stringify(args).slice(0, 200)}`)
})
// عضویت اتاق‌ها را هم از سرور بپرس (رویداد list از سمت سرور؟) — فقط شنود کافی است

const body = `دیباگ بلادرنگ ${Date.now()}`
console.log(`ارسال: «${body}»`)
const sendRes = await fetch(`${GATEWAY}/api/chats/group/${group.id}/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Cookie: adminCookie },
  body: JSON.stringify({ body, clientId: `dbg-${Date.now()}` }),
})
const sent = await sendRes.json().catch(() => ({}))
console.log(`HTTP ${sendRes.status} messageId=${sent.message?.id} body در پاسخ: ${JSON.stringify(sent.message?.body)}`)

await new Promise((r) => setTimeout(r, 4000))
admin.disconnect()
teacher.disconnect()
console.log('پایان دیباگ')
process.exit(0)
