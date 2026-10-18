#!/usr/bin/env node
/**
 * تست انبوه «ثبت غیبت / نمره / تکلیف / تخلف برای چند دانش‌آموز» (درخواست کاربر)
 * همه‌چیز از مسیر API واقعی (پورت ۳۰۰۰) — بدون دستکاری مستقیم دیتابیس.
 *
 * سناریو:
 *  A) مدیر مدرسه: آماده‌سازی — کلاس «هفتم ۷۰۳» + گروه + درس‌ها + انتساب معلم + ثبت‌نام
 *  B) معلم: ثبت انبوه — غیبت ۳ دانش‌آموز یکجا، نمره ۴ دانش‌آموز یکجا، ۳ تخلف، تکلیف گروهی
 *  C) دانش‌آموز: راستی‌آزمایی گزارش کار خودش (نمره/غیبت/تخلف) + دیدن تکلیف
 *  D) مدیر: گزارش عملکرد + کنترل دسترسی
 *  E) موارد منفی: نمره بدون عنوان، رکورد تکراری، وضعیت نامعتبر، نمره توسط مدیر، تخلف توسط دانش‌آموز
 *
 * اجرا: bun scripts/test-bulk-records.mjs
 * (اسکریپت idempotent است: موجودیت‌ها را می‌یابد یا می‌سازد؛ شمارش‌ها «حداقل» بررسی می‌شوند)
 */
import { toJalaali, toGregorian } from 'jalaali-js'

const BASE = 'http://localhost:3000'
const PASS = 'Pass@123'

let passCount = 0
let failCount = 0
function ok(name, cond, extra = '') {
  if (cond) {
    passCount++
    console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    failCount++
    console.error(`  ✘ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function login(username, password = PASS) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json().catch(() => ({}))
  const cookies = res.headers.getSetCookie?.() ?? []
  return { status: res.status, data, cookie: cookies.map((c) => c.split(';')[0]).join('; ') }
}

async function api(jar, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Cookie: jar.cookie, ...(opts.headers ?? {}) },
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

const pad = (n) => String(n).padStart(2, '0')
function jalaliToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const [gy, gm, gd] = fmt.format(new Date()).split('-').map(Number)
  const j = toJalaali(gy, gm, gd)
  return `${j.jy}-${pad(j.jm)}-${pad(j.jd)}`
}
function jalaliShift(key, days) {
  const [jy, jm, jd] = key.split('-').map(Number)
  const g = toGregorian(jy, jm, jd)
  const d = new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 12))
  d.setUTCDate(d.getUTCDate() + days)
  const j = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  return `${j.jy}-${pad(j.jm)}-${pad(j.jd)}`
}

console.log('════════ تست ثبت انبوه غیبت/نمره/تکلیف/تخلف ════════')
const TODAY = jalaliToday()
const TOMORROW = jalaliShift(TODAY, 1)
console.log(`امروز جلالی: ${TODAY} — فردا: ${TOMORROW}`)

/* ═══ A) ورود مدیر مدرسه و آماده‌سازی ═══ */
console.log('\n── A) آماده‌سازی (مدیر مدرسه) ──')
const admin = await login('beheshti.admin')
ok('A1 ورود مدیر مدرسه', admin.status === 200)

// کلاس «هفتم ۷۰۳» — ساخت یا یافتن
let r = await api(admin, '/api/classes', { method: 'POST', body: JSON.stringify({ grade: 'هفتم', branch: '703' }) })
let class703 = r.status === 201 ? r.data.classroom : null
if (!class703) {
  const list = await api(admin, '/api/classes')
  class703 = (list.data.classrooms ?? []).find((c) => c.name.replace(/\s+/g, ' ').includes('هفتم ۷۰۳') || c.name.includes('703') || c.name.includes('۷۰۳')) ?? null
}
ok('A2 کلاس «هفتم ۷۰۳» موجود/ایجاد شد', !!class703, class703?.name ?? '')

// گروه «ریاضی هفتم ۷۰۳» با معلم t1
const users = await api(admin, '/api/users?limit=100')
const allUsers = users.data.users ?? []
const t1 = allUsers.find((u) => u.username === 'beheshti.t1')
const s1 = allUsers.find((u) => u.username === 'beheshti.s1')
const s2 = allUsers.find((u) => u.username === 'beheshti.s2')
const s3 = allUsers.find((u) => u.username === 'beheshti.s3')
const s4 = allUsers.find((u) => u.username === 'beheshti.s4')
ok('A3 کاربران دمو یافت شدند', !!(t1 && s1 && s2 && s3 && s4))

r = await api(admin, '/api/groups', {
  method: 'POST',
  body: JSON.stringify({ name: 'ریاضی هفتم ۷۰۳', classroomId: class703.id, teacherIds: [t1.id] }),
})
let group703 = r.status === 201 ? r.data.group : null
if (!group703) {
  const cd = await api(admin, `/api/classes/${class703.id}`)
  group703 = (cd.data.groups ?? []).find((g) => g.name === 'ریاضی هفتم ۷۰۳') ?? null
}
ok('A4 گروه «ریاضی هفتم ۷۰۳» با معلم t1', !!group703, r.status === 201 ? 'ایجاد شد' : 'موجود بود')

// کلاس هفتم۱ (برای جلسه انبوه)
const classes = await api(admin, '/api/classes')
const class7 = (classes.data.classrooms ?? []).find((c) => c.name === 'هفتم۱')
ok('A5 کلاس «هفتم۱» یافت شد', !!class7)

// گروه ریاضی هفتم۱ (برای تکلیف) — از جزئیات کلاس (شامل گروه‌های درسی)
r = await api(admin, `/api/classes/${class7.id}`)
const math7 = (r.data.groups ?? []).find((g) => g.name === 'ریاضی هفتم۱')
ok('A6 گروه «ریاضی هفتم۱» یافت شد', !!math7)

// درس‌ها — ساخت یا یافتن
r = await api(admin, '/api/lessons', { method: 'POST', body: JSON.stringify({ names: ['ریاضی', 'علوم'] }) })
const lessons = await api(admin, '/api/lessons')
const mathLesson = (lessons.data.lessons ?? []).find((l) => l.name === 'ریاضی')
ok('A7 درس «ریاضی» موجود/ایجاد شد', !!mathLesson, r.status === 201 ? 'ایجاد شد' : 'موجود بود')

// انتساب درس ریاضی به معلم t1
r = await api(admin, `/api/users/${t1.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ lessonIds: [mathLesson.id] }),
})
ok('A8 انتساب درس ریاضی به معلم t1', r.status === 200)

// ثبت‌نام s4 در هر دو کلاس (هفتم۱ + هفتم ۷۰۳)
r = await api(admin, `/api/users/${s4.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ classroomIds: [class7.id, class703.id] }),
})
ok('A9 ثبت‌نام s4 در کلاس‌های هفتم۱ + هفتم ۷۰۳', r.status === 200)

/* ═══ B) ثبت انبوه توسط معلم ═══ */
console.log('\n── B) ثبت انبوه (معلم beheshti.t1) ──')
const teacher = await login('beheshti.t1')
ok('B1 ورود معلم', teacher.status === 200)

// جلسه امروز کلاس هفتم۱ — یافتن یا ساخت
let session = null
r = await api(teacher, `/api/attendance/sessions?classroomId=${class7.id}&from=${TODAY}&to=${TODAY}`)
const todays = r.data.sessions ?? []
session = todays.find((s) => s.title === 'جلسه انبوه') ?? todays.find((s) => s.status === 'DRAFT') ?? null
if (!session) {
  r = await api(teacher, '/api/attendance/sessions', {
    method: 'POST',
    body: JSON.stringify({ classroomId: class7.id, dateKey: TODAY, title: 'جلسه انبوه' }),
  })
  session = r.data.session ?? null
}
ok('B2 جلسه امروز کلاس هفتم۱ موجود/ایجاد شد', !!session, session ? `${session.title} (${session.status})` : '')

// B3 — غیبت انبوه: s1 و s2 و s3 غایب، s4 حاضر (یک درخواست)
r = await api(teacher, `/api/attendance/sessions/${session.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    records: [
      { studentId: s1.id, status: 'ABSENT', note: 'غیبت غیرموجه — ثبت انبوه' },
      { studentId: s2.id, status: 'ABSENT', note: 'غیبت با مجوز' },
      { studentId: s3.id, status: 'ABSENT' },
      { studentId: s4.id, status: 'PRESENT' },
    ],
  }),
})
ok('B3 غیبت انبوه ۳ دانش‌آموز یکجا', r.status === 200, `HTTP ${r.status}${r.data?.error ? ' — ' + r.data.error : ''}`)

// B4 — نمره انبوه: ۴ دانش‌آموز یکجا با عنوان و درس
r = await api(teacher, `/api/attendance/sessions/${session.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    grades: [
      { studentId: s1.id, score: '۱۸' },
      { studentId: s2.id, score: '۱۶٫۵' },
      { studentId: s3.id, score: '19' },
      { studentId: s4.id, score: '20' },
    ],
    gradeTitle: 'آزمون ثبت انبوه',
    gradeLessonId: mathLesson.id,
  }),
})
ok('B4 نمره انبوه ۴ دانش‌آموز یکجا (با عنوان و درس)', r.status === 200, `HTTP ${r.status}${r.data?.error ? ' — ' + r.data.error : ''}`)

// B5 — تکلیف گروهی با مهلت فردا (تکلیف برای کل گروه = انبوه)
// هم‌سبک تقویم آموزشی: پس از ساخت تکلیف، رویداد HOMEWORK متصل هم ثبت می‌شود
const dueLocal = (() => {
  const [jy, jm, jd] = TOMORROW.split('-').map(Number)
  const g = toGregorian(jy, jm, jd)
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}T23:59`
})()
r = await api(teacher, '/api/assignments', {
  method: 'POST',
  body: JSON.stringify({
    subjectGroupId: math7.id,
    title: 'تمرین فصل ۳ ریاضی (تست انبوه)',
    description: 'حل تمرین‌های صفحات ۴۰ تا ۴۲ کتاب ریاضی — ثبت انبوه',
    dueAt: dueLocal,
    maxGrade: 20,
  }),
})
const assignmentId = r.data?.id ?? null
ok('B5 تکلیف گروهی با مهلت فردا', r.status === 201 && !!assignmentId, assignmentId ? `مهلت: ${dueLocal}` : `HTTP ${r.status}`)
if (assignmentId) {
  const ev = await api(teacher, '/api/calendar/events', {
    method: 'POST',
    body: JSON.stringify({
      classroomId: class7.id,
      dateKey: TOMORROW,
      type: 'HOMEWORK',
      description: 'حل تمرین‌های صفحات ۴۰ تا ۴۲ کتاب ریاضی — ثبت انبوه',
      assignmentId,
    }),
  })
  ok('B5b رویداد HOMEWORK متصل در تقویم فردا', ev.status === 201, `HTTP ${ev.status}`)
}

// B6 — تخلف انبوه: ۳ دانش‌آموز (سه درخواست متوالی — فهرست چندانتخابی انواع تخلف)
let violOk = 0
for (const [stu, text] of [
  [s1, 'بی‌ادبی با معلم'],
  [s2, 'استفاده از تلفن همراه'],
  [s3, 'انجام ندادن تکلیف'],
]) {
  const vr = await api(teacher, '/api/attendance/violations', {
    method: 'POST',
    body: JSON.stringify({
      studentId: stu.id,
      classroomId: class7.id,
      dateKey: TODAY,
      sessionId: session.id,
      texts: [text],
    }),
  })
  if (vr.status === 200 || vr.status === 201) violOk++
}
ok('B6 تخلف انبوه ۳ دانش‌آموز', violOk === 3, `${violOk}/۳ ثبت شد`)

// B7 — نهایی‌سازی جلسه
r = await api(teacher, `/api/attendance/sessions/${session.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ action: 'finalize' }),
})
ok('B7 نهایی‌سازی جلسه', r.status === 200 && r.data.session?.status === 'FINALIZED')

/* ═══ E) موارد منفی — یافتن مشکلات احتمالی ═══ */
console.log('\n── E) موارد منفی (کنترل‌های سرور) ──')

// نمره بدون عنوان → 400 با عین پیام کاربر
r = await api(teacher, `/api/attendance/sessions/${session.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    grades: [{ studentId: s1.id, score: '15' }],
    gradeTitle: '',
    gradeLessonId: mathLesson.id,
  }),
})
const TITLE_MSG = 'لطفاً عنوان نمره‌ای که برای دانش‌آموزان ثبت کرده‌اید را وارد نمایید'
ok('E1 نمره بدون عنوان → 400 + عین پیام', r.status === 400 && (r.data?.error ?? '').includes('عنوان نمره'), `HTTP ${r.status} — ${r.data?.error ?? ''}`)

// رکورد تکراری در یک PATCH → 400
r = await api(teacher, `/api/attendance/sessions/${session.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    records: [
      { studentId: s1.id, status: 'PRESENT' },
      { studentId: s1.id, status: 'ABSENT' },
    ],
  }),
})
ok('E2 رکورد تکراری → 400', r.status === 400, `HTTP ${r.status} — ${r.data?.error ?? ''}`)

// وضعیت نامعتبر → 400
r = await api(teacher, `/api/attendance/sessions/${session.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ records: [{ studentId: s1.id, status: 'LATE' }] }),
})
ok('E3 وضعیت نامعتبر → 400', r.status === 400, `HTTP ${r.status} — ${r.data?.error ?? ''}`)

// نمره توسط مدیر مدرسه → 403
r = await api(admin, `/api/attendance/sessions/${session.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    grades: [{ studentId: s1.id, score: '10' }],
    gradeTitle: 'تلاش مدیر',
    gradeLessonId: mathLesson.id,
  }),
})
ok('E4 نمره توسط مدیر → 403', r.status === 403, `HTTP ${r.status} — ${r.data?.error ?? ''}`)

// تخلف توسط دانش‌آموز → 403
const stu1 = await login('beheshti.s1')
r = await api(stu1, '/api/attendance/violations', {
  method: 'POST',
  body: JSON.stringify({ studentId: s2.id, classroomId: class7.id, dateKey: TODAY, text: 'تخلف جعلی' }),
})
ok('E5 تخلف توسط دانش‌آموز → 403', r.status === 403, `HTTP ${r.status}`)

// نهایی‌سازی دوباره → 400
r = await api(teacher, `/api/attendance/sessions/${session.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ action: 'finalize' }),
})
ok('E6 نهایی‌سازی دوباره → 400', r.status === 400, `HTTP ${r.status} — ${r.data?.error ?? ''}`)

/* ═══ C) راستی‌آزمایی از چشم دانش‌آموز ═══ */
console.log('\n── C) گزارش کار دانش‌آموز ──')
r = await api(stu1, '/api/attendance/my')
const my = r.data ?? {}
const myGrades = my.grades ?? []
const myRecords = my.records ?? []
const myViolations = my.violations ?? []
const bulkGrade = myGrades.find((g) => g.title === 'آزمون ثبت انبوه')
ok('C1 s1 نمرهٔ انبوه را می‌بیند', !!bulkGrade && bulkGrade.score === '۱۸' && bulkGrade.lessonName === 'ریاضی', bulkGrade ? `نمره: ${bulkGrade.score} (${bulkGrade.lessonName})` : 'یافت نشد')
ok('C2 s1 غیبت امروز را می‌بیند', myRecords.some((rec) => rec.dateKey === TODAY && rec.status === 'ABSENT'), `غیبت‌ها: ${my.stats?.absent ?? 0}`)
ok('C3 s1 تخلف انبوه را می‌بیند', myViolations.some((v) => v.text.includes('بی‌ادبی')), `تخلف‌ها: ${my.stats?.violations ?? 0}`)

const stu4 = await login('beheshti.s4')
r = await api(stu4, '/api/assignments')
const stu4Assignments = r.data.assignments ?? []
const hw = stu4Assignments.find((a) => a.title === 'تمرین فصل ۳ ریاضی (تست انبوه)')
ok('C4 s4 تکلیف گروهی را می‌بیند', !!hw, hw ? `مهلت: ${hw.dueAt ?? '—'}` : 'یافت نشد')

// C5 — دانش‌آموز کلاس ۷۰۳ تکلیف خودش را می‌بیند (s4 در دو کلاس)
r = await api(stu4, '/api/calendar/classes')
const calClasses = r.data.classrooms ?? []
ok('C5 s4 تقویم هر دو کلاس را می‌بیند (هفتم۱ + هفتم ۷۰۳)', calClasses.length >= 2, calClasses.map((c) => c.name).join('، '))

/* ═══ D) راستی‌آزمایی مدیر: عملکرد و تقویم ═══ */
console.log('\n── D) گزارش عملکرد مدیر و تقویم ──')
r = await api(admin, '/api/performance')
const perfRows = r.data.students ?? []
const p1 = perfRows.find((p) => p.id === s1.id)
ok('D1 عملکرد s1: تخلف و غیبت شمرده شد', !!p1 && p1.violationCount >= 1 && p1.absentCount >= 1, p1 ? `تخلف: ${p1.violationCount} · غیبت: ${p1.absentCount} · میانگین: ${p1.avgScore ?? '—'}` : '')
ok('D2 عملکرد: آخرین نمرهٔ s1 با درس', !!p1?.lastGrade && p1.lastGrade.score === '۱۸', p1?.lastGrade ? `${p1.lastGrade.score} · ${p1.lastGrade.lessonName ?? 'بدون درس'}` : '')

// رویداد تکلیف روی تقویم فردا + اتصال به تکلیف واقعی
r = await api(admin, `/api/calendar/events?classroomId=${class7.id}&from=${TOMORROW}&to=${TOMORROW}`)
const tomEvents = r.data.events ?? []
const hwEvent = tomEvents.find((e) => e.type === 'HOMEWORK' && (e.assignmentTitle ?? '').includes('تمرین فصل ۳'))
ok('D3 رویداد HOMEWORK فردا در تقویم (متصل به تکلیف)', !!hwEvent && !!hwEvent.assignmentId, hwEvent ? `${hwEvent.assignmentTitle} — ${TOMORROW}` : `رویدادها: ${tomEvents.map((e) => e.type).join('،')}`)

// دسترسی معلم به عملکرد → 403
r = await api(teacher, '/api/performance')
ok('D4 عملکرد برای معلم → 403', r.status === 403, `HTTP ${r.status}`)

console.log(`\n════════ نتیجه: ${passCount} ✔ / ${failCount} ✘ ════════`)
process.exit(failCount ? 1 : 0)
