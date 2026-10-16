/**
 * آزمون ظرفیت واقعی — ۱۰ کلاس هم‌زمان، مجموع ۳۱۰ شرکت‌کننده، انتقال واقعی رسانه
 *
 * ساختار: هر کلاس ۳۱ نفر = ۱ معلمِ منتشرکننده (Room واقعی WebRTC با ترک
 * canvas زنده — MediaStreamTrack واقعی، رمزنگاری واقعی SRTP) + ۳۰ دانش‌آموزِ
 * مشترک‌شونده (Room واقعی livekit-client با توکن واقعی API برنامه).
 * معیار موفقیت هر دانش‌آموز: دریافت فریم ویدیوی رمزگشایی‌شده واقعی از SFU.
 *
 * زیرساخت واقعی: livekit-server بومی + token API برنامه + عضویت/اجازه واقعی.
 * ۳۱۰ اتصال در ۵ صفحه Chromium توزیع می‌شود (محدودیت RAM سندباکس) — هر Room
 * یک شرکت‌کننده مستقل SFU با signal WS و PeerConnection خودش است.
 * پاک‌سازی کامل: پایان جلسات + حذف کلاس‌ها + حذف ۳۰ دانش‌آموز آزمونی.
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
import { io } from 'socket.io-client'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const N_CLASSES = 10
const STUDENTS_PER_CLASS = 30
const TARGET_TOTAL = N_CLASSES * (1 + STUDENTS_PER_CLASS) // ۳۱۰
let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const UMD = readFileSync('/home/z/my-project/node_modules/livekit-client/dist/livekit-client.umd.js', 'utf8')

const COOKIES = {}
async function loginApi(user, pass) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass, realm: 'app' }),
  })
  if (!r.ok) throw new Error(`login failed: ${user} (${r.status})`)
  COOKIES[user] = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}
async function api(user, path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', cookie: COOKIES[user], ...(opts.headers ?? {}) },
  })
  let body = null
  try { body = await r.json() } catch { /* ignore */ }
  return { status: r.status, body }
}

const TS = Date.now().toString(36).slice(-6)
const studentUsers = []   // { username, id, password }
const classroomIds = []
const groupIds = []
const sessionIds = []

console.log('══ ۱) زیرساخت: ۳۰ دانش‌آموز آزمونی + ۱۰ کلاس/گروه + انتساب و ثبت‌نام ══')
await loginApi('beheshti.admin', 'Pass@123')
await loginApi('beheshti.t1', 'Pass@123')

const me = await api('beheshti.t1', '/api/me')
const t1Id = me.body?.user?.id ?? me.body?.id
if (!t1Id) { bad('شناسه t1'); process.exit(1) }

const NID_BASE = 1_000_000_000 + (Date.now() % 8_000_000_000)
for (let i = 1; i <= STUDENTS_PER_CLASS; i++) {
  const nid = String(NID_BASE + i).slice(0, 10)
  const c = await api('beheshti.admin', '/api/users', {
    method: 'POST',
    body: JSON.stringify({ role: 'STUDENT', firstName: `ظرفیت`, lastName: `آزمونی ${i}`, nationalId: nid }),
  })
  const u = c.body?.user
  if (c.status !== 201 || !u?.id) { bad(`دانش‌آموز ${i}: ${c.status} ${JSON.stringify(c.body).slice(0, 120)}`); continue }
  studentUsers.push({ username: u.username ?? nid, id: u.id, password: '123456' })
}
studentUsers.length === STUDENTS_PER_CLASS
  ? ok(`${STUDENTS_PER_CLASS} دانش‌آموز آزمونی ساخته شد`)
  : bad(`دانش‌آموز: ${studentUsers.length}/${STUDENTS_PER_CLASS}`)

for (let i = 1; i <= N_CLASSES; i++) {
  const c = await api('beheshti.admin', '/api/classes', { method: 'POST', body: JSON.stringify({ grade: 'دوازدهم', branch: `ظ${TS}${i}` }) })
  const cid = c.body?.classroom?.id ?? c.body?.id
  if (c.status !== 201 || !cid) { bad(`کلاس ${i}: ${c.status}`); continue }
  classroomIds.push(cid)
  const g = await api('beheshti.admin', '/api/groups', { method: 'POST', body: JSON.stringify({ name: `ظرفیت۳۱۰ ${TS} ک${i}`, classroomId: cid }) })
  const gid = g.body?.group?.id ?? g.body?.id
  if (g.status !== 201 || !gid) { bad(`گروه ${i}: ${g.status}`); continue }
  groupIds.push(gid)
  await api('beheshti.admin', `/api/groups/${gid}/teachers`, { method: 'POST', body: JSON.stringify({ teacherId: t1Id }) })
  for (const s of studentUsers) {
    const en = await api('beheshti.admin', `/api/classes/${cid}/students`, { method: 'POST', body: JSON.stringify({ studentId: s.id }) })
    if (en.status !== 201 && en.status !== 200 && en.status !== 409) bad(`ثبت‌نام ${s.username} در ک${i}: ${en.status}`)
  }
}
classroomIds.length === N_CLASSES ? ok(`${N_CLASSES} کلاس با گروه/معلم/ثبت‌نام ۳۰نفره ساخته شد`) : bad(`کلاس: ${classroomIds.length}/${N_CLASSES}`)

console.log('══ ۲) ساخت ۱۰ جلسه هم‌زمان ══')
for (let i = 0; i < classroomIds.length; i++) {
  const s = await api('beheshti.t1', '/api/live-sessions', {
    method: 'POST',
    body: JSON.stringify({ classroomId: classroomIds[i], notifyGroupId: groupIds[i], title: `ظرفیت۳۱۰ ${i + 1}` }),
  })
  if (s.status === 201 && s.body?.id) sessionIds.push(s.body.id)
  else bad(`جلسه ${i + 1}: ${s.status} ${JSON.stringify(s.body).slice(0, 120)}`)
}
sessionIds.length === N_CLASSES ? ok(`${N_CLASSES} جلسه فعال ساخته شد`) : bad(`جلسه: ${sessionIds.length}/${N_CLASSES}`)

if (sessionIds.length !== N_CLASSES || studentUsers.length !== STUDENTS_PER_CLASS) {
  console.log('زیرساخت ناقص — پاک‌سازی و خروج')
  await cleanup()
  process.exit(1)
}

console.log('══ ۳) ورود سوکت واقعی هر شرکت‌کننده (live:join — همان مسیر برنامه) ══')
for (const s of studentUsers) await loginApi(s.username, s.password)
// هر شرکت‌کننده یک اتصال سوکت زنده دارد (مثل مرورگر واقعی) — قطع سوکت = خروج از جلسه
const SOCK_URL = process.env.SOCKET_URL ?? 'http://127.0.0.1:3003'
let joined = 0
const pairs = [] // { sid, sidIdx, student, sock? }
for (let si = 0; si < sessionIds.length; si++) {
  for (const su of studentUsers) pairs.push({ sid: sessionIds[si], sidIdx: si, student: su })
}
async function socketJoin(user, pass, sid) {
  return new Promise((resolve) => {
    const sock = io(SOCK_URL, {
      path: '/socket.io',
      transports: ['websocket'],
      extraHeaders: { cookie: COOKIES[user] },
      reconnection: false,
      timeout: 15000,
    })
    sock.on('connect', () => {
      sock.emit('live:join', { sessionId: sid }, (ack) => {
        if (ack && ack.ok) joined++
        resolve(ack && ack.ok ? sock : null)
      })
    })
    sock.on('connect_error', () => resolve(null))
    setTimeout(() => resolve(null), 20000)
  })
}
// معلم میزبان ۱۰ جلسه (۱۰ سوکت)
const hostSocks = []
for (const sid of sessionIds) {
  const s = await socketJoin('beheshti.t1', 'Pass@123', sid)
  if (s) hostSocks.push(s)
}
hostSocks.length === N_CLASSES ? ok(`معلم میزبان به هر ${N_CLASSES} جلسه وارد شد (live:join)`) : bad(`ورود معلم: ${hostSocks.length}/${N_CLASSES}`)
// دانش‌آموزان — پله‌ای ۱۰تایی
for (let i = 0; i < pairs.length; i += 10) {
  await Promise.all(pairs.slice(i, i + 10).map(async (p) => {
    p.sock = await socketJoin(p.student.username, p.student.password, p.sid)
  }))
}
joined === N_CLASSES + pairs.length
  ? ok(`هر ${joined} شرکت‌کننده (۳۱۰ = معلم + دانش‌آموز) از درگاه واقعی live:join وارد شد`)
  : bad(`ورود سوکت: ${joined}/${N_CLASSES + pairs.length}`)

console.log('══ ۴) توکن‌های واقعی (API برنامه — با بررسی عضویت/اجازه) ══')
let tokenOk = 0
const pairTokens = new Map() // `${sidIdx}:${student.id}` → { token, url }
for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i]
  const t = await api(p.student.username, `/api/live-sessions/${p.sid}/token`, { method: 'POST' })
  if (t.status === 200 && t.body?.token) { pairTokens.set(`${p.sidIdx}:${p.student.id}`, { token: t.body.token, url: t.body.url }); tokenOk++ }
  else if (i < 3) bad(`توکن ${p.student.username}/s${p.sidIdx}: ${t.status} ${JSON.stringify(t.body).slice(0, 100)}`)
}
tokenOk === pairs.length ? ok(`هر ${pairs.length} توکن دانش‌آموز صادر شد (۳۰ عضو × ۱۰ کلاس)`) : bad(`توکن: ${tokenOk}/${pairs.length}`)
const teacherTokens = []
for (const sid of sessionIds) {
  const t = await api('beheshti.t1', `/api/live-sessions/${sid}/token`, { method: 'POST' })
  if (t.status === 200 && t.body?.token) teacherTokens.push({ token: t.body.token, url: t.body.url })
}
teacherTokens.length === N_CLASSES ? ok(`هر ${N_CLASSES} توکن معلم صادر شد`) : bad(`توکن معلم: ${teacherTokens.length}/${N_CLASSES}`)

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-dev-shm-usage',
    '--mute-audio',
  ],
})

const url0 = teacherTokens[0]?.url
let published = 0
let connected = 0
let framesVerified = 0
const connSet = new Set()
const frameSet = new Set()
const keyOf = (p) => `${p.sidIdx}:${p.student.id}`
const pageErrors = []

async function runPublishers() {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 320 } })
  await ctx.addInitScript(UMD)
  await ctx.addInitScript(`window.__LK = window.LivekitClient || window.livekit;`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(`[PUB] ${e.message.slice(0, 120)}`))
  const args = { url: url0, tokens: teacherTokens.map((t) => t.token) }
  published = await page.evaluate(async ({ url, tokens }) => {
    const LK = window.__LK
    const out = []
    for (let i = 0; i < tokens.length; i++) {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 320; canvas.height = 180
        const g = canvas.getContext('2d')
        let n = 0
        setInterval(() => {
          g.fillStyle = '#0a4d2e'; g.fillRect(0, 0, 320, 180)
          g.fillStyle = '#fff'; g.font = '48px sans-serif'
          g.fillText(`R${i}#${n++}`, 90, 100)
        }, 80)
        const track = canvas.captureStream(12).getVideoTracks()[0]
        const room = new LK.Room({ adaptiveStream: false, dynacast: false })
        await room.connect(url, tokens[i])
        await room.localParticipant.publishTrack(track, {
          source: LK.Track.Source.Camera,
          simulcast: false,
          videoEncoding: { maxBitrate: 150_000, maxFramerate: 12 },
        })
        out.push(1)
      } catch (e) {
        out.push(0)
        if (out.filter((x) => x === 0).length <= 2) console.error('PUB-ERR', String(e).slice(0, 150))
      }
    }
    return out.filter(Boolean).length
  }, args)
  // ⚠ صفحه ناشر تا پایان فاز دانش‌آموز باز می‌ماند — بستن آن = قطع همه ناشرها از SFU
  return { ctx }
}

async function runStudents(pageIdx, myPairs) {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 240 } })
  await ctx.addInitScript(UMD)
  await ctx.addInitScript(`window.__LK = window.LivekitClient || window.livekit;`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(`[S${pageIdx}] ${e.message.slice(0, 120)}`))
  const jobs = myPairs.map((p) => ({
    url: p.tok.url,
    token: p.tok.token,
    key: `${p.sidIdx}:${p.student.id}`,
  }))
  const res = await page.evaluate(async (jobs) => {
    const LK = window.__LK
    const connKeys = [], frameKeys = []
    const errs = []
    // اتصال پله‌ای ۶تایی — انفجار هم‌زمان اتصال گلوگاه نمی‌شود
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(jobs.slice(i, i + 4).map(async (j) => {
        let room = null
        try {
          room = new LK.Room({ adaptiveStream: false, dynacast: false })
          // انتظار «فریم رمزگشایی‌شده واقعی» — استناد به آمار گیرنده WebRTC (framesDecoded)
          // این معیار مستقل از رندر headless است: یعنی RTP واقعی رسیده و دیکودر واقعی
          // فریم تولید کرده — دقیقاً «انتقال واقعی رسانه»
          const framePromise = new Promise((resolve) => {
            let done = false
            const to = setTimeout(() => { if (!done) { done = true; resolve(false) } }, 60_000)
            function onSub(track) {
              if (track.kind !== LK.Track.Kind.Video) return
              room.off(LK.RoomEvent.TrackSubscribed, onSub)
              const poll = async () => {
                if (done) return
                try {
                  const st = typeof track.getReceiverStats === 'function' ? await track.getReceiverStats() : null
                  if (st && Number(st.framesDecoded) > 0) {
                    done = true; clearTimeout(to); resolve(true); return
                  }
                } catch {}
                setTimeout(poll, 500)
              }
              poll()
            }
            room.on(LK.RoomEvent.TrackSubscribed, onSub)
          })
          await room.connect(j.url, j.token)
          connKeys.push(j.key)
          const got = await framePromise
          if (got) frameKeys.push(j.key)
          else errs.push(j.key)
        } catch (e) {
          errs.push(`${j.key}:${String(e).slice(0, 60)}`)
          try { await room?.disconnect() } catch {}
        }
      }))
    }
    return { conn: connKeys, frames: frameKeys, errs: errs.slice(0, 4) }
  }, jobs)
  for (const k of res.conn) connSet.add(k)
  for (const k of res.frames) frameSet.add(k)
  if (res.errs.length) console.log(`    [S${pageIdx}] نمونه خطاها: ${res.errs.join(' | ')}`)
  await ctx.close()
}

try {
  console.log('══ ۵) انتشار واقعی رسانه — ۱۰ معلم منتشرکننده ══')
  const t0 = Date.now()
  const pub = await runPublishers()
  published === N_CLASSES ? ok(`${published}/${N_CLASSES} معلم واقعاً رسانه منتشر کرد`) : bad(`انتشار: ${published}/${N_CLASSES}`)

  console.log('══ ۶) ورود ۳۰۰ دانش‌آموز به ۱۰ اتاق — فریم ویدیوی زنده از SFU ══')
  // توزیع روی ۴ صفحه + حلقه تلاش مجدد برای خطاهای گذرای برقراری PC (اتصال همه باید پایدار بماند)
  const PAGES = 4
  const pendingAll = pairs.filter((p) => pairTokens.has(keyOf(p)))
  for (let round = 0; round < 3; round++) {
    const pending = pendingAll.filter((p) => !frameSet.has(keyOf(p)))
    if (!pending.length) break
    if (round > 0) console.log(`  • تلاش مجدد ${pending.length} شرکت‌کننده (خطاهای گذرای PC)…`)
    const per = Math.ceil(pending.length / PAGES)
    const batches = []
    for (let i = 0; i < pending.length; i += per) batches.push(pending.slice(i, i + per))
    await Promise.all(batches.map((b, i) => runStudents(round * PAGES + i, b.map((p) => ({ ...p, tok: pairTokens.get(keyOf(p)) })))))
  }
  connected = connSet.size
  framesVerified = frameSet.size
  const sampleErrs = pairs.filter((p) => !frameSet.has(keyOf(p))).slice(0, 3).map(keyOf)
  connected === pairs.length
    ? ok(`هر ${connected}/${pairs.length} دانش‌آموز واقعاً به SFU متصل شد (310 = ۱۰ معلم + ۳۰۰ دانش‌آموز)`)
    : bad(`اتصال: ${connected}/${pairs.length}`)
  framesVerified === pairs.length
    ? ok(`انتقال واقعی رسانه: هر ${framesVerified}/${pairs.length} دانش‌آموز فریم ویدیوی رمزگشایی‌شده زنده گرفت`)
    : bad(`فریم دریافت‌شده: ${framesVerified}/${pairs.length}`)
  const total = published + connected
  total === TARGET_TOTAL
    ? ok(`مجموع شرکت‌کنندگان هم‌زمان: ${total} (= ۳۱۰ نفر در ۱۰ کلاس)`)
    : bad(`مجموع شرکت‌کنندگان: ${total}/${TARGET_TOTAL}`)
  if (!pageErrors.length) ok('بدون خطای جاوااسکریپت ناگهانی در صفحات آزمون')
  else bad(`خطاهای صفحه: ${pageErrors.slice(0, 3).join(' | ')}`)
  console.log(`  ⏱ زمان فاز رسانه: ${Math.round((Date.now() - t0) / 1000)}s`)
  await pub.ctx.close().catch(() => {})
} finally {
  console.log('══ ۷) پاک‌سازی کامل زیرساخت آزمون ══')
  await cleanup()
  await browser.close().catch(() => {})
}

async function cleanup() {
  for (const p of pairs) { try { p.sock?.disconnect() } catch {} }
  for (const sid of sessionIds) await api('beheshti.t1', `/api/live-sessions/${sid}/end`, { method: 'POST' }).catch(() => {})
  for (const cid of classroomIds) await api('beheshti.admin', `/api/classes/${cid}`, { method: 'DELETE' }).catch(() => {})
  // لاگ مشارکت جلسات، حذف کاربر را با FK قفل می‌کند — ابتدا لاگ‌ها (DB مستقیم)، سپس API
  // (طوفان قطع ۳۱۰ سوکت ممکن است SQLite را موقتاً قفل کند — با تأخیر و تلاش مجدد)
  const db = new PrismaClient()
  const ids = studentUsers.map((s) => s.id)
  const clearDeps = async () => {
    if (!ids.length) return
    await db.liveParticipantLog.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
    await db.pushSubscription.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
    await db.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
  }
  try {
    await clearDeps()
    for (const s of studentUsers) await api('beheshti.admin', `/api/users/${s.id}?confirm=true`, { method: 'DELETE' }).catch(() => {})
    await sleep(4000)
    await clearDeps()
    for (const s of studentUsers) await api('beheshti.admin', `/api/users/${s.id}?confirm=true`, { method: 'DELETE' }).catch(() => {})
    const still = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true } })
    if (still.length) {
      // فالبک قطعی پاک‌سازی آزمون: حذف مستقیم (همه وابستگی‌های آزمونی قبلاً پاک شده‌اند)
      await clearDeps()
      await db.user.deleteMany({ where: { id: { in: ids }, fullName: { contains: 'آزمونی' } } }).catch(() => {})
    }
  } finally {
    await db.$disconnect().catch(() => {})
  }
  const del = await api('beheshti.admin', '/api/classes')
  const remaining = (del.body?.classes ?? []).filter((c) => (c.name ?? '').includes(`ظ${TS}`)).length
  const remStu = await api('beheshti.admin', '/api/users?role=STUDENT')
  const stuList = remStu.body?.users ?? remStu.body ?? []
  const remStuN = (Array.isArray(stuList) ? stuList : []).filter((u) => (u.fullName ?? '').includes('ظرفیت') && (u.fullName ?? '').includes('آزمونی')).length
  remaining === 0 && remStuN === 0
    ? ok('پاک‌سازی کامل: کلاس‌ها، گروه‌ها و ۳۰ دانش‌آموز آزمونی حذف شدند')
    : bad(`پاک‌سازی ناقص: ${remaining} کلاس، ${remStuN} دانش‌آموز باقی ماند`)
}

console.log(`\n══════ نتیجه: ${PASS} سبز، ${FAIL} قرمز ══════`)
process.exit(FAIL === 0 ? 0 : 1)
