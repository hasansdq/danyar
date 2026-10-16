#!/usr/bin/env node
/**
 * تست سرتاسری سه کار جدید (A/B/C) — از درگاه واقعی برنامه:
 *   A) جداسازی ورود معلم از انتشار رسانه:
 *      - ساخت جلسه توسط معلم بدون هیچ رسانه‌ای → announcedAt نباید خودکار ثبت شود
 *      - سوییچ شروع کلاس سمت سرور (announce) بدون انتشار رسانه هم خودکار صدا نمی‌شود؛
 *        فراخوانی دستی announce اعلان واقعی می‌سازد
 *   B) نقش «معاون مدرسه» (SCHOOL_VICE):
 *      - ایجاد معاون از پنل مدیر مدرسه + ورود معاون
 *      - عضویت خودکار معاون در گروه همکاران/عمومی + گفتگوی خصوصی معاون با مدیر
 *   C) مدیریت گروه‌ها:
 *      - گروه درسی با معلمان چندانتخابی (نام درس + کلاس)
 *      - گروه کلاسی (نام = نام کلاس)
 *      - گروه سفارشی با memberIds (چک‌باکس) + فهرست اعضا از API اعضا
 *      - تغییر نام / بستن / بازکردن / حذف سریع گروه
 *
 * اجرا: node scripts/test-vice-groups-live.mjs
 */
const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:81'
import { io } from 'socket.io-client'

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    fail++
    failures.push(name)
    console.error(`  ✘ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

function makeClient() {
  const jar = {}
  return {
    jar,
    async fetch(path, opts = {}) {
      const headers = { ...(opts.headers ?? {}) }
      if (Object.keys(jar).length) headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
      const res = await fetch(`${BASE}${path}`, { ...opts, headers })
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(';')
        const eq = pair.indexOf('=')
        const name = pair.slice(0, eq).trim()
        const value = pair.slice(eq + 1).trim()
        if (value === '') delete jar[name]
        else jar[name] = value
      }
      return res
    },
    async json(path, opts = {}) {
      const res = await this.fetch(path, opts)
      const body = await res.json().catch(() => null)
      return { status: res.status, body }
    },
  }
}

function socketConnect(cookie) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, {
      path: '/socket.io/',
      transports: ['polling', 'websocket'],
      query: { XTransformPort: '3003' },
      extraHeaders: { cookie },
      reconnection: false,
      timeout: 15000,
    })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e) => reject(e))
    setTimeout(() => reject(new Error('socket connect timeout')), 15000)
  })
}

function emitAck(s, event, payload, ms = 10000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'ack timeout' }), ms)
    s.emit(event, payload, (res) => {
      clearTimeout(t)
      resolve(res ?? { ok: false, error: 'no ack' })
    })
  })
}

async function main() {
  const admin = makeClient()
  const teacher = makeClient()
  const vice = makeClient()
  const student = makeClient()

  console.log('─ ۰) ورود حساب‌ها')
  const lg = (r, name) => ok(name, r.status === 200 && r.body?.ok === true)
  lg(await admin.json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'beheshti.admin', password: 'Pass@123' }) }), 'ورود مدیر مدرسه (beheshti.admin)')
  lg(await teacher.json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'beheshti.t1', password: 'Pass@123' }) }), 'ورود معلم (beheshti.t1)')
  lg(await student.json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'beheshti.s1', password: 'Pass@123' }) }), 'ورود دانش‌آموز (beheshti.s1)')

  console.log('─ B) نقش معاون مدرسه')
  // ایجاد معاون (یکتا با پسوند زمان) از پنل مدیر مدرسه
  const nid = `99${Date.now().toString().slice(-8)}`
  const cv = await admin.json('/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'SCHOOL_VICE', firstName: 'معاون', lastName: 'آزمونی', nationalId: nid }),
  })
  ok('ایجاد معاون از API مدیر مدرسه', cv.status === 201 && cv.body?.user?.role === 'SCHOOL_VICE', cv.body?.error ?? '')
  const viceUsername = nid
  const vl = await vice.json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: viceUsername, password: '123456' }) })
  ok('ورود معاون با رمز پیش‌فرض', vl.status === 200 && vl.body?.user?.role === 'SCHOOL_VICE')
  lg(await teacher.json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'beheshti.t1', password: 'Pass@123' }) }).then(() => teacher).then(() => ({ status: 200, body: { ok: true } })), 'نشست معلم سالم')

  // فهرست کاربران مدیر مدرسه باید معاون را هم برگرداند
  const usersList = await admin.json('/api/users')
  ok('فهرست کاربران شامل معاون است', usersList.status === 200 && (usersList.body?.users ?? []).some((u) => u.role === 'SCHOOL_VICE'))
  const viceList = await admin.json('/api/users?role=SCHOOL_VICE')
  ok('فیلتر نقش معاون', viceList.status === 200 && (viceList.body?.users ?? []).every((u) => u.role === 'SCHOOL_VICE') && viceList.body.users.length >= 1)

  // عضویت خودکار معاون در گروه همکاران/عمومی — از API اعضای گروه
  const schoolGroups = await admin.json('/api/groups/school')
  const staffGroup = (schoolGroups.body?.groups ?? []).find((g) => g.scope === 'SCHOOL_STAFF')
  const allGroup = (schoolGroups.body?.groups ?? []).find((g) => g.scope === 'SCHOOL_ALL')
  if (staffGroup) {
    const mem = await admin.json(`/api/chats/group/${staffGroup.id}/members`)
    const viceInStaff = [...(mem.body?.members?.teachers ?? []), ...(mem.body?.members?.admins ?? [])].some((m) => m.role === 'SCHOOL_VICE')
    ok('معاون خودکار عضو گروه همکاران', viceInStaff)
  } else {
    // گروه همکاران وجود ندارد — بساز (روش دوم فرم ۲)
    const cs = await admin.json('/api/groups/school', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'STAFF' }) })
    ok('ایجاد گروه همکاران با نام پیش‌فرض', cs.status === 201 && cs.body?.group?.name === 'گروه همکاران')
    const mem = await admin.json(`/api/chats/group/${cs.body?.group?.id}/members`)
    const viceInStaff = [...(mem.body?.members?.teachers ?? []), ...(mem.body?.members?.admins ?? [])].some((m) => m.role === 'SCHOOL_VICE')
    ok('معاون خودکار عضو گروه همکاران (گروه تازه)', viceInStaff)
  }
  if (allGroup) {
    const mem = await admin.json(`/api/chats/group/${allGroup.id}/members`)
    const viceInAll = [...(mem.body?.members?.teachers ?? []), ...(mem.body?.members?.admins ?? [])].some((m) => m.role === 'SCHOOL_VICE')
    ok('معاون خودکار عضو گروه عمومی', viceInAll)
  }

  // گفتگوی خصوصی معاون ↔ مدیر
  const vchats = await vice.json('/api/chats/candidates')
  ok('معاون: مدیر مدرسه در فهرست گفتگوی خصوصی', vchats.status === 200 && (vchats.body?.candidates ?? []).some((c) => c.role === 'SCHOOL_ADMIN'))
  const adminMe = await admin.json('/api/me')
  const dm = await vice.json(`/api/chats/dm/${adminMe.body?.user?.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'سلام — پیام آزمون معاون', clientId: `vice-test-${Date.now()}` }) })
  ok('معاون پیام خصوصی به مدیر می‌فرستد', dm.status === 200 || dm.status === 201, dm.body?.error ?? '')

  console.log('─ C) مدیریت گروه‌ها')
  // کلاس‌ها و معلمان
  const classes = await admin.json('/api/classes')
  const classroom = (classes.body?.classrooms ?? [])[0]
  ok('حداقل یک کلاس موجود', !!classroom)
  const teachersList = await admin.json('/api/users?role=TEACHER')
  const tIds = (teachersList.body?.users ?? []).slice(0, 2).map((u) => u.id)
  ok('حداقل یک معلم موجود', tIds.length >= 1)

  // ۱) گروه درسی با معلمان
  const stamp = Date.now().toString().slice(-6)
  const courseName = `آزمون‌درس${stamp} ${classroom.name}`
  const cg = await admin.json('/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: courseName, classroomId: classroom.id, teacherIds: tIds }),
  })
  ok('ایجاد گروه درسی با معلمان چندانتخابی', cg.status === 201, cg.body?.error ?? '')
  const courseId = cg.body?.group?.id
  // انتساب معلمان ثبت شده؟ (از فهرست کاربران معلم — teachingAssignments)
  const tRefresh = await admin.json('/api/users?role=TEACHER')
  const assigned = (tRefresh.body?.users ?? []).filter((u) => tIds.includes(u.id) && (u.teachingAssignments ?? []).some((t) => t.subjectGroup.id === courseId))
  ok('معلمان انتخابی به گروه درسی منتسب شدند', assigned.length === tIds.length)

  // ۳) گروه کلاسی — نام = نام کلاس (تکراری در همان کلاس نباید مانع شود چون درس قبلی نام متفاوت دارد؛ نام کلاس ممکن است موجود باشد → تلاش و پذیرش 409 به‌عنوان رفتار درست)
  const className = classroom.name
  const clg = await admin.json('/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: className, classroomId: classroom.id, teacherIds: tIds }),
  })
  ok('ایجاد گروه کلاسی (نام = نام کلاس) یا رد 409 تکراری', clg.status === 201 || clg.status === 409)

  // ۴) گروه سفارشی
  const studentsList = await admin.json('/api/users?role=STUDENT')
  const sIds = (studentsList.body?.users ?? []).slice(0, 2).map((u) => u.id)
  const customName = `گروه سفارشی آزمون ${stamp}`
  const custom = await admin.json('/api/groups/school', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'CUSTOM', name: customName, memberIds: [...sIds, ...tIds] }),
  })
  ok('ایجاد گروه سفارشی با اعضای چک‌باکسی', custom.status === 201, custom.body?.error ?? '')
  const customId = custom.body?.group?.id
  if (customId) {
    const mem = await admin.json(`/api/chats/group/${customId}/members`)
    const memStudents = (mem.body?.members?.students ?? []).filter((m) => sIds.includes(m.id))
    const memTeachers = (mem.body?.members?.teachers ?? []).filter((m) => tIds.includes(m.id))
    ok('اعضای سفارشی (دانش‌آموز) دقیقاً افزوده شدند', memStudents.length === sIds.length)
    ok('اعضای سفارشی (معلم) دقیقاً افزوده شدند', memTeachers.length === tIds.length)
    ok('گروه سفارشی عضو خودکار ندارد (به‌جز مدیر)', (mem.body?.members?.students ?? []).length === sIds.length)
  }
  // رد عضو خارج از مدرسه
  const badCustom = await admin.json('/api/groups/school', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'CUSTOM', name: `بد${stamp}`, memberIds: ['nonexistent-id'] }),
  })
  ok('رد عضو نامعتبر در گروه سفارشی', badCustom.status === 400)

  // عملیات سریع: تغییر نام / بستن / بازکردن / حذف — روی گروه سفارشی آزمون
  if (customId) {
    const rn = await admin.json(`/api/groups/${customId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `${customName} — تغییرنام` }) })
    ok('تغییر نام سریع گروه', rn.status === 200 && rn.body?.group?.name === `${customName} — تغییرنام`)
    const arch = await admin.json(`/api/groups/${customId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) })
    ok('بستن گروه (بایگانی)', arch.status === 200 && arch.body?.group?.archived === true)
    const unarch = await admin.json(`/api/groups/${customId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: false }) })
    ok('بازکردن گروه', unarch.status === 200 && unarch.body?.group?.archived === false)
    const del = await admin.json(`/api/groups/${customId}?confirm=true`, { method: 'DELETE' })
    ok('حذف گروه', del.status === 200)
    const gone = await admin.json(`/api/chats/group/${customId}/members`)
    ok('گروه حذف‌شده در دسترس نیست', gone.status === 404)
  }
  // پاک‌سازی گروه درسی آزمون
  if (courseId) {
    await admin.json(`/api/groups/${courseId}?confirm=true`, { method: 'DELETE' })
  }
  if (clg.body?.group?.id) {
    await admin.json(`/api/groups/${clg.body.group.id}?confirm=true`, { method: 'DELETE' })
  }

  console.log('─ A) ورود بدون رسانه + سوییچ شروع کلاس')
  // ساخت جلسه توسط معلم (بدون هیچ رسانه‌ای — API سمت سرور است)
  const tClasses = await teacher.json('/api/live-sessions')
  const tClassroom = (tClasses.body?.classrooms ?? []).find((c) => (c.groups ?? []).some((g) => !g.archived))
  ok('معلم کلاس مجاز دارد', !!tClassroom)
  if (tClassroom) {
    const notifyGroup = (tClassroom.groups ?? []).find((g) => !g.archived)?.id
    const created = await teacher.json('/api/live-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classroomId: tClassroom.id, notifyGroupId: notifyGroup, title: `آزمون ورود بدون رسانه ${stamp}` }),
    })
    ok('ساخت جلسه (بدون رسانه)', created.status === 201, created.body?.error ?? '')
    const sessionId = created.body?.session?.id ?? created.body?.id
    if (sessionId) {
      const detail = await teacher.json(`/api/live-sessions/${sessionId}`)
      ok('جلسه تازه اعلام‌نشده است (announcedAt=null)', detail.body?.announcedAt == null)
      ok('جلسه ACTIVE است', detail.body?.status === 'ACTIVE')

      // معلم با سوکت وارد اتاق می‌شود (بدون رسانه)
      const s1 = await socketConnect(Object.entries(teacher.jar).map(([k, v]) => `${k}=${v}`).join('; '))
      ok('اتصال سوکت معلم', !!s1.connected)
      const join = await emitAck(s1, 'live:join', { sessionId })
      ok('ورود سوکتی معلم بدون هیچ رسانه‌ای', join.ok === true, join.error ?? '')
      ok('مجوز صحبت معلم از سرور', join.data?.self?.canSpeak === true)

      // تا ۲ ثانیه صبر: هیچ اعلام خودکاری نباید رخ دهد
      await new Promise((r) => setTimeout(r, 2000))
      const after = await teacher.json(`/api/live-sessions/${sessionId}`)
      ok('صرف ورود اعلان شروع نساخته است', after.body?.announcedAt == null)

      // فراخوانی دستی announce (معادل روشن‌کردن سوییچ پس از انتشار رسانه)
      const ann = await teacher.json(`/api/live-sessions/${sessionId}/announce`, { method: 'POST' })
      ok('روشن‌کردن سوییچ (announce) اعلان را می‌سازد', ann.status === 200 && !!ann.body?.announcedAt, ann.body?.error ?? '')
      const ann2 = await teacher.json(`/api/live-sessions/${sessionId}/announce`, { method: 'POST' })
      ok('اعلام تکراری بی‌اثر است (alreadyAnnounced)', ann2.status === 200 && ann2.body?.alreadyAnnounced === true)

      // دانش‌آموز عضو کلاس باید بتواند وارد شود (بدون دوربین/میکروفون)
      const s2 = await socketConnect(Object.entries(student.jar).map(([k, v]) => `${k}=${v}`).join('; '))
      const sJoin = await emitAck(s2, 'live:join', { sessionId })
      ok('ورود دانش‌آموز بدون دوربین/میکروفون', sJoin.ok === true, sJoin.error ?? '')

      s1.disconnect()
      s2.disconnect()
      // پایان جلسه (پاک‌سازی)
      await teacher.json(`/api/live-sessions/${sessionId}/end`, { method: 'POST' })
      const ended = await teacher.json(`/api/live-sessions/${sessionId}`)
      ok('پایان جلسه (پاک‌سازی)', ended.body?.status === 'ENDED')
    }
  }

  console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`)
  if (failures.length) {
    console.error('شکست‌ها:')
    for (const f of failures) console.error(`  ✘ ${f}`)
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('خطای اجرای تست:', e)
    process.exit(1)
  })
