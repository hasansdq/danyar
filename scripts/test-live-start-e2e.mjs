// تست E2E شروع کلاس آنلاین معلم: ساخت جلسه + ورود سوکت + پایان جلسه
import { io } from 'socket.io-client'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = process.env.TEST_BASE || 'http://localhost:81'
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }

// ۰) پایان جلسه یتیم قبلی (از تلاش ناموفق کاربر)
const orphans = await db.liveSession.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })
for (const o of orphans) {
  await db.liveSession.update({ where: { id: o.id }, data: { status: 'ENDED', endedAt: new Date() } })
  console.log(`  · جلسه یتیم ${o.id} پایان یافت`)
}

// ۱) ورود معلم
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'farzanegan.t1', password: 'Pass@123', realm: 'app' }),
})
const cookie = (loginRes.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
ok(loginRes.ok, `ورود farzanegan.t1 (${loginRes.status})`)

// ۲) یافتن کلاس و گروه اطلاع‌رسانی معلم
const teacher = await db.user.findUnique({ where: { username: 'farzanegan.t1' }, select: { id: true } })
const assign = await db.teachingAssignment.findFirst({
  where: { teacherId: teacher.id },
  include: { subjectGroup: { select: { id: true, classroomId: true, name: true } } },
})
ok(!!assign, `انتساب تدریس پیدا شد (${assign?.subjectGroup?.name ?? '-'})`)

// ۳) ساخت جلسه از مسیر واقعی API
const createRes = await fetch(`${BASE}/api/live-sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    classroomId: assign.subjectGroup.classroomId,
    notifyGroupId: assign.subjectGroup.id,
    title: 'تست شروع کلاس',
  }),
})
const created = await createRes.json()
ok(createRes.status === 201, `ساخت جلسه (${createRes.status}) ${created.id ?? created.error ?? ''}`)

// ۴) اتصال سوکت و ورود به جلسه — همان مسیر اپ
const socket = io(`${BASE}/?XTransformPort=3003`, {
  path: '/socket.io',
  transports: ['polling', 'websocket'],
  withCredentials: true,
  extraHeaders: { cookie },
  timeout: 10000,
})
const joinResult = await new Promise((resolve) => {
  const t = setTimeout(() => resolve({ timeout: true }), 15000)
  socket.on('connect', () => {
    socket.emit('live:join', { sessionId: created.id }, (res) => {
      clearTimeout(t)
      resolve(res)
    })
  })
  socket.on('connect_error', (e) => console.log('  connect_error:', e.message))
})
ok(!joinResult.timeout, 'ack ورود دریافت شد (بدون تایم‌اوت)')
ok(joinResult?.ok === true, `ورود به جلسه موفق ${joinResult?.ok ? '' : '— ' + (joinResult?.error ?? '')}`)

// ۵) پایان جلسه (پاک‌سازی) از مسیر API
if (created.id) {
  const endRes = await fetch(`${BASE}/api/live-sessions/${created.id}/end`, {
    method: 'POST',
    headers: { cookie },
  })
  ok(endRes.ok, `پایان جلسه (${endRes.status})`)
}

socket.disconnect()
await db.$disconnect()
console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`)
process.exit(fail ? 1 : 0)
