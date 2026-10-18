// تست مالکیت جلسه + تخلف چندانتخابی + اجباری‌بودن درس (درخواست‌های کاربر)
const BASE = 'http://localhost:3000'
async function login(u, p, realm) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: p, ...(realm ? { realm } : {}) }),
  })
  const cookie = r.headers.get('set-cookie')?.split(';')[0] ?? ''
  return { ok: r.ok, cookie }
}
async function api(who, path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts, headers: { 'content-type': 'application/json', cookie: who.cookie },
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, data }
}
const ok = (name, pass, extra = '') => console.log(`${pass ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)

const t1 = await login('beheshti.t1', 'Pass@123')
const t2 = await login('beheshti.t2', 'Pass@123')
const admin = await login('beheshti.admin', 'Pass@123')

// کلاس هفتم۱ + دانش‌آموز s1
const classes = (await api(t1, '/api/attendance/sessions?from=1400-01-01&to=1500-01-01')).data
const stu = (await api(t1, '/api/attendance/students?classroomId=' + (classes.classrooms?.[0]?.id ?? '')))
const class7 = classes.classrooms?.find(c => c.name.includes('هفتم'))
ok('A1 کلاس‌ها دیده شد', !!class7)

// جلسهٔ امروز توسط t1
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date()).replaceAll('-', '/')
const dateKey = process.argv[2]
const sres = await api(t1, '/api/attendance/sessions', {
  method: 'POST',
  body: JSON.stringify({ classroomId: class7.id, dateKey }),
})
ok('A2 جلسهٔ t1 ساخته شد', sres.status === 201, `HTTP ${sres.status} ${sres.data?.error ?? ''}`)
const sid = sres.data?.session?.id

// isMine در فهرست
const list = (await api(t1, `/api/attendance/sessions?classroomId=${class7.id}&from=${dateKey}&to=${dateKey}`)).data
const mine = list.sessions?.find(s => s.id === sid)
ok('A3 پرچم isMine درست', mine?.isMine === true && mine?.creatorId != null)

// t2 فهرست را می‌بیند ولی جلسه t1 برایش isMine=false است
const list2 = (await api(t2, `/api/attendance/sessions?classroomId=${class7.id}&from=${dateKey}&to=${dateKey}`)).data
const foreign = list2.sessions?.find(s => s.id === sid)
ok('A4 جلسهٔ t1 برای t2 خارجی است', foreign?.isMine === false)

// GET جزئیات برای t2 → canManageRecords=false
const det2 = (await api(t2, `/api/attendance/sessions/${sid}`)).data
ok('A5 t2 فقط-مشاهده است', det2?.session?.canManageRecords === false)

// PATCH توسط t2 → 403
const p2 = await api(t2, `/api/attendance/sessions/${sid}`, {
  method: 'PATCH',
  body: JSON.stringify({ records: [{ studentId: det2.students?.[0]?.studentId, status: 'ABSENT' }] }),
})
ok('A6 ویرایش t2 روی جلسهٔ t1 → 403', p2.status === 403, p2.data?.error ?? '')

// PATCH توسط خود t1 → 200
const students1 = det2.students ?? []
const p1 = await api(t1, `/api/attendance/sessions/${sid}`, {
  method: 'PATCH',
  body: JSON.stringify({ records: students1.map(s => ({ studentId: s.studentId, status: 'PRESENT' })) }),
})
ok('A7 ویرایش خودِ t1 → 200', p1.status === 200, `HTTP ${p1.status}`)

// نمره بدون درس → 400 (درس اجباری)
const gNoLesson = await api(t1, `/api/attendance/sessions/${sid}`, {
  method: 'PATCH',
  body: JSON.stringify({
    grades: [{ studentId: students1[0].studentId, score: '۱۸' }],
    gradeTitle: 'آزمون تست',
    gradeLessonId: null,
  }),
})
ok('A8 نمره بدون درس → 400', gNoLesson.status === 400 && /درس/.test(gNoLesson.data?.error ?? ''), gNoLesson.data?.error ?? '')

// تخلف چندانتخابی — دو نوع با هم
const stu0 = students1[0]
const vres = await api(t1, '/api/attendance/violations', {
  method: 'POST',
  body: JSON.stringify({
    studentId: stu0.studentId, classroomId: class7.id, dateKey, sessionId: sid,
    texts: ['انجام ندادن تکلیف', 'تأخیر در ورود به کلاس'],
  }),
})
ok('A9 تخلف چندانتخابی ۲ نوع → 201', vres.status === 201 && vres.data?.violations?.length === 2,
  `HTTP ${vres.status} (${vres.data?.violations?.length ?? 0} تخلف)`)

// تخلف با متن آزاد → 400
const vbad = await api(t1, '/api/attendance/violations', {
  method: 'POST',
  body: JSON.stringify({ studentId: stu0.studentId, classroomId: class7.id, dateKey, sessionId: sid, texts: ['هر متنی'] }),
})
ok('A10 متن آزاد رد شد → 400', vbad.status === 400, vbad.data?.error ?? '')

// مدیر کل: افزودن/غیرفعال‌کردن/حذف نوع تخلف
const sa = await login('superadmin', 'Admin@1234', 'superadmin')
const add = await api(sa, '/api/admin/violation-types', { method: 'POST', body: JSON.stringify({ label: 'نوع تست موقت' }) })
ok('A11 افزودن نوع توسط مدیر کل → 201', add.status === 201)
const tid = add.data?.type?.id
const tog = await api(sa, `/api/admin/violation-types/${tid}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) })
ok('A12 غیرفعال‌کردن → 200', tog.status === 200)
const del = await api(sa, `/api/admin/violation-types/${tid}`, { method: 'DELETE' })
ok('A13 حذف نوع بدون سابقه → 200', del.status === 200)
// حذف نوع دارای سابقه → 409
const delUsed = await api(sa, `/api/admin/violation-types/${(await api(sa, '/api/admin/violation-types')).data.types.find(t => t.usageCount > 0)?.id ?? ''}`, { method: 'DELETE' })
ok('A14 حذف نوع دارای سابقه → 409', delUsed.status === 409, delUsed.data?.error?.slice(0, 60) ?? '')
