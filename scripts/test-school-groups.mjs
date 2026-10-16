/**
 * تست E2E گروه‌های عمومی مدرسه + پایه دانش‌آموز — واقعی و بدون mock
 *
 * پوشش:
 *  ۱) گاردها: فقط مدیر مدرسه می‌سازد؛ تکرار/پایه بی‌کلاس/پایه نامعتبر رد می‌شود
 *  ۲) عضویت خودکار در فهرست گفتگوها بر اساس نقش و پایه (s1=هفتم۱، s5=هشتم۱+دوازه)
 *  ۳) جداسازی مدرسه (farzanegan هیچ‌کدام را نمی‌بیند)
 *  ۴) مجوز ارسال/مشاهده + قفل سیاست (STAFF) + مدیریت فقط مدیر
 *  ۵) اعضای محاسبه‌شده (همکاران/عمومی/پایه) + canDm ماتریس
 *  ۶) عضویت بلادرنگ: سوکت دانش‌آموز پیام گروه عمومی را زنده می‌گیرد (roomsForUser)
 *  ۷) پایه کلاس: تعیین پایه «دوازه» → گروه پایه دوازدهم s5 را می‌گیرد
 *  ۸) پاک‌سازی کامل — دیتابیس به وضعیت پیش از تست برمی‌گردد
 */
import { io } from 'socket.io-client'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const COOKIES = {}
async function login(user, pass) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass, realm: 'app' }),
  })
  if (!r.ok) throw new Error(`login failed: ${user}`)
  COOKIES[user] = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}
async function api(user, path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      cookie: COOKIES[user],
      ...(opts.headers ?? {}),
    },
  })
  let body = null
  try { body = await r.json() } catch { /* ignore */ }
  return { status: r.status, body }
}

console.log('══ ورود کاربران ══')
await login('beheshti.admin', 'Pass@123')
await login('beheshti.t1', 'Pass@123')
await login('beheshti.s1', 'Pass@123')
await login('beheshti.s5', 'Pass@123')
await login('farzanegan.admin', 'Pass@123')
await login('farzanegan.t1', 'Pass@123')
ok('۶ کاربر وارد شدند')

// پیش‌پاک‌سازی — گروه‌های عمومی باقی‌مانده از اجرای قبلی حذف می‌شود
{
  const pre = await api('beheshti.admin', '/api/groups/school')
  for (const g of pre.body?.groups ?? []) {
    await api('beheshti.admin', `/api/groups/${g.id}?confirm=true`, { method: 'DELETE' })
  }
  ok(`پیش‌پاک‌سازی: ${(pre.body?.groups ?? []).length} گروه باقی‌مانده حذف شد`)
}

console.log('══ ۱) گاردهای ایجاد ══')
{
  const r1 = await api('beheshti.t1', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'STAFF', name: 'تست' }) })
  r1.status === 403 ? ok('معلم نمی‌تواند گروه عمومی بسازد (403)') : bad(`معلم ساخت! (${r1.status})`)
  const r2 = await api('beheshti.s1', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'STAFF', name: 'تست' }) })
  r2.status === 403 ? ok('دانش‌آموز نمی‌تواند گروه عمومی بسازد (403)') : bad(`دانش‌آموز ساخت! (${r2.status})`)
  const r3 = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'X', name: 'تست' }) })
  r3.status === 400 ? ok('نوع نامعتبر رد شد (400)') : bad(`نوع نامعتبر پذیرفته شد (${r3.status})`)
}

console.log('══ ۲) ایجاد سه نوع گروه ══')
let staffId, allId, gradeId
{
  const a = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'STAFF', name: 'گروه همکاران' }) })
  if (a.status === 201 && a.body?.group?.id) { staffId = a.body.group.id; ok(`گروه همکاران ایجاد شد (${staffId.slice(-6)})`) } else bad(`همکاران: ${a.status} ${JSON.stringify(a.body)}`)

  const dup = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'STAFF', name: 'گروه همکاران' }) })
  dup.status === 409 ? ok('همکاران تکراری رد شد (409)') : bad(`تکرار همکاران: ${dup.status}`)

  const b = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'ALL', name: 'گروه عمومی مدرسه' }) })
  if (b.status === 201 && b.body?.group?.id) { allId = b.body.group.id; ok(`گروه عمومی ایجاد شد (${allId.slice(-6)})`) } else bad(`عمومی: ${b.status} ${JSON.stringify(b.body)}`)

  const dup2 = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'ALL', name: 'دیگر' }) })
  dup2.status === 409 ? ok('گروه عمومی دوم رد شد (409)') : bad(`عمومی دوم: ${dup2.status}`)

  const c = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'GRADE', name: 'گروه پایه هفتم', grade: 'هفتم' }) })
  if (c.status === 201 && c.body?.group?.id) { gradeId = c.body.group.id; ok(`گروه پایه هفتم ایجاد شد (${gradeId.slice(-6)})`) } else bad(`پایه هفتم: ${c.status} ${JSON.stringify(c.body)}`)

  const dup3 = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'GRADE', name: 'دیگر', grade: 'هفتم' }) })
  dup3.status === 409 ? ok('گروه پایه هفتم تکراری رد شد (409)') : bad(`پایه تکراری: ${dup3.status}`)

  const noClass = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'GRADE', name: 'گروه پایه اول', grade: 'اول' }) })
  noClass.status === 400 ? ok('پایه بدون کلاس رد شد (400)') : bad(`پایه بی‌کلاس: ${noClass.status}`)

  const invalid = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'GRADE', name: 'x', grade: 'سیزدهم' }) })
  invalid.status === 400 ? ok('پایه نامعتبر رد شد (400)') : bad(`پایه نامعتبر: ${invalid.status}`)

  const list = await api('beheshti.admin', '/api/groups/school')
  list.status === 200 && list.body?.groups?.length === 3
    ? ok('فهرست گروه‌های عمومی مدیر: ۳ گروه')
    : bad(`فهرست: ${list.status} ${JSON.stringify(list.body)}`)
}

console.log('══ ۳) عضویت خودکار در فهرست گفتگوها ══')
async function groupIdsOf(user) {
  const r = await api(user, '/api/chats')
  const convs = (r.body?.conversations ?? []).filter((c) => c.type === 'GROUP')
  return { convs, byId: new Map(convs.map((c) => [c.id, c])) }
}
{
  const admin = await groupIdsOf('beheshti.admin')
  admin.byId.has(staffId) && admin.byId.has(allId) && admin.byId.has(gradeId)
    ? ok('مدیر هر سه گروه عمومی را می‌بیند')
    : bad('مدیر گروه‌های عمومی را نمی‌بیند')
  admin.byId.get(staffId)?.subtitle === 'گروه همکاران مدرسه'
    ? ok('زیرعنوان همکاران درست است')
    : bad(`زیرعنوان همکاران: ${admin.byId.get(staffId)?.subtitle}`)
  admin.byId.get(allId)?.subtitle === 'گروه عمومی مدرسه'
    ? ok('زیرعنوان عمومی درست است')
    : bad(`زیرعنوان عمومی: ${admin.byId.get(allId)?.subtitle}`)
  admin.byId.get(gradeId)?.subtitle === 'گروه پایه هفتم'
    ? ok('زیرعنوان پایه درست است')
    : bad(`زیرعنوان پایه: ${admin.byId.get(gradeId)?.subtitle}`)

  const t1 = await groupIdsOf('beheshti.t1')
  t1.byId.has(staffId) && t1.byId.has(allId) && t1.byId.has(gradeId)
    ? ok('معلم هفتم: همکاران + عمومی + پایه هفتم (خودکار)')
    : bad('معلم هفتم گروه‌های خودکار را نمی‌بیند')

  const s1 = await groupIdsOf('beheshti.s1')
  !s1.byId.has(staffId) ? ok('دانش‌آموز همکاران را نمی‌بیند (درست)') : bad('دانش‌آموز همکاران را می‌بیند!')
  s1.byId.has(allId) ? ok('دانش‌آموز عمومی را می‌بیند') : bad('دانش‌آموز عمومی را نمی‌بیند')
  s1.byId.has(gradeId) ? ok('دانش‌آموز هفتمی گروه پایه هفتم را می‌بیند') : bad('هفتمی پایه هفتم را نمی‌بیند')

  const s5 = await groupIdsOf('beheshti.s5')
  s5.byId.has(allId) ? ok('s5 (هشتمی) عمومی را می‌بیند') : bad('s5 عمومی را نمی‌بیند')
  !s5.byId.has(gradeId) ? ok('s5 (هشتمی) پایه هفتم را نمی‌بیند (درست)') : bad('s5 پایه هفتم را می‌بیند!')
  !s5.byId.has(staffId) ? ok('s5 همکاران را نمی‌بیند (درست)') : bad('s5 همکاران را می‌بیند!')

  const a2 = await groupIdsOf('farzanegan.admin')
  !a2.byId.has(staffId) && !a2.byId.has(allId) && !a2.byId.has(gradeId)
    ? ok('جداسازی مدرسه: مدیر فرزانگان هیچ‌کدام را نمی‌بیند')
    : bad('نشت گروه بین مدارس!')
  const t4 = await groupIdsOf('farzanegan.t1')
  !t4.byId.has(allId) ? ok('معلم فرزانگان گروه عمومی بهشتی را نمی‌بیند') : bad('نشت گروه به معلم مدرسه دیگر!')
}

console.log('══ ۴) مجوز ارسال و مشاهده ══')
{
  const r1 = await api('beheshti.admin', `/api/chats/group/${staffId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'سلام همکاران — مدیر', clientId: `sgt-${Date.now()}-1` }) })
  r1.status === 201 ? ok('مدیر در همکاران می‌فرستد') : bad(`ارسال مدیر همکاران: ${r1.status} ${JSON.stringify(r1.body)}`)
  const r2 = await api('beheshti.t1', `/api/chats/group/${staffId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'سلام — معلم', clientId: `sgt-${Date.now()}-2` }) })
  r2.status === 201 ? ok('معلم در همکاران می‌فرستد') : bad(`ارسال معلم همکاران: ${r2.status}`)
  const r3 = await api('beheshti.s1', `/api/chats/group/${staffId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'هک', clientId: `sgt-${Date.now()}-3` }) })
  r3.status === 404 ? ok('دانش‌آموز به همکاران دسترسی ندارد (404)') : bad(`دانش‌آموز در همکاران: ${r3.status}`)
  const r4 = await api('beheshti.s1', `/api/chats/group/${staffId}/messages`)
  r4.status === 404 ? ok('دانش‌آموز پیام‌های همکاران را نمی‌خواند (404)') : bad(`خواندن همکاران: ${r4.status}`)
  const r5 = await api('beheshti.s1', `/api/chats/group/${allId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'سلام بچه‌ها', clientId: `sgt-${Date.now()}-4` }) })
  r5.status === 201 ? ok('دانش‌آموز در عمومی می‌فرستد') : bad(`ارسال دانش‌آموز عمومی: ${r5.status} ${JSON.stringify(r5.body)}`)
  const r6 = await api('beheshti.s5', `/api/chats/group/${gradeId}/messages`, { method: 'POST', body: JSON.stringify({ body: '؟', clientId: `sgt-${Date.now()}-5` }) })
  r6.status === 404 ? ok('هشتمی به گروه پایه هفتم دسترسی ندارد (404)') : bad(`هشتمی در پایه هفتم: ${r6.status}`)
  const r7 = await api('beheshti.s1', `/api/chats/group/${gradeId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'سوال هفتمی‌ها', clientId: `sgt-${Date.now()}-6` }) })
  r7.status === 201 ? ok('هفتمی در گروه پایه هفتم می‌فرستد') : bad(`هفتمی در پایه: ${r7.status}`)
  const r8 = await api('farzanegan.t1', `/api/chats/group/${allId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'نفوذ', clientId: `sgt-${Date.now()}-7` }) })
  r8.status === 404 ? ok('معلم مدرسه دیگر ارسال نمی‌کند (404)') : bad(`ارسال بین‌مدرسه‌ای: ${r8.status}`)
  const r9 = await api('beheshti.t1', `/api/chats/group/${allId}/messages`)
  r9.status === 200 && r9.body?.conversation?.canSend === true
    ? ok('معلم پیام‌های عمومی را می‌خواند و canSend=true')
    : bad(`خواندن عمومی معلم: ${r9.status}`)
}

console.log('══ ۵) قفل سیاست و مدیریت ══')
{
  const lock = await api('beheshti.admin', `/api/groups/${allId}`, { method: 'PATCH', body: JSON.stringify({ messagePolicy: 'STAFF' }) })
  lock.status === 200 ? ok('مدیر گروه عمومی را قفل کرد (STAFF)') : bad(`قفل: ${lock.status} ${JSON.stringify(lock.body)}`)
  const s1send = await api('beheshti.s1', `/api/chats/group/${allId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'قفله؟', clientId: `sgt-${Date.now()}-8` }) })
  s1send.status === 403 ? ok('دانش‌آموز در گروه قفل‌شده نمی‌فرستد (403)') : bad(`ارسال در قفل: ${s1send.status}`)
  const t1lock = await api('beheshti.t1', `/api/groups/${allId}`, { method: 'PATCH', body: JSON.stringify({ name: 'نام معلم' }) })
  t1lock.status === 403 ? ok('معلم نمی‌تواند گروه عمومی را ویرایش کند (403)') : bad(`ویرایش معلم: ${t1lock.status}`)
  const unlock = await api('beheshti.admin', `/api/groups/${allId}`, { method: 'PATCH', body: JSON.stringify({ messagePolicy: 'ALL' }) })
  unlock.status === 200 ? ok('قفل برداشته شد') : bad(`بازکردن قفل: ${unlock.status}`)

  const ren = await api('beheshti.admin', `/api/groups/${gradeId}`, { method: 'PATCH', body: JSON.stringify({ name: 'هفتمی‌های شهید بهشتی' }) })
  ren.status === 200 ? ok('تغییر نام گروه پایه توسط مدیر') : bad(`تغییر نام: ${ren.status}`)
  const ren2 = await api('beheshti.admin', `/api/groups/${gradeId}`, { method: 'PATCH', body: JSON.stringify({ name: 'گروه عمومی مدرسه' }) })
  ren2.status === 409 ? ok('نام تکراری با گروه عمومی رد شد (409)') : bad(`نام تکراری: ${ren2.status}`)
  const renBack = await api('beheshti.admin', `/api/groups/${gradeId}`, { method: 'PATCH', body: JSON.stringify({ name: 'گروه پایه هفتم' }) })
  renBack.status === 200 ? ok('نام بازگردانده شد') : bad(`بازگرداندن نام: ${renBack.status}`)

  const arch = await api('beheshti.admin', `/api/groups/${allId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
  arch.status === 200 ? ok('بایگانی گروه عمومی') : bad(`بایگانی: ${arch.status}`)
  const s1arch = await api('beheshti.s1', `/api/chats/group/${allId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'بایگانی؟', clientId: `sgt-${Date.now()}-9` }) })
  s1arch.status === 403 ? ok('ارسال در گروه بایگانی‌شده رد شد (403)') : bad(`ارسال در بایگانی: ${s1arch.status}`)
  await api('beheshti.admin', `/api/groups/${allId}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) })
  ok('خروج از بایگانی')

  const tdel = await api('beheshti.t1', `/api/groups/${allId}?confirm=true`, { method: 'DELETE' })
  tdel.status === 403 ? ok('معلم نمی‌تواند گروه عمومی را حذف کند (403)') : bad(`حذف معلم: ${tdel.status}`)
}

console.log('══ ۶) اعضای محاسبه‌شده ══')
{
  const m1 = await api('beheshti.t1', `/api/chats/group/${staffId}/members`)
  const teachers = m1.body?.members?.teachers ?? []
  const students = m1.body?.members?.students ?? []
  const admins = m1.body?.members?.admins ?? []
  teachers.length >= 3 && students.length === 0 && admins.length >= 1
    ? ok(`همکاران: ${teachers.length} معلم، ۰ دانش‌آموز، ${admins.length} مدیر`)
    : bad(`اعضای همکاران: t=${teachers.length} s=${students.length} a=${admins.length}`)
  m1.body?.group?.className === 'گروه همکاران مدرسه'
    ? ok('className دیالوگ اعضا = زیرعنوان عمومی')
    : bad(`className همکاران: ${m1.body?.group?.className}`)

  const m2 = await api('beheshti.s1', `/api/chats/group/${allId}/members`)
  const s2 = (m2.body?.members?.students ?? []).length
  const t2 = (m2.body?.members?.teachers ?? []).length
  s2 >= 6 && t2 >= 3 ? ok(`عمومی: ${s2} دانش‌آموز + ${t2} معلم`) : bad(`اعضای عمومی: s=${s2} t=${t2}`)
  const dmTeachers = m2.body?.members?.teachers ?? []
  dmTeachers.every((t) => t.canDm === false)
    ? ok('ماتریس DM: دانش‌آموز با معلمان گروه عمومی DM ندارد (بدون گروه مشترک)')
    : bad('canDm معلمان برای دانش‌آموز نادرست')
  const dmAdmins = m2.body?.members?.admins ?? []
  dmAdmins.every((a) => a.canDm === true) ? ok('مدیر برای دانش‌آموز قابل DM است') : bad('canDm مدیر نادرست')

  const m3 = await api('beheshti.s1', `/api/chats/group/${gradeId}/members`)
  const gStudents = m3.body?.members?.students ?? []
  const names = gStudents.map((s) => s.id).sort()
  const gTeachers = m3.body?.members?.teachers ?? []
  gStudents.length === 4 ? ok(`پایه هفتم: دقیقاً ۴ دانش‌آموز هفتم۱ (s1..s4)`) : bad(`اعضای پایه هفتم: ${gStudents.length} → ${JSON.stringify(m3.body?.members)}`)
  gTeachers.length >= 1 ? ok(`پایه هفتم: ${gTeachers.length} معلم هفتم`) : bad('معلم پایه هفتم یافت نشد')

  const put = await api('beheshti.admin', `/api/groups/${allId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [], removes: [] }) })
  put.status === 400 ? ok('استثنای عضویت روی گروه عمومی رد شد (400)') : bad(`override گروه عمومی: ${put.status}`)
}

console.log('══ ۷) بلادرنگ — سوکت دانش‌آموز پیام گروه عمومی را زنده می‌گیرد ══')
{
  const socket = io(BASE + '/?XTransformPort=3003', {
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    withCredentials: true,
    extraHeaders: { cookie: COOKIES['beheshti.s1'] },
    timeout: 10000,
    reconnection: false,
  })
  let connected = false
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 12000)
    socket.on('connect', () => { clearTimeout(t); connected = true; resolve() })
    socket.on('connect_error', (e) => { clearTimeout(t); reject(e) })
  })
  connected ? ok('سوکت دانش‌آموز متصل شد') : bad('اتصال سوکت دانش‌آموز')
  await sleep(800)
  let got = null
  socket.on('message:new', (d) => { if (d?.subjectGroupId === allId && !got) got = d })
  const r = await api('beheshti.t1', `/api/chats/group/${allId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'پیام زنده عمومی', clientId: `sgt-rt-${Date.now()}` }) })
  r.status === 201 ? ok('معلم پیام زنده فرستاد') : bad(`ارسال زنده: ${r.status}`)
  await sleep(2500)
  got ? ok('دانش‌آموز پیام گروه عمومی را بلادرنگ دریافت کرد (roomsForUser)') : bad('دریافت بلادرنگ گروه عمومی شکست خورد')
  socket.close()
}

console.log('══ ۸) پایه کلاس → گروه پایه ══')
{
  const classes = await api('beheshti.admin', '/api/classes')
  const haft = (classes.body?.classrooms ?? []).find((c) => c.name === 'هفتم۱')
  haft?.grade === 'هفتم' ? ok('کلاس هفتم۱ پایه ذخیره‌شده دارد (backfill)') : bad(`پایه هفتم۱: ${haft?.grade}`)

  const doaze = (classes.body?.classrooms ?? []).find((c) => c.name === 'دوازه')
  if (doaze) {
    const setG = await api('beheshti.admin', `/api/classes/${doaze.id}`, { method: 'PATCH', body: JSON.stringify({ grade: 'دوازدهم' }) })
    setG.status === 200 && setG.body?.classroom?.grade === 'دوازدهم'
      ? ok('پایه کلاس «دوازه» به دوازدهم اصلاح شد (PATCH grade)')
      : bad(`اصلاح پایه: ${setG.status} ${JSON.stringify(setG.body)}`)
    const g12 = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'GRADE', name: 'گروه پایه دوازدهم', grade: 'دوازدهم' }) })
    if (g12.status === 201) {
      const m = await api('beheshti.s5', `/api/chats/group/${g12.body.group.id}/messages`)
      m.status === 200 ? ok('s5 (ثبت‌نام دوازه→دوازدهم) عضو گروه پایه دوازدهم شد') : bad(`عضویت s5 در دوازدهم: ${m.status}`)
      const del = await api('beheshti.admin', `/api/groups/${g12.body.group.id}?confirm=true`, { method: 'DELETE' })
      del.status === 200 ? ok('گروه پایه دوازدهم حذف شد') : bad(`حذف گروه دوازدهم: ${del.status}`)
    } else bad(`ایجاد گروه دوازدهم: ${g12.status} ${JSON.stringify(g12.body)}`)
    const unset = await api('beheshti.admin', `/api/classes/${doaze.id}`, { method: 'PATCH', body: JSON.stringify({ grade: null }) })
    unset.status === 200 ? ok('پایه «دوازه» به حالت قبل بازگشت') : bad(`بازگشت پایه: ${unset.status}`)
  }

  const bad2 = await api('beheshti.admin', `/api/classes/${classes.body.classrooms[0].id}`, { method: 'PATCH', body: JSON.stringify({ grade: 'هجدهم' }) })
  bad2.status === 400 ? ok('پایه نامعتبر در PATCH کلاس رد شد (400)') : bad(`پایه نامعتبر PATCH: ${bad2.status}`)
}

console.log('══ ۹) بی‌صداکردن گروه عمومی ══')
{
  const mute = await api('beheshti.s1', '/api/me/mutes', { method: 'PUT', body: JSON.stringify({ chatType: 'GROUP', chatKey: allId, muted: true }) })
  mute.status === 200 ? ok('گروه عمومی بی‌صدا شد') : bad(`بی‌صدا: ${mute.status} ${JSON.stringify(mute.body)}`)
  const list = await api('beheshti.s1', '/api/me/mutes')
  const item = (list.body?.items ?? []).find((i) => i.chatKey === allId)
  item?.subtitle === 'گروه عمومی مدرسه' ? ok('فهرست بی‌صدها زیرعنوان درست دارد') : bad(`زیرعنوان بی‌صدا: ${JSON.stringify(item)}`)
  await api('beheshti.s1', '/api/me/mutes', { method: 'PUT', body: JSON.stringify({ chatType: 'GROUP', chatKey: allId, muted: false }) })
  ok('صداگردانی گروه عمومی')
}

console.log('══ ۱۰) پاک‌سازی کامل ══')
{
  for (const [label, id] of [['همکاران', staffId], ['عمومی', allId], ['پایه هفتم', gradeId]]) {
    const d = await api('beheshti.admin', `/api/groups/${id}?confirm=true`, { method: 'DELETE' })
    d.status === 200 ? ok(`حذف گروه ${label}`) : bad(`حذف ${label}: ${d.status} ${JSON.stringify(d.body)}`)
  }
  const list = await api('beheshti.admin', '/api/groups/school')
  ;(list.body?.groups ?? []).length === 0 ? ok('هیچ گروه عمومی باقی نماند') : bad(`باقی‌مانده: ${JSON.stringify(list.body)}`)
  const s1again = await groupIdsOf('beheshti.s1')
  !s1again.byId.has(allId) ? ok('فهرست s1 پس از حذف پاک شد') : bad('گروه حذف‌شده در فهرست s1 است')
}

console.log(`\n═══ نتیجه: ${PASS} سبز / ${FAIL} قرمز ═══`)
process.exit(FAIL ? 1 : 0)
