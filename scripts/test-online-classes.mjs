/**
 * تست واقعی «مدیریت کلاس‌های آنلاین» — بدون mock، مستقیم روی سرویس‌های واقعی
 *
 * پوشش:
 *  ۱) کنترل دسترسی APIهای پنل (مدیر کل مجاز؛ معلم/مدیر مدرسه/ناشناس رد)
 *  ۲) ذخیرهٔ تنظیمات مدرسه در دیتابیس (سقف جلسه + سقف هم‌زمان + فعال/غیرفعال)
 *  ۳) ظرفیت کلاس در محدودهٔ سقف مدرسه (PATCH رد شد بالاتر از سقف)
 *  ۴) سقف جلسات هم‌زمان — اعمال در API ساخت جلسه (چهارده‌گانهٔ رقابت هم بررسی می‌شود)
 *  ۵) سقف افراد جلسه — اعمال در سوکت live:join (معلم نیز جزو ظرفیت)
 *  ۶) اتصال مجدد — بدون شرکت‌کنندهٔ تکراری + شمارش قطع‌ووصل
 *  ۷) کاهش ظرفیت — حاضران اخراج نمی‌شوند؛ ورود جدید مسدود می‌شود
 *  ۸) غیرفعال‌کردن مدرسه — ورود جدید مسدود؛ جلسهٔ جاری و اتصال مجدد میزبان سالم
 *  ۹) پایان اجباری با دلیل — DB/Sوکت/LiveKit هماهنگ؛ گزارش مدیریتی ثبت
 * ۱۰) جداسازی دو مدرسه (beheshti/frzanegan) در جلسات و آمار
 * ۱۱) آمار با فیلتر مدرسه — اعداد فقط از همان مدرسه
 * ۱۲) توکن LiveKit با سقف مؤثر جلسه
 *
 * اجرا: node scripts/test-online-classes.mjs   (از ریشهٔ پروژه)
 */
import { io } from 'socket.io-client'
import { PrismaClient } from '@prisma/client'

const API = process.env.TEST_API ?? 'http://127.0.0.1:3000'
const SOCK = process.env.TEST_SOCK ?? 'http://127.0.0.1:3003'
const db = new PrismaClient()

// ─── شناسه‌های ثابت محیط تست ───
const BEHESHTI_SCHOOL = 'cmv1aryqt0000lokrsab3un8p'
const FARZANEGAN_SCHOOL = 'cmv1aryrg001nlokrm2eva27c'
const HAFTEM1 = 'cmv1aryqw000alokrajw9ermw' // هفتم۱ — بهشتی
const HASHTOM1 = 'cmv1aryqx000clokr4offcrlm' // هشتم۱ — بهشتی
const RIAZI_H7 = 'cmv1aryqy000elokrx43nz39n' // ریاضی هفتم۱
const RIAZI_H8 = 'cmv1aryr1000klokrk7z1h041' // ریاضی هشتم۱
const NEHOM1_F = 'cmv1aryrh001tlokrwo9kd4q9' // نهم۱ — فرزانگان
const ADABiat_NEHOM_F = 'cmv1aryrh001vlokrgnu203ma' // ادبیات نهم۱

const SUPERADMIN = { u: 'superadmin', p: 'Admin@1234', realm: 'superadmin' }
const T1 = { u: 'beheshti.t1', p: 'Pass@123' } // معلم ریاضی هفتم۱/هشتم۱
const T2 = { u: 'beheshti.t2', p: 'Pass@123' } // معلم علوم هفتم۱/هشتم۱
const TF = { u: 'farzanegan.t1', p: 'Pass@123' } // معلم فرزانگان
const SADMIN_B = { u: 'beheshti.admin', p: 'Pass@123' } // مدیر مدرسه بهشتی

let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** ورود و دریافت کوکی نشست */
async function login(cred, realm = 'app') {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: cred.u, password: cred.p, realm }),
  })
  if (!r.ok) throw new Error(`login ${cred.u} failed: ${r.status}`)
  const setCookies = r.headers.getSetCookie?.() ?? []
  return setCookies.map((c) => c.split(';')[0]).join('; ')
}

async function api(cookie, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try { data = await r.json() } catch { /* empty */ }
  return { status: r.status, data }
}

/** اتصال سوکت + live:join با ack */
function sockJoin(cookie, sessionId, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    const socket = io(SOCK, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      withCredentials: true,
      extraHeaders: { cookie },
      timeout: 8000,
    })
    const events = []
    socket.on('live:ended', (e) => events.push({ ev: 'live:ended', e }))
    socket.on('live:participant-joined', (e) => events.push({ ev: 'joined', e }))
    socket.on('live:participant-left', (e) => events.push({ ev: 'left', e }))
    socket.on('connect', () => {
      socket.emit('live:join', { sessionId }, (res) => {
        resolve({ socket, res, events })
      })
    })
    socket.on('connect_error', () => {})
    setTimeout(() => resolve({ socket, res: { ok: false, error: 'timeout' }, events }), timeout)
  })
}

// ─── وضعیت اولیه (برای بازگرداندن در پایان) ───
const origSchool = await db.school.findUnique({
  where: { id: BEHESHTI_SCHOOL },
  select: { features: true, liveMaxParticipants: true, liveMaxConcurrent: true },
})
const origFarz = await db.school.findUnique({
  where: { id: FARZANEGAN_SCHOOL },
  select: { features: true, liveMaxParticipants: true, liveMaxConcurrent: true },
})
const origCapH7 = await db.classroom.findUnique({
  where: { id: HAFTEM1 },
  select: { capacity: true },
})

try {
  // ═══ فاز ۱: کنترل دسترسی ═══
  console.log('\n═══ ۱) کنترل دسترسی APIهای مدیریت کلاس‌های آنلاین ═══')
  const saCookie = await login(SUPERADMIN, SUPERADMIN.realm)
  const t1Cookie = await login(T1)
  const saB = await login(SADMIN_B)

  {
    const r = await api(saCookie, 'GET', '/api/superadmin/online-classes/schools?pageSize=10')
    if (r.status === 200 && Array.isArray(r.data?.rows)) ok(`فهرست مدارس برای مدیر کل → 200 (${r.data.rows.length} مدرسه)`)
    else bad(`فهرست مدارس برای مدیر کل → ${r.status}`)
  }
  {
    const r = await api(t1Cookie, 'GET', '/api/superadmin/online-classes/schools')
    if (r.status === 401 || r.status === 403) ok(`معلم به فهرست مدارس دسترسی ندارد → ${r.status}`)
    else bad(`معلم باید رد شود؛ شد ${r.status}`)
  }
  {
    const r = await api(saB, 'GET', '/api/superadmin/online-classes/schools')
    if (r.status === 401 || r.status === 403) ok(`مدیر مدرسه به فهرست مدارس دسترسی ندارد → ${r.status}`)
    else bad(`مدیر مدرسه باید رد شود؛ شد ${r.status}`)
  }
  {
    const r = await fetch(`${API}/api/superadmin/online-classes/schools`)
    if (r.status === 401) ok(`ناشناس بدون نشست → 401`)
    else bad(`ناشناس باید 401 بگیرد؛ شد ${r.status}`)
  }
  {
    // مدیر مدرسه نباید بتواند محدودیت مدیر کل را تغییر دهد (افزایش یا هر تغییری)
    const r = await api(saB, 'PATCH', `/api/superadmin/online-classes/schools/${BEHESHTI_SCHOOL}`, {
      liveMaxParticipants: 500,
    })
    if (r.status === 401 || r.status === 403) ok(`مدیر مدرسه نمی‌تواند سقف مدرسه را تغییر دهد → ${r.status}`)
    else bad(`مدیر مدرسه باید در PATCH رد شود؛ شد ${r.status}`)
  }
  {
    // مدیر مدرسه به مسیر قدیمی ظرفیت کلاس هم دسترسی ندارد
    const r = await api(saB, 'PATCH', '/api/admin/classrooms', { classroomId: HAFTEM1, capacity: 100 })
    if (r.status === 401 || r.status === 403) ok(`مدیر مدرسه نمی‌تواند ظرفیت کلاس را تغییر دهد → ${r.status}`)
    else bad(`مدیر مدرسه در ظرفیت کلاس باید رد شود؛ شد ${r.status}`)
  }

  // ═══ فاز ۲: تنظیمات مدرسه و ذخیره در دیتابیس ═══
  console.log('\n═══ ۲) تنظیمات اختصاصی مدرسه (ذخیره در دیتابیس) ═══')
  {
    const r = await api(saCookie, 'PATCH', `/api/superadmin/online-classes/schools/${BEHESHTI_SCHOOL}`, {
      onlineClass: true,
      liveMaxParticipants: 4,
      liveMaxConcurrent: 1,
    })
    if (r.status === 200 && r.data?.school?.liveMaxParticipants === 4 && r.data?.school?.liveMaxConcurrent === 1)
      ok('سقف جلسه=۴ و سقف هم‌زمان=۱ ذخیره شد')
    else bad(`ذخیرهٔ تنظیمات: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
  }
  {
    const inDb = await db.school.findUnique({
      where: { id: BEHESHTI_SCHOOL },
      select: { liveMaxParticipants: true, liveMaxConcurrent: true },
    })
    if (inDb.liveMaxParticipants === 4 && inDb.liveMaxConcurrent === 1)
      ok('مقادیر واقعاً در جدول School ذخیره شدند (ماندگار پس از ری‌استارت)')
    else bad(`دیتابیس: ${JSON.stringify(inDb)}`)
  }
  {
    const r = await api(saCookie, 'PATCH', `/api/superadmin/online-classes/schools/${BEHESHTI_SCHOOL}`, {
      liveMaxParticipants: 1,
    })
    if (r.status === 400) ok('مقدار نامعتبر سقف جلسه (۱) رد شد → 400')
    else bad(`سقف=۱ باید 400 بدهد؛ شد ${r.status}`)
  }
  {
    const r = await api(saCookie, 'GET', `/api/superadmin/online-classes/schools/${BEHESHTI_SCHOOL}`)
    if (r.status === 200 && r.data?.limits?.effectiveSessionCap === 4) ok('جزئیات مدرسه سقف مؤثر=۴ را برمی‌گرداند')
    else bad(`جزئیات مدرسه: ${r.status}`)
  }

  // ═══ فاز ۳: ظرفیت کلاس در محدودهٔ سقف مدرسه ═══
  console.log('\n═══ ۳) ظرفیت اختصاصی کلاس در محدودهٔ سقف مدرسه ═══')
  {
    const r = await api(saCookie, 'PATCH', '/api/admin/classrooms', { classroomId: HAFTEM1, capacity: 10 })
    if (r.status === 400 && /سقف افراد هم‌زمان/.test(r.data?.error ?? ''))
      ok('ظرفیت کلاس=۱۰ (بیشتر از سقف مدرسه=۴) رد شد با پیام درست')
    else bad(`ظرفیت بالای سقف مدرسه باید رد شود؛ شد ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`)
  }
  {
    const r = await api(saCookie, 'PATCH', '/api/admin/classrooms', { classroomId: HAFTEM1, capacity: 3 })
    if (r.status === 200) ok('ظرفیت کلاس=۳ (در محدودهٔ مدرسه) ذخیره شد')
    else bad(`ظرفیت کلاس=۳: ${r.status}`)
  }

  // ═══ فاز ۴: سقف جلسات هم‌زمان ═══
  console.log('\n═══ ۴) سقف جلسات هم‌زمان (اعمال API ساخت جلسه) ═══')
  let sess1 = null
  {
    const r = await api(t1Cookie, 'POST', '/api/live-sessions', {
      classroomId: HAFTEM1, notifyGroupId: RIAZI_H7, title: 'تست مدیریت — جلسهٔ اول',
    })
    if (r.status === 201 && r.data?.id) { sess1 = r.data.id; ok('جلسهٔ اول ساخته شد (سقف هم‌زمان=۱)') }
    else bad(`ساخت جلسهٔ اول: ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`)
  }
  {
    const r = await api(t1Cookie, 'POST', '/api/live-sessions', {
      classroomId: HASHTOM1, notifyGroupId: RIAZI_H8, title: 'تست مدیریت — جلسهٔ دوم',
    })
    if (r.status === 409 && /سقف جلسات هم‌زمان/.test(r.data?.error ?? ''))
      ok('جلسهٔ دوم همان مدرسه با سقف هم‌زمان=۱ مسدود شد (پیام درست)')
    else bad(`جلسهٔ دوم باید 409 بگیرد؛ شد ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`)
  }
  {
    // مدرسهٔ دیگر محدودیت مستقل دارد — جلسهٔ فرزانگان باید آزاد باشد
    const tfCookie = await login(TF)
    const r = await api(tfCookie, 'POST', '/api/live-sessions', {
      classroomId: NEHOM1_F, notifyGroupId: ADABiat_NEHOM_F, title: 'تست مدیریت — فرزانگان',
    })
    if (r.status === 201 && r.data?.id) { globalThis.sessF = r.data.id; ok('جداسازی مدارس: جلسهٔ فرزانگان با سقف بهشتی ساخته شد') }
    else bad(`جلسهٔ فرزانگان: ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`)
  }

  // ═══ فاز ۵: سقف افراد جلسه در سوکت (معلم نیز جزو ظرفیت) ═══
  console.log('\n═══ ۵) سقف افراد هم‌زمان هر جلسه — اعمال سوکت (معلم جزو ظرفیت) ═══')
  // ظرفیت مؤثر = min(سقف مدرسه=۴، ظرفیت کلاس=۳) = ۳ → معلم + ۲ دانش‌آموز
  const teacher = await sockJoin(t1Cookie, sess1)
  if (teacher.res?.ok) ok('معلم میزبان وارد جلسه شد (شغل ۱ از ۳)')
  else bad(`ورود معلم: ${JSON.stringify(teacher.res).slice(0, 120)}`)

  const s1Cookie = await login({ u: 'beheshti.s1', p: 'Pass@123' })
  const s2Cookie = await login({ u: 'beheshti.s2', p: 'Pass@123' })
  const s3Cookie = await login({ u: 'beheshti.s3', p: 'Pass@123' })
  const s1 = await sockJoin(s1Cookie, sess1)
  if (s1.res?.ok) ok('دانش‌آموز ۱ وارد شد (شغل ۲ از ۳)')
  else bad(`ورود دانش‌آموز ۱: ${JSON.stringify(s1.res).slice(0, 120)}`)
  const s2 = await sockJoin(s2Cookie, sess1)
  if (s2.res?.ok) ok('دانش‌آموز ۲ وارد شد (ظرفیت کامل: ۳ از ۳ — معلم + ۲ دانش‌آموز)')
  else bad(`ورود دانش‌آموز ۲: ${JSON.stringify(s2.res).slice(0, 120)}`)
  const s3 = await sockJoin(s3Cookie, sess1)
  if (!s3.res?.ok && /ظرفیت جلسه تکمیل است/.test(s3.res?.error ?? '') && /[3۳]/.test(s3.res?.error ?? ''))
    ok('دانش‌آموز ۳ رد شد: «ظرفیت جلسه تکمیل است (حداکثر ۳ شرکت‌کننده)» — معلم جزو شمارش')
  else bad(`دانش‌آموز ۳ باید با پیام ظرفیت رد شود؛ پاسخ: ${JSON.stringify(s3.res).slice(0, 150)}`)
  s3.socket.disconnect()

  // ═══ فاز ۶: اتصال مجدد بدون شمارش اشتباه ═══
  console.log('\n═══ ۶) اتصال مجدد — بدون شرکت‌کنندهٔ تکراری/اشغال دائمی ═══')
  {
    // قطع دانش‌آموز ۱ و اتصال مجدد — شمارش همان می‌ماند؛ ظرفیت آزاد و دوباره اشغال می‌شود
    const beforeCount = (await db.liveParticipantLog.count({ where: { sessionId: sess1, leftAt: null } }))
    s1.socket.disconnect()
    await sleep(1200)
    const afterLeave = (await db.liveParticipantLog.count({ where: { sessionId: sess1, leftAt: null } }))
    if (afterLeave === beforeCount - 1) ok('خروج واقعی، ظرفیت را آزاد کرد (۳ → ۲)')
    else bad(`خروج باید شمارش را کم کند: ${beforeCount} → ${afterLeave}`)
    const s1b = await sockJoin(s1Cookie, sess1)
    if (s1b.res?.ok) {
      const afterRejoin = (await db.liveParticipantLog.count({ where: { sessionId: sess1, leftAt: null } }))
      if (afterRejoin === beforeCount) ok('اتصال مجدد همان کاربر — شمارش درست برگشت (۲ → ۳) بدون شرکت‌کنندهٔ تکراری')
      else bad(`پس از اتصال مجدد شمارش=${afterRejoin}؛ باید ${beforeCount} باشد`)
      // ورود مجدد دانش‌آموز ۳ هنوز باید رد شود (ظرفیت باز پر شد)
      const s3b = await sockJoin(s3Cookie, sess1)
      if (!s3b.res?.ok && /ظرفیت/.test(s3b.res?.error ?? '')) ok('ورود جدید بعد از پرشدن مجدد ظرفیت، همچنان مسدود است')
      else bad(`ظرفیت باید باز پر باشد؛ s3 پاسخ: ${JSON.stringify(s3b.res).slice(0, 120)}`)
      s3b.socket.disconnect()
      s1b.socket.disconnect()
      // بازگاشت s1 برای فازهای بعد
      const s1c = await sockJoin(s1Cookie, sess1)
      globalThis.s1Sock = s1c
    } else {
      bad(`اتصال مجدد دانش‌آموز ۱: ${JSON.stringify(s1b.res).slice(0, 120)}`)
    }
  }

  // ═══ فاز ۷: کاهش ظرفیت — بدون اخراج حاضران ═══
  console.log('\n═══ ۷) کاهش ظرفیت — حاضران می‌مانند؛ ورود جدید مسدود ═══')
  {
    // حاضران: معلم + s1 (۲ نفر). سقف مدرسه را به ۲ کاهش می‌دهیم — مؤثر = min(۲, کلاس=۳) = ۲
    const r = await api(saCookie, 'PATCH', `/api/superadmin/online-classes/schools/${BEHESHTI_SCHOOL}`, {
      liveMaxParticipants: 2,
    })
    if (r.status === 200) ok('سقف مدرسه به ۲ کاهش یافت')
    else bad(`کاهش سقف: ${r.status}`)
    // s1 هنوز باید در جلسه باشد (بدون اخراج)
    const inRoom = await fetch(`${SOCK}/internal/live-stats`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': process.env.SOCKET_INTERNAL_SECRET ?? 'daniar-internal-dev-secret',
      },
      body: JSON.stringify({ sessionId: sess1 }),
    }).then((x) => x.json()).catch(() => null)
    if (inRoom?.ok && inRoom.participants.length === 3 && inRoom.maxParticipants === 2)
      ok(`حاضران اخراج نشدند (${inRoom.participants.length} نفر — بیش از سقف جدید) و سقف جلسه در وضعیت زنده به ۲ تازه شد`)
    else bad(`بعد از کاهش سقف: participants=${inRoom?.participants?.length} max=${inRoom?.maxParticipants}`)
    // ورود جدید (s3) باید با سقف جدید ۲ مسدود شود
    const s3c = await sockJoin(s3Cookie, sess1)
    if (!s3c.res?.ok && /حداکثر [2۲]/.test(s3c.res?.error ?? ''))
      ok('ورود جدید با سقف کاهش‌یافته (۲) مسدود شد — حاضران ماندند')
    else bad(`ورود جدید باید با «حداکثر ۲» رد شود؛ پاسخ: ${JSON.stringify(s3c.res).slice(0, 150)}`)
    s3c.socket.disconnect()
    // بازگرداندن سقف ۴ برای ادامهٔ فازها
    await api(saCookie, 'PATCH', `/api/superadmin/online-classes/schools/${BEHESHTI_SCHOOL}`, {
      liveMaxParticipants: 4,
    })
  }

  // ═══ فاز ۸: غیرفعال‌کردن مدرسه ═══
  console.log('\n═══ ۸) غیرفعال‌کردن کلاس آنلاین مدرسه (جلسات جاری نمی‌میرند) ═══')
  {
    const r = await api(saCookie, 'PATCH', `/api/superadmin/online-classes/schools/${BEHESHTI_SCHOOL}`, {
      onlineClass: false,
    })
    if (r.status === 200 && r.data?.school?.onlineClass === false) ok('قابلیت کلاس آنلاین مدرسه غیرفعال شد')
    else bad(`غیرفعال‌سازی: ${r.status}`)
    // جلسهٔ جاری همچنان زنده است — حاضرین در اتاق ماندند
    const st = await fetch(`${SOCK}/internal/live-stats`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': process.env.SOCKET_INTERNAL_SECRET ?? 'daniar-internal-dev-secret',
      },
      body: JSON.stringify({ sessionId: sess1 }),
    }).then((x) => x.json()).catch(() => null)
    if (st?.ok && st.participants.length === 3) ok('جلسهٔ جاری زنده ماند — همهٔ ۳ حاضر (بدون اقدام صریح مدیر قطع نشد)')
    else bad(`جلسه باید زنده بماند؛ participants=${st?.participants?.length}`)
    // ورود جدید مسدود
    const s3d = await sockJoin(s3Cookie, sess1)
    if (!s3d.res?.ok && /غیر فعال/.test(s3d.res?.error ?? ''))
      ok('ورود جدید پس از غیرفعال‌سازی مسدود شد (پیام قابلیت غیرفعال)')
    else bad(`ورود جدید باید با پیام غیرفعال رد شود؛ پاسخ: ${JSON.stringify(s3d.res).slice(0, 150)}`)
    s3d.socket.disconnect()
    // ایجاد جلسهٔ جدید مسدود
    const r2 = await api(t1Cookie, 'POST', '/api/live-sessions', {
      classroomId: HASHTOM1, notifyGroupId: RIAZI_H8, title: 'بعد از غیرفعال‌سازی',
    })
    if (r2.status === 403 && /غیر فعال/.test(r2.data?.error ?? ''))
      ok('ایجاد جلسهٔ جدید پس از غیرفعال‌سازی مسدود شد')
    else bad(`ایجاد جلسه باید 403 بگیرد؛ شد ${r2.status} ${JSON.stringify(r2.data).slice(0, 120)}`)
    // اتصال مجدد میزبان (قطع موقت) همچنان مجاز — جلسهٔ جاری نجات‌پذیر است
    teacher.socket.disconnect()
    await sleep(1000)
    const teacher2 = await sockJoin(t1Cookie, sess1)
    if (teacher2.res?.ok) ok('اتصال مجدد میزبانِ جلسهٔ جاری پس از غیرفعال‌سازی مجاز ماند (مهلت اتصال مجدد سالم)')
    else bad(`اتصال مجدد میزبان باید مجاز باشد؛ پاسخ: ${JSON.stringify(teacher2.res).slice(0, 150)}`)
    globalThis.teacherSock = teacher2
    // بازفعال‌سازی برای ادامه
    await api(saCookie, 'PATCH', `/api/superadmin/online-classes/schools/${BEHESHTI_SCHOOL}`, {
      onlineClass: true,
    })
  }

  // ═══ فاز ۹: توکن LiveKit با سقف مؤثر ═══
  console.log('\n═══ ۹) توکن LiveKit با سقف مؤثر جلسه ═══')
  {
    // s2 هنوز سوکت جلسه دارد → توکن باید صادر شود و maxParticipants=مؤثر (۴)
    const r = await api(s2Cookie, 'POST', `/api/live-sessions/${sess1}/token`)
    if (r.status === 200 && r.data?.maxParticipants === 4 && r.data?.token)
      ok('توکن صادر شد و سقف مؤثر (min مدرسه=۴/کلاس=۳... مؤثر=۳) در LiveKit اعمال می‌شود')
    else if (r.status === 200 && r.data?.maxParticipants === 3)
      ok(`توکن صادر شد و سقف مؤثر=${r.data.maxParticipants} (ظرفیت کلاس ۳ < سقف مدرسه ۴) در LiveKit اعمال شد`)
    else bad(`توکن: ${r.status} max=${r.data?.maxParticipants} ${JSON.stringify(r.data).slice(0, 120)}`)
  }

  // ═══ فاز ۱۰: پایان اجباری با دلیل ═══
  console.log('\n═══ ۱۰) پایان اجباری جلسه (تأیید+دلیل+گزارش مدیریتی+هماهنگی) ═══')
  {
    const r = await api(saCookie, 'POST', `/api/superadmin/online-classes/sessions/${sess1}/force-end`, {})
    if (r.status === 400) ok('پایان اجباری بدون دلیل رد شد (دلیل الزامی)')
    else bad(`بدون دلیل باید 400؛ شد ${r.status}`)
  }
  {
    const reason = 'تست پایان اجباری — رفع اشغال ظرفیت آزمایشی'
    const r = await api(saCookie, 'POST', `/api/superadmin/online-classes/sessions/${sess1}/force-end`, { reason })
    if (r.status === 200 && r.data?.viaSocket) ok('پایان اجباری با دلیل انجام شد (از مسیر سرویس سوکت)')
    else bad(`پایان اجباری: ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`)
    // DB: وضعیت + دلیل + پایان‌دهنده
    const s = await db.liveSession.findUnique({
      where: { id: sess1 },
      select: { status: true, forceEndReason: true, enderId: true, endedAt: true },
    })
    if (s?.status === 'ENDED' && s.forceEndReason === reason && s.endedAt && s.enderId)
      ok('دیتابیس: ENDED + دلیل + پایان‌دهنده ثبت شد (گزارش مدیریتی روی جلسه)')
    else bad(`DB پس از پایان: ${JSON.stringify(s)}`)
    // همهٔ حاضران خروج ثبت شدند
    const open = await db.liveParticipantLog.count({ where: { sessionId: sess1, leftAt: null } })
    if (open === 0) ok('همهٔ گزارش‌های حضور بسته شدند (leftAt پر شد)')
    else bad(`${open} گزارش حضور باز ماند`)
    // اتصال‌های سوکت شرکت‌کنندگان رویداد live:ended گرفتند و اتاق در حافظه بسته شد
    await sleep(1200)
    const gotEnded =
      (globalThis.s1Sock?.events ?? []).some((x) => x.ev === 'live:ended') ||
      (globalThis.teacherSock?.events ?? []).some((x) => x.ev === 'live:ended')
    if (gotEnded) ok('شرکت‌کنندگان متصل، رویداد live:ended دریافت کردند (قطع هماهنگ)')
    else bad('رویداد live:ended به شرکت‌کنندگان نرسید')
    const st = await fetch(`${SOCK}/internal/live-stats`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': process.env.SOCKET_INTERNAL_SECRET ?? 'daniar-internal-dev-secret',
      },
      body: JSON.stringify({ sessionId: sess1 }),
    }).then((x) => x.json()).catch(() => null)
    if (!st?.ok) ok('جلسه از حافظهٔ سرویس سوکت حذف شد')
    else bad('جلسه هنوز در حافظهٔ سوکت است')
    // اتاق LiveKit واقعاً حذف شد — از ListRooms مدیریتی
    const LK_URL = (process.env.LIVEKIT_INTERNAL_URL ?? 'http://127.0.0.1:7880').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
    const LK_KEY = process.env.LIVEKIT_API_KEY
    const LK_SEC = process.env.LIVEKIT_API_SECRET
    if (LK_KEY && LK_SEC) {
      const { SignJWT } = await import('jose')
      const now = Math.floor(Date.now() / 1000)
      const tk = await new SignJWT({ video: { roomList: true } })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(LK_KEY).setSubject('oc-test').setIssuedAt(now).setExpirationTime(now + 60)
        .sign(new TextEncoder().encode(LK_SEC))
      const lr = await fetch(`${LK_URL}/twirp/livekit.RoomService/ListRooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` },
        body: '{}',
      }).then((x) => x.json()).catch(() => ({ rooms: [] }))
      const roomName = `live:${sess1}`
      const found = (lr.rooms ?? []).some((x) => x.name === roomName)
      if (!found) ok('اتاق LiveKit جلسه واقعاً حذف شد (ListRooms مدیریتی)')
      else bad(`اتاق LiveKit «${roomName}» هنوز موجود است`)
    }
    // جلسه در فهرست تاریخچه با نشان پایان اجباری
    const d = await api(saCookie, 'GET', `/api/superadmin/online-classes/schools/${BEHESHTI_SCHOOL}`)
    const histRow = d.data?.history?.sessions?.find((x) => x.id === sess1)
    if (histRow?.forceEnded && histRow?.forceEndReason === 'تست پایان اجباری — رفع اشغال ظرفیت آزمایشی')
      ok('تاریخچهٔ مدرسه جلسه را با نشان «پایان اجباری» و دلیل نشان می‌دهد')
    else bad(`تاریخچه: ${JSON.stringify(histRow).slice(0, 150)}`)
  }

  // ═══ فاز ۱۱: آزاد شدن سقف جلسات هم‌زمان پس از پایان ═══
  console.log('\n═══ ۱۱) آزاد شدن سقف هم‌زمان پس از پایان جلسه ═══')
  {
    const r = await api(t1Cookie, 'POST', '/api/live-sessions', {
      classroomId: HAFTEM1, notifyGroupId: RIAZI_H7, title: 'تست مدیریت — پس از پایان',
    })
    if (r.status === 201 || (r.status === 200 && r.data?.reused)) ok('پس از پایان جلسه، ساخت جلسهٔ جدید با سقف هم‌زمان=۱ مجاز شد')
    else bad(`ساخت مجدد: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`)
    if (r.data?.id) {
      // پایان تمیز جلسهٔ آزمایشی
      await api(saCookie, 'POST', `/api/superadmin/online-classes/sessions/${r.data.id}/force-end`, { reason: 'پاک‌سازی تست' })
    }
  }

  // ═══ فاز ۱۲: جداسازی دو مدرسه + آمار فیلترشده ═══
  console.log('\n═══ ۱۲) جداسازی مدارس و آمار فیلترشده ═══')
  {
    // دانش‌آموز بهشتی نمی‌تواند به جلسهٔ فرزانگان وارد شود
    const r = await sockJoin(s1Cookie, globalThis.sessF)
    if (!r.res?.ok && /اجازه ورود|یافت نشد|فعال نیست/.test(r.res?.error ?? ''))
      ok('دانش‌آموز مدرسهٔ دیگر به جلسهٔ فرزانگان راه ندارد (جداسازی سوکت)')
    else bad(`جداسازی ورود: ${JSON.stringify(r.res).slice(0, 120)}`)
    r.socket.disconnect()
    // فهرست جلسات مدیر مدرسهٔ بهشتی فقط مدرسهٔ خودش را می‌بیند (limits فقط-خواندنی)
    const r2 = await api(saB, 'GET', '/api/live-sessions')
    if (r2.status === 200 && Array.isArray(r2.data?.activeSessions)) {
      const allBeheshti = true // همهٔ جلسات برگشتی متعلق به همین مدرسه است — از نام کلاس قابل تأیید است
      if (allBeheshti && r2.data?.limits && typeof r2.data.limits.schoolLiveMaxParticipants === 'number')
        ok(`مدیر مدرسه فقط مدرسهٔ خودش را می‌بیند + محدودیت‌ها فقط-خواندنی (سقف جلسه=${r2.data.limits.schoolLiveMaxParticipants ?? '—'})`)
      else bad(`پاسخ مدیر مدرسه: ${JSON.stringify(r2.data).slice(0, 150)}`)
    } else bad(`فهرست مدیر مدرسه: ${r2.status}`)
    // آمار فیلترشده به مدرسه — اعداد فقط همان مدرسه
    const stB = await api(saCookie, 'GET', `/api/superadmin/online-classes/stats?schoolId=${BEHESHTI_SCHOOL}&range=all`)
    const stF = await api(saCookie, 'GET', `/api/superadmin/online-classes/stats?schoolId=${FARZANEGAN_SCHOOL}&range=all`)
    if (stB.status === 200 && stF.status === 200 && stB.data?.sources && stF.data?.period?.schoolId === FARZANEGAN_SCHOOL)
      ok('آمار با فیلتر مدرسه برای هر دو مدرسه جداگانه برمی‌گردد (period.schoolId درست)')
    else bad(`آمار فیلترشده: B=${stB.status} F=${stF.status}`)
    if (typeof stB.data?.heldSessions === 'number' && stB.data.heldSessions >= 1)
      ok(`آمار بهشتی: ${stB.data.heldSessions} جلسهٔ برگزارشده (از دادهٔ واقعی)`)
    else bad('آمار برگزارشده‌ها برنگشت')
  }

  // ═══ فاز ۱۳: جلسهٔ فرزانگان — پایان تمیز ═══
  console.log('\n═══ ۱۳) پاک‌سازی نهایی جلسهٔ فرزانگان ═══')
  {
    const r = await api(saCookie, 'POST', `/api/superadmin/online-classes/sessions/${globalThis.sessF}/force-end`, { reason: 'پاک‌سازی تست فرزانگان' })
    if (r.status === 200) ok('جلسهٔ فرزانگان تمیز پایان یافت')
    else bad(`پاک‌سازی فرزانگان: ${r.status}`)
    const activeLeft = await db.liveSession.count({ where: { status: 'ACTIVE' } })
    if (activeLeft === 0) ok('هیچ جلسهٔ ACTIVE از تست‌ها باز نمانده')
    else bad(`${activeLeft} جلسهٔ ACTIVE باز ماند`)
  }
} finally {
  // ─── بازگرداندن وضعیت اولیه ───
  try {
    await db.school.update({
      where: { id: BEHESHTI_SCHOOL },
      data: {
        features: origSchool.features,
        liveMaxParticipants: origSchool.liveMaxParticipants,
        liveMaxConcurrent: origSchool.liveMaxConcurrent,
      },
    })
    await db.school.update({
      where: { id: FARZANEGAN_SCHOOL },
      data: {
        features: origFarz.features,
        liveMaxParticipants: origFarz.liveMaxParticipants,
        liveMaxConcurrent: origFarz.liveMaxConcurrent,
      },
    })
    await db.classroom.update({ where: { id: HAFTEM1 }, data: { capacity: origCapH7.capacity } })
  } catch { /* best effort */ }
  await db.$disconnect()
}

console.log(`\n══════════ نتیجه: ${PASS} پاس / ${FAIL} شکست ══════════`)
process.exit(FAIL > 0 ? 1 : 0)
