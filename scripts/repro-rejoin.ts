/// <reference types="bun-types" />
/** ایزوله: مسیر جایگزینی اتصال (join دوباره همان کاربر با سوکت جدید) */
import { io, type Socket } from 'socket.io-client'

const BASE = 'http://localhost:3000'
const SOCKET_URL = 'http://localhost:3003'

async function login(username: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'Pass@123', realm: 'app' }),
  })
  const setCookie = r.headers.get('set-cookie') ?? ''
  return `daniar_session=${/daniar_session=([^;]+)/.exec(setCookie)?.[1]}`
}

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(SOCKET_URL, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie }, reconnection: false, timeout: 5000 })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e) => reject(e))
  })
}

const sid = (await Bun.file('/tmp/danyar-live/sid2.txt').text()).trim()

// BUT: sid2 was ended by previous test run. Create a fresh session via API.
const cookie = await login('beheshti.t1')
const endR = await fetch(`${BASE}/api/live-sessions`, { headers: { cookie } })
const list = await endR.json()
for (const c of list.classrooms ?? []) {
  if (c.activeSession) {
    await fetch(`${BASE}/api/live-sessions/${c.activeSession.id}/end`, { method: 'POST', headers: { cookie } })
  }
}
const createR = await fetch(`${BASE}/api/live-sessions`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ classroomId: (await Bun.file('/tmp/danyar-live/cls7.txt').text()).trim(), notifyGroupId: (await Bun.file('/tmp/danyar-live/gmath7.txt').text()).trim(), title: 'جلسه ایزوله rejoin' }),
})
const created = await createR.json()
console.log('session:', created.id)

const s1 = await connect(await login('beheshti.s1'))
const ack1 = await new Promise<any>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('first join timeout')), 4000)
  s1.emit('live:join', { sessionId: created.id }, (res: any) => { clearTimeout(t); resolve(res) })
})
console.log('first join:', ack1.ok)

const s1b = await connect(await login('beheshti.s1'))
s1.on('live:replaced', (d) => console.log('old socket got replaced event:', d))
const ack2 = await new Promise<any>((resolve, reject) => {
  const t = setTimeout(() => { console.log('SECOND JOIN TIMEOUT — server did not ack'); reject(new Error('second join timeout')) }, 6000)
  s1b.emit('live:join', { sessionId: created.id }, (res: any) => { clearTimeout(t); resolve(res) })
})
console.log('second join ok:', ack2.ok, 'error:', ack2.error)
console.log('participants:', JSON.stringify(ack2.data?.participants?.map((p: any) => p.name)))
process.exit(0)
