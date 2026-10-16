/**
 * تست E2E مدیریت اعضای گروه از هدر گفتگو — واقعی و بدون mock
 *
 * پوشش:
 *  ۱) پرچم‌های مجوز ویرایش (مدیر: دانش‌آموز+معلم / معلم: فقط دانش‌آموز / دانش‌آموز: هیچ)
 *  ۲) جست‌وجوی نامزد افزودن (فقط غیراعضا، فقط مدرسه خود)
 *  ۳) افزودن/حذف دانش‌آموز در گروه درسی + گروه‌های عمومی (همکاران/عمومی/پایه)
 *  ۴) افزودن/حذف معلم: گروه درسی = انتساب واقعی؛ گروه عمومی = استثنای عضویت
 *  ۵) گاردها: دانش‌آموز ۴۰۳، معلم↔معلم ۴۰۳، حذف مدیریت ۴۰۰، مدرسه دیگر ۴۰۴
 *  ۶) عضویت مؤثر: افزوده‌شده گروه را می‌بیند و پیام زنده سوکت می‌گیرد؛ حذف‌شده دسترسی کامل می‌بازد
 *  ۷) پاک‌سازی کامل — دیتابیس به وضعیت پیش از تست برمی‌گردد
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
function socketFor(user) {
  return io(BASE + '/?XTransformPort=3003', {
    path: '/socket.io',
    transports: ['websocket'],
    withCredentials: true,
    extraHeaders: { cookie: COOKIES[user] },
    timeout: 10000,
    reconnection: false,
  })
}
const USERS = {}

console.log('══ ورود ══')
await login('beheshti.admin', 'Pass@123')
await login('beheshti.t1', 'Pass@123')
await login('beheshti.t2', 'Pass@123')
await login('beheshti.s1', 'Pass@123')
await login('beheshti.s2', 'Pass@123')
await login('beheshti.s3', 'Pass@123')
await login('beheshti.s6', 'Pass@123')
await login('farzanegan.admin', 'Pass@123')
ok('۸ کاربر وارد شدند')

console.log('══ پیش‌پاک‌سازی ══')
{
  // گروه‌های عمومی باقی‌مانده
  const pre = await api('beheshti.admin', '/api/groups/school')
  for (const g of pre.body?.groups ?? []) {
    await api('beheshti.admin', `/api/groups/${g.id}?confirm=true`, { method: 'DELETE' })
  }
  ok(`پیش‌پاک‌سازی: ${(pre.body?.groups ?? []).length} گروه عمومی باقی‌مانده حذف شد`)
}

console.log('══ ۰) گروه درسی t1 + شناسه‌ها ══')
let classGroupId = null
let s1Id, s2Id, s3Id, s6Id, t2Id, adminId, t1Id
{
  const me = await api('beheshti.admin', '/api/me')
  adminId = me.body?.user?.id ?? me.body?.id ?? null
  adminId ? ok(`شناسه مدیر از /api/me (${String(adminId).slice(-6)})`) : bad('شناسه مدیر یافت نشد')

  const chats = await api('beheshti.t1', '/api/chats')
  const conv = (chats.body?.conversations ?? []).find((c) => c.type === 'GROUP' && !c.archived)
  if (!conv) { bad('گروه درسی t1 یافت نشد'); process.exit(1) }
  classGroupId = conv.id
  ok(`گروه درسی t1: ${conv.title} (${classGroupId.slice(-6)})`)

  // اعضا و نامزدها — همه شناسه‌ها از پاسخ سرور
  const m = await api('beheshti.admin', `/api/chats/group/${classGroupId}/members`)
  for (const u of [...(m.body?.members?.students ?? []), ...(m.body?.members?.teachers ?? [])]) {
    if (u.fullName === 'رضا احمدی') s1Id = u.id
    if (u.fullName === 'مینا نظری') s2Id = u.id
    if (u.fullName === 'سینا جعفری') s3Id = u.id
    if (u.fullName === 'رضا موسوی') t1Id = u.id
  }
  const cs = await api('beheshti.admin', `/api/chats/group/${classGroupId}/members`, { method: 'POST', body: JSON.stringify({ q: 'نیلوفر', role: 'STUDENT' }) })
  s6Id = cs.body?.candidates?.[0]?.id ?? null
  const ct = await api('beheshti.admin', `/api/chats/group/${classGroupId}/members`, { method: 'POST', body: JSON.stringify({ q: 'مرادی', role: 'TEACHER' }) })
  t2Id = ct.body?.candidates?.[0]?.id ?? null
  if (s1Id && s2Id && s3Id && s6Id && t2Id && t1Id) ok('شناسه‌های s1/s2/s3/s6/t1/t2 یافت شد')
  else bad(`شناسه‌ها: s1=${!!s1Id} s2=${!!s2Id} s3=${!!s3Id} s6=${!!s6Id} t2=${!!t2Id} t1=${!!t1Id}`)
}

console.log('══ ۱) پرچم‌های مجوز ویرایش ══')
{
  const a = await api('beheshti.admin', `/api/chats/group/${classGroupId}/members`)
  const t = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`)
  const s = await api('beheshti.s1', `/api/chats/group/${classGroupId}/members`)
  if (a.status === 200 && a.body?.canEditStudents && a.body?.canEditTeachers) ok('مدیر: canEditStudents + canEditTeachers = true')
  else bad(`مدیر: ${JSON.stringify({ s: a.body?.canEditStudents, t: a.body?.canEditTeachers })}`)
  if (t.status === 200 && t.body?.canEditStudents && !t.body?.canEditTeachers) ok('معلم: فقط دانش‌آموزان')
  else bad(`معلم: ${JSON.stringify({ s: t.body?.canEditStudents, t: t.body?.canEditTeachers })}`)
  if (s.status === 200 && !s.body?.canEditStudents && !s.body?.canEditTeachers) ok('دانش‌آموز: بدون مجوز ویرایش')
  else bad(`دانش‌آموز: ${JSON.stringify({ s: s.body?.canEditStudents, t: s.body?.canEditTeachers })}`)
}

console.log('══ ۲) گاردهای مدیریت اعضا ══')
{
  const st = await api('beheshti.s1', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [s2Id] }) })
  st.status === 403 ? ok('دانش‌آموز نمی‌تواند عضو حذف کند (403)') : bad(`دانش‌آموز: ${st.status}`)
  const tt = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [t2Id] }) })
  tt.status === 403 ? ok('معلم نمی‌تواند معلم اضافه کند (403)') : bad(`معلم→معلم: ${tt.status}`)
  const admRem = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [adminId] }) })
  admRem.status === 403 || admRem.status === 400 ? ok('حذف مدیریت رد شد (عضو دائمی)') : bad(`حذف مدیریت: ${admRem.status}`)
  const f = await api('farzanegan.admin', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [s1Id] }) })
  f.status === 404 || f.status === 403 ? ok('مدیر مدرسه دیگر دسترسی ندارد') : bad(`مدرسه دیگر: ${f.status}`)
  const fc = await api('farzanegan.admin', `/api/chats/group/${classGroupId}/members`, { method: 'POST', body: JSON.stringify({ q: '', role: 'STUDENT' }) })
  fc.status === 404 || fc.status === 403 ? ok('نامزدجویی مدرسه دیگر رد شد') : bad(`نامزد مدرسه دیگر: ${fc.status}`)
  const s2f = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ removes: ['cmv-nonexistent'] }) })
  s2f.status === 400 ? ok('کاربر ناموجود رد شد (400)') : bad(`کاربر ناموجود: ${s2f.status}`)
}

console.log('══ ۳) افزودن/حذف دانش‌آموز در گروه درسی (توسط معلم) ══')
{
  // الف) دانش‌آموز خارج از کلاس (s6) → ADD واقعی با بج «افزوده‌شده»
  const add = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [s6Id] }) })
  add.status === 200 ? ok('معلم دانش‌آموز s6 (خارج کلاس) را افزود') : bad(`افزودن s6: ${add.status} ${JSON.stringify(add.body)}`)
  const m = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`)
  const row = (m.body?.members?.students ?? []).find((x) => x.id === s6Id)
  row?.status === 'ADDED' ? ok('وضعیت s6 = ADDED (بج افزوده‌شده)') : bad(`وضعیت s6: ${row?.status}`)
  const s6see = await api('beheshti.s6', `/api/chats/group/${classGroupId}/members`)
  s6see.status === 200 ? ok('s6 افزوده‌شده به گروه دسترسی دارد') : bad(`دسترسی s6: ${s6see.status}`)

  // جست‌وجوی نامزد پس از افزودن: s6 دیگر نامزد نیست
  const cs2 = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`, { method: 'POST', body: JSON.stringify({ q: 'نیلوفر', role: 'STUDENT' }) })
  !(cs2.body?.candidates ?? []).some((c) => c.id === s6Id) ? ok('عضو فعلی در نامزدها نمی‌آید') : bad('s6 هنوز در نامزدها است')

  // حذف افزوده‌شده (بدون ثبت‌نام) → رکورد استثنا حذف می‌شود
  const rm = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [s6Id] }) })
  rm.status === 200 ? ok('s6 از گروه حذف شد') : bad(`حذف s6: ${rm.status}`)
  const m2 = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`)
  const gone = !(m2.body?.members?.students ?? []).find((x) => x.id === s6Id)
  gone ? ok('s6 پس از حذف از فهرست خارج شد') : bad('s6 هنوز در فهرست است')

  // ب) دانش‌آموز ثبت‌نامی کلاس (s2) → حذف = REMOVE override + از دست دادن کامل دسترسی
  const rm2 = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [s2Id] }) })
  rm2.status === 200 ? ok('معلم عضو ثبت‌نامی s2 را حذف کرد (REMOVE)') : bad(`حذف s2: ${rm2.status}`)
  const s2see = await api('beheshti.s2', `/api/chats/group/${classGroupId}/members`)
  s2see.status === 404 ? ok('s2 حذف‌شده دسترسی گروه را کامل از دست داد (404)') : bad(`دسترسی s2: ${s2see.status}`)
  const s2send = await api('beheshti.s2', `/api/chats/group/${classGroupId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'تست', clientId: 'x1' }) })
  s2send.status === 404 ? ok('ارسال پیام حذف‌شده هم رد شد') : bad(`ارسال حذف‌شده: ${s2send.status}`)

  // بازگردانی: افزودن عضو ثبت‌نامی → پاک‌شدن استثنا → بازگشت به عضویت خودکار (AUTO)
  const back = await api('beheshti.admin', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [s2Id] }) })
  back.status === 200 ? ok('s2 با افزودن بازگشت') : bad(`بازگشت s2: ${back.status}`)
  const m3 = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`)
  const row3 = (m3.body?.members?.students ?? []).find((x) => x.id === s2Id)
  row3?.status === 'AUTO' ? ok('s2 بازگشته = AUTO (استثنا پاک شد، ثبت‌نام کلاس ملاک)') : bad(`وضعیت بازگشته: ${row3?.status}`)
  const s2see2 = await api('beheshti.s2', `/api/chats/group/${classGroupId}/members`)
  s2see2.status === 200 ? ok('s2 دوباره دسترسی دارد') : bad(`دسترسی دوباره s2: ${s2see2.status}`)
}

console.log('══ ۴) افزودن/حذف معلم گروه درسی (فقط مدیر) = انتساب واقعی ══')
{
  const add = await api('beheshti.admin', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [t2Id] }) })
  add.status === 200 ? ok('مدیر معلم t2 را به گروه درسی افزود (انتساب واقعی)') : bad(`افزودن معلم: ${add.status} ${JSON.stringify(add.body)}`)
  const t2see = await api('beheshti.t2', `/api/chats/group/${classGroupId}/members`)
  t2see.status === 200 ? ok('معلم افزوده‌شده به گروه درسی دسترسی دارد') : bad(`دسترسی t2: ${t2see.status}`)
  const dup = await api('beheshti.admin', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [t2Id] }) })
  dup.status === 200 ? ok('افزودن تکراری معلم idempotent است') : bad(`تکرار معلم: ${dup.status}`)
  const rm = await api('beheshti.admin', `/api/chats/group/${classGroupId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [t2Id] }) })
  rm.status === 200 ? ok('مدیر معلم t2 را لغو انتساب کرد') : bad(`حذف معلم: ${rm.status}`)
  const t2gone = await api('beheshti.t2', `/api/chats/group/${classGroupId}/members`)
  t2gone.status === 404 ? ok('معلم لغو‌شده دسترسی گروه درسی را از دست داد') : bad(`t2 پس از لغو: ${t2gone.status}`)
}

console.log('══ ۵) گروه‌های عمومی — ایجاد و مدیریت اعضا ══')
let staffId, allId, gradeId
{
  const a = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'STAFF', name: 'گروه همکاران' }) })
  staffId = a.body?.group?.id
  const b = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'ALL', name: 'گروه عمومی مدرسه' }) })
  allId = b.body?.group?.id
  const c = await api('beheshti.admin', '/api/groups/school', { method: 'POST', body: JSON.stringify({ type: 'GRADE', name: 'گروه پایه هفتم', grade: 'هفتم' }) })
  gradeId = c.body?.group?.id
  if (staffId && allId && gradeId) ok('۳ گروه عمومی ایجاد شد')
  else bad(`ایجاد گروه‌ها: ${a.status}/${b.status}/${c.status}`)

  // پرچم‌ها در گروه عمومی
  const ma = await api('beheshti.admin', `/api/chats/group/${allId}/members`)
  const mt = await api('beheshti.t1', `/api/chats/group/${allId}/members`)
  const ms = await api('beheshti.s1', `/api/chats/group/${allId}/members`)
  ma.body?.canEditStudents && ma.body?.canEditTeachers ? ok('مدیر در گروه عمومی: هر دو مجوز') : bad('مدیر گروه عمومی مجوزها')
  mt.body?.canEditStudents && !mt.body?.canEditTeachers ? ok('معلم در گروه عمومی: فقط دانش‌آموزان') : bad('معلم گروه عمومی مجوزها')
  !ms.body?.canEditStudents && !ms.body?.canEditTeachers ? ok('دانش‌آموز در گروه عمومی: بدون مجوز') : bad('دانش‌آموز گروه عمومی مجوزها')

  // حذف مدیر از گروه عمومی ممنوع
  const admRm = await api('beheshti.admin', `/api/chats/group/${allId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [adminId] }) })
  admRm.status === 400 ? ok('حذف مدیریت از گروه عمومی رد شد (400)') : bad(`حذف مدیریت عمومی: ${admRm.status}`)

  // معلم دانش‌آموز را از گروه عمومی حذف می‌کند → عضویت مؤثر می‌افتد
  const rmStu = await api('beheshti.t1', `/api/chats/group/${allId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [s1Id] }) })
  rmStu.status === 200 ? ok('معلم دانش‌آموز s1 را از گروه عمومی حذف کرد') : bad(`حذف عمومی: ${rmStu.status} ${JSON.stringify(rmStu.body)}`)
  const s1see = await api('beheshti.s1', `/api/chats/group/${allId}/members`)
  s1see.status === 404 ? ok('s1 حذف‌شده از گروه عمومی، دسترسی ندارد') : bad(`s1 عمومی: ${s1see.status}`)
  const chats1 = await api('beheshti.s1', '/api/chats')
  !((chats1.body?.conversations ?? []).some((c) => c.id === allId))
    ? ok('گروه حذف‌شده از فهرست گفتگوهای s1 بیرون رفت') : bad('گروه در فهرست s1 ماند')

  // بازگردانی عضو خودکار: افزودن → استثنا پاک می‌شود → AUTO
  const backStu = await api('beheshti.admin', `/api/chats/group/${allId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [s1Id] }) })
  backStu.status === 200 ? ok('s1 با افزودن بازگشت') : bad(`بازگشت s1: ${backStu.status}`)
  const s1see2 = await api('beheshti.s1', `/api/chats/group/${allId}/members`)
  s1see2.status === 200 ? ok('s1 دوباره به گروه عمومی دسترسی دارد') : bad(`بازگشت دسترسی: ${s1see2.status}`)
  const mAll = await api('beheshti.admin', `/api/chats/group/${allId}/members`)
  const s1row = (mAll.body?.members?.students ?? []).find((x) => x.id === s1Id)
  s1row?.status === 'AUTO' ? ok('s1 بازگشته = AUTO (عضویت خودکار بازیابی شد)') : bad(`وضعیت s1: ${s1row?.status}`)

  // مدیر معلم پایه‌دوازدهمی را به گروه پایه اضافه/حذف می‌کند — t2 خودش معلم پایه هفتم است
  // (علوم هفتم۱) → افزودن = پاک‌کردن استثنا → بازگشت به عضویت خودکار (AUTO)
  const addT2 = await api('beheshti.admin', `/api/chats/group/${gradeId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [t2Id] }) })
  addT2.status === 200 ? ok('افزودن معلم پایه‌گراف به گروه پایه اعمال شد') : bad(`افزودن t2 به پایه: ${addT2.status} ${JSON.stringify(addT2.body)}`)
  const t2grade = await api('beheshti.t2', `/api/chats/group/${gradeId}/members`)
  t2grade.status === 200 ? ok('t2 معلم پایه به گروه پایه دسترسی دارد') : bad(`t2 پایه: ${t2grade.status}`)
  const mg = await api('beheshti.admin', `/api/chats/group/${gradeId}/members`)
  const t2row = (mg.body?.members?.teachers ?? []).find((x) => x.id === t2Id)
  t2row?.status === 'AUTO' ? ok('t2 عضو خودکار پایه = AUTO (افزودن idempotent)') : bad(`t2 وضعیت: ${t2row?.status}`)
  const rmT2 = await api('beheshti.admin', `/api/chats/group/${gradeId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [t2Id] }) })
  rmT2.status === 200 ? ok('t2 از گروه پایه حذف شد (REMOVE روی عضو خودکار)') : bad(`حذف t2: ${rmT2.status}`)
  const t2gone = await api('beheshti.t2', `/api/chats/group/${gradeId}/members`)
  t2gone.status === 404 ? ok('t2 حذف‌شده از گروه پایه، دسترسی ندارد') : bad(`t2 بعد: ${t2gone.status}`)
  // بازگردانی عضویت خودکار t2 برای وضعیت پایه
  const backT2 = await api('beheshti.admin', `/api/chats/group/${gradeId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [t2Id] }) })
  backT2.status === 200 ? ok('t2 به گروه پایه بازگشت') : bad(`بازگشت t2 پایه: ${backT2.status}`)

  // معلم حذف‌شده از گروه همکاران (خودکار) → REMOVE — سپس بازگردانی به AUTO
  const rmT1 = await api('beheshti.admin', `/api/chats/group/${staffId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [t1Id] }) })
  rmT1.status === 200 ? ok('مدیر معلم t1 را از گروه همکاران حذف کرد') : bad(`حذف t1 همکاران: ${rmT1.status}`)
  const t1staff = await api('beheshti.t1', `/api/chats/group/${staffId}/members`)
  t1staff.status === 404 ? ok('t1 حذف‌شده از همکاران، دسترسی ندارد') : bad(`t1 همکاران: ${t1staff.status}`)
  const backT1 = await api('beheshti.admin', `/api/chats/group/${staffId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [t1Id] }) })
  backT1.status === 200 ? ok('t1 بازگشت به همکاران (استثنا پاک شد)') : bad(`بازگشت t1: ${backT1.status}`)
  const mStaff = await api('beheshti.admin', `/api/chats/group/${staffId}/members`)
  const t1row = (mStaff.body?.members?.teachers ?? []).find((x) => x.id === t1Id)
  t1row?.status === 'AUTO' ? ok('t1 بازگشته = AUTO') : bad(`وضعیت t1: ${t1row?.status}`)
}

console.log('══ ۶) بلادرنگ — عضو افزوده‌شده پیام زنده می‌گیرد ══')
{
  // s3 (خارج از همکارانِ خودکار) به گروه همکاران افزوده می‌شود
  const sock = socketFor('beheshti.s3')
  let got = null
  sock.on('message:new', (d) => { if (d?.subjectGroupId === staffId && !got) got = d })
  const connected = await new Promise((resolve) => {
    sock.on('connect', () => resolve(true))
    sock.on('connect_error', () => resolve(false))
    setTimeout(() => resolve(false), 12000)
  })
  connected ? ok('سوکت s3 متصل شد') : bad('اتصال سوکت s3')
  await sleep(800)

  const add = await api('beheshti.admin', `/api/chats/group/${staffId}/members`, { method: 'PUT', body: JSON.stringify({ adds: [s3Id] }) })
  add.status === 200 ? ok('s3 به گروه همکاران افزوده شد (سناریوی ADD واقعی)') : bad(`افزودن s3: ${add.status} ${JSON.stringify(add.body)}`)
  await sleep(1500) // refreshUserIds سرور
  await api('beheshti.admin', `/api/chats/group/${staffId}/messages`, { method: 'POST', body: JSON.stringify({ body: 'پیام تست بلادرنگ', clientId: 'rt-1' }) })
  await sleep(2500)
  got ? ok('عضو افزوده‌شده پیام گروه را زنده از سوکت گرفت') : bad('پیام زنده دریافت نشد')

  // پاک‌سازی استثنا: حذف افزوده‌شده → رکورد ADD حذف می‌شود
  const rm = await api('beheshti.admin', `/api/chats/group/${staffId}/members`, { method: 'PUT', body: JSON.stringify({ removes: [s3Id] }) })
  rm.status === 200 ? ok('s3 از همکاران حذف شد (پاک‌سازی)') : bad(`حذف s3: ${rm.status}`)
  sock.disconnect()
}

console.log('══ ۷) پاک‌سازی کامل ══')
{
  for (const g of [staffId, allId, gradeId]) {
    await api('beheshti.admin', `/api/groups/${g}?confirm=true`, { method: 'DELETE' })
  }
  const post = await api('beheshti.admin', '/api/groups/school')
  ;(post.body?.groups ?? []).length === 0 ? ok('همه گروه‌های عمومی پاک شدند') : bad('گروه باقی مانده')
  // انتساب اصلی t2 دست‌نخورده؟
  const t2chats = await api('beheshti.t2', '/api/chats')
  const t2groups = (t2chats.body?.conversations ?? []).filter((c) => c.type === 'GROUP').length
  t2groups >= 2 ? ok(`انتساب‌های اصلی t2 سالم (${t2groups} گروه)`) : bad(`t2 گروه‌ها: ${t2groups}`)
  const t1ok = await api('beheshti.t1', `/api/chats/group/${classGroupId}/members`)
  t1ok.status === 200 ? ok('وضعیت پایه سالم: t1 دسترسی گروه درسی دارد') : bad('وضعیت پایه خراب شد')
  const s2ok = await api('beheshti.s2', `/api/chats/group/${classGroupId}/members`)
  s2ok.status === 200 ? ok('وضعیت پایه سالم: s2 عضو گروه درسی است') : bad('s2 وضعیت پایه')
}

console.log(`\n══════ نتیجه: ${PASS} سبز، ${FAIL} قرمز ══════`)
process.exit(FAIL === 0 ? 0 : 1)
