/**
 * تست E2E مرورگر — ادغام «تکالیف» و «حضور و غیاب» در تقویم آموزشی + منوها + کلاس آنلاین
 * (چهار درخواست کاربر در یک سناریو):
 *  ۱) ثبت تکلیف درسی از دیالوگ روز تقویم (نوع «تکلیف») — ایجاد تکلیف واقعی + رویداد متصل
 *  ۲) دکمه «ثبت غیبت‌های امروز» در دیالوگ روز برای معلم/مدیر → لیست دانش‌آموزان → ثبت غیبت
 *  ۳) رگرسیون کلاس آنلاین: ورود معلم → اعلام → ورود دانش‌آموز + پاک‌سازی جلسات بی‌اعلام
 *  ۴) منوها: حذف «تکالیف» و «حضور و غیاب» از سایدبار/موبایل برای همه نقش‌ها، تقویم برای همه
 *
 * اجرا: TEST_BASE=http://localhost:81 bun scripts/test-calendar-integrations.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const jalaali = require('/home/z/my-project/node_modules/jalaali-js')
const { PrismaClient } = require('/home/z/my-project/node_modules/@prisma/client')
const db = new PrismaClient()

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const ADMIN = { username: 'beheshti.admin', password: 'Pass@123' }
const TEACHER = { username: 'beheshti.t1', password: 'Pass@123' }
const STUDENT = { username: 'beheshti.s1', password: 'Pass@123' }

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOT = '/home/z/my-project/download'
async function shot(page, name) {
  try { await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false }) } catch {}
}

/* ---------- تاریخ جلالی (هم‌سان با سرور: Asia/Tehran) ---------- */
const faNum = (n) => new Intl.NumberFormat('fa-IR').format(n)
const pad2 = (n) => String(n).padStart(2, '0')
const tehranFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
})
const MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند']
function todayJ() {
  const [gy, gm, gd] = tehranFmt.format(new Date()).split('-').map(Number)
  return jalaali.toJalaali(gy, gm, gd)
}
const keyOf = (j, d) => `${j.jy}-${pad2(j.jm)}-${pad2(d)}`
const T = todayJ()
const MONTH_LEN = jalaali.jalaaliMonthLength(T.jy, T.jm)
const MONTH_NAME = MONTHS[T.jm - 1]
const remaining = MONTH_LEN - T.jd
const off = remaining >= 7 ? [3, 5, 7] : remaining >= 4 ? [1, 2, 4] : [1, 2, 3]
const [D1, D2, D3] = off.map((o) => T.jd + o)
const dayLabel = (d) => `روز ${faNum(d)} ${MONTH_NAME}`

/* ---------- کمکی‌های API (کوکی‌دار) ---------- */
async function apiLogin(user) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: user.password, realm: 'app' }),
  })
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  if (!res.ok || !cookie) throw new Error(`login failed for ${user.username}: ${res.status}`)
  return cookie
}
async function apiGet(cookie, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie } })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
async function apiPost(cookie, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
async function apiDelete(cookie, path) {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: { cookie } })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

/** پر کردن فیلد کنترل‌شده React با تأیید مقدار (تا hydrate شدن) */
async function fillHydrated(locator, value) {
  for (let i = 0; i < 10; i++) {
    await locator.click()
    await locator.fill('')
    await locator.fill(value)
    if ((await locator.inputValue()) === value) return
    await sleep(700)
  }
  throw new Error('fill never stuck (input not hydrated)')
}

async function pickSelect(page, ariaLabel, optionText, contains = false) {
  const trigger = page.getByRole('combobox', { name: ariaLabel })
  await trigger.waitFor({ state: 'visible', timeout: 10000 })
  await trigger.click()
  const option = contains
    ? page.getByRole('option').filter({ hasText: optionText }).first()
    : page.getByRole('option', { name: optionText, exact: true }).first()
  await option.waitFor({ state: 'visible', timeout: 5000 })
  await option.click()
}

async function expectToast(page, text, timeout = 8000) {
  try {
    await page
      .locator('[role="status"], [data-sonner-toast]')
      .filter({ hasText: text })
      .first()
      .waitFor({ state: 'visible', timeout })
    ok(`توست: «${text}»`)
  } catch {
    bad(`توست «${text}» دیده نشد`)
  }
}

/** ورود UI از /login (با پاک‌کردن نشست قبلی مرورگر) */
async function uiLogin(page, user) {
  await page.context().clearCookies()
  await page.goto(`${BASE}/login`)
  await fillHydrated(page.locator('#username'), user.username)
  await fillHydrated(page.locator('#password'), user.password)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 })
}

/** باز کردن دیالوگ روز از تقویم با کلیک روی سلول/ردیف روز */
async function openDay(page, d) {
  await page.getByRole('button', { name: new RegExp(`^${dayLabel(d)}`) }).first().click()
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 7000 })
  await sleep(400)
}

/** بستن بالاترین دیالوگ باز (Escape) — با شمارش دیالوگ‌های باز */
async function closeTopDialog(page) {
  const before = await page.locator('[data-slot="dialog-content"]').count()
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(400)
  const after = await page.locator('[data-slot="dialog-content"]').count()
  return after < before
}

/**
 * رسیدن به ویرایشگر حضور و غیاب در دیالوگ تو‌در‌تو — دو مسیر مجاز:
 * ① روز بدون جلسه → دکمه «شروع ثبت غیبت‌های امروز» → کلیک
 * ② جلسه‌ای از ران قبلی وجود دارد → ویرایشگر مستقیم باز می‌شود
 */
async function ensureAttendanceEditor(attDlg) {
  const editor = attDlg.locator('[data-testid="attendance-editor"]')
  const createBtn = attDlg.getByRole('button', { name: 'شروع ثبت غیبت‌های امروز' })
  // صبر تا پایان بارگذاری: ظاهرشدن «ویرایشگر» یا «دکمه ساخت» (هر کدام زودتر)
  await Promise.race([
    editor.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
    createBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
  ])
  await sleep(300)
  if ((await editor.count()) > 0 && (await editor.first().isVisible())) return 'existing'
  await createBtn.click({ timeout: 10000 })
  await editor.waitFor({ state: 'visible', timeout: 10000 })
  return 'created'
}

const createdEventIds = []
const createdAssignmentIds = []
const createdSessionIds = []

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (err) => pageErrors.push(String(err)))

// مرورگر جدا با دستگاه ساختگی کروم برای بخش کلاس آنلاین (تأیید مجوز رسانه خودکار)
const liveBrowser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})

try {
  /* ---------- ۰) آماده‌سازی ---------- */
  section('آماده‌سازی: ورود API + کلاس‌ها')
  const adminCookie = await apiLogin(ADMIN)
  const teacherCookie = await apiLogin(TEACHER)
  const studentCookie = await apiLogin(STUDENT)
  ok('ورود API مدیر/معلم/دانش‌آموز')

  const { data: adminClasses } = await apiGet(adminCookie, '/api/calendar/classes')
  const classes = adminClasses.classrooms ?? []
  const SEVENTH1 = classes.find((c) => c.name === 'هفتم۱')
  if (!SEVENTH1) throw new Error('کلاس هفتم۱ یافت نشد')
  ok(`کلاس هدف: «${SEVENTH1.name}»`)

  const { data: teacherAssignmentsData } = await apiGet(teacherCookie, '/api/assignments')
  const tGroups = teacherAssignmentsData.groups ?? []
  tGroups.length > 0 && tGroups.every((g) => typeof g.classroomId === 'string')
    ? ok(`گروه‌های معلم با classroomId برگشت (${tGroups.length} گروه)`)
    : bad(`گروه‌های معلم ناقص: ${JSON.stringify(tGroups)}`)
  const g7 = tGroups.find((g) => g.classroomId === SEVENTH1.id)
  if (!g7) throw new Error('گروه درسی معلم در هفتم۱ یافت نشد')

  /* ---------- ۱) منوها (تسک ۴) ---------- */
  section('منوها: حذف تکالیف/حضور و غیاب + تقویم برای همه نقش‌ها (دسکتاپ)')
  await uiLogin(page, TEACHER)
  ok('ورود UI معلم')
  let aside = page.locator('aside').first()
  await aside.getByText('گفتگوها').waitFor({ timeout: 10000 })
  ;(await aside.getByText('تقویم آموزشی').count()) >= 1
    ? ok('معلم: «تقویم آموزشی» در سایدبار هست')
    : bad('معلم: آیتم تقویم آموزشی نیست!')
  ;(await aside.getByText('حضور و غیاب', { exact: false }).count()) === 0
    ? ok('معلم: «حضور و غیاب» از سایدبار حذف شد')
    : bad('معلم: «حضور و غیاب» هنوز در سایدبار است!')
  ;(await aside.getByText('تکالیف', { exact: false }).count()) === 0
    ? ok('معلم: «تکالیف» از سایدبار حذف شد')
    : bad('معلم: «تکالیف» هنوز در سایدبار است!')

  await uiLogin(page, STUDENT)
  aside = page.locator('aside').first()
  await aside.getByText('گفتگوها').waitFor({ timeout: 10000 })
  ;(await aside.getByText('تقویم آموزشی').count()) >= 1
    ? ok('دانش‌آموز: «تقویم آموزشی» در سایدبار هست')
    : bad('دانش‌آموز: آیتم تقویم آموزشی نیست!')
  ;(await aside.getByText('حضور و غیاب', { exact: false }).count()) === 0
    ? ok('دانش‌آموز: «حضور و غیاب من» از سایدبار حذف شد')
    : bad('دانش‌آموز: «حضور و غیاب من» هنوز در سایدبار است!')
  ;(await aside.getByText('تکالیف', { exact: false }).count()) === 0
    ? ok('دانش‌آموز: «تکالیف من» از سایدبار حذف شد')
    : bad('دانش‌آموز: «تکالیف من» هنوز در سایدبار است!')

  await uiLogin(page, ADMIN)
  aside = page.locator('aside').first()
  await aside.getByText('گفتگوها').waitFor({ timeout: 10000 })
  ;(await aside.getByText('تقویم آموزشی').count()) >= 1
    ? ok('مدیر: «تقویم آموزشی» در سایدبار هست')
    : bad('مدیر: آیتم تقویم آموزشی نیست!')
  ;(await aside.getByText('حضور و غیاب', { exact: false }).count()) === 0
    ? ok('مدیر: «حضور و غیاب» از سایدبار حذف شد')
    : bad('مدیر: «حضور و غیاب» هنوز در سایدبار است!')
  ;(await aside.getByText('تکالیف', { exact: false }).count()) === 0
    ? ok('مدیر: «تکالیف» از سایدبار حذف شد')
    : bad('مدیر: «تکالیف» هنوز در سایدبار است!')

  // منوی موبایلی — دانش‌آموز
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mpage = await mob.newPage()
  mpage.on('pageerror', (err) => pageErrors.push(String(err)))
  await uiLogin(mpage, STUDENT)
  const mobileNav = mpage.locator('nav[aria-label="ناوبری موبایل"]')
  await mobileNav.getByText('گفتگوها').waitFor({ timeout: 10000 })
  ;(await mobileNav.getByText('تقویم').count()) >= 1
    ? ok('موبایل دانش‌آموز: «تقویم» در نوار پایین هست')
    : bad('موبایل دانش‌آموز: «تقویم» در نوار پایین نیست!')
  ;(await mobileNav.getByText('حضور و غیاب', { exact: false }).count()) === 0
    ? ok('موبایل دانش‌آموز: «حضور و غیاب» حذف شد')
    : bad('موبایل دانش‌آموز: «حضور و غیاب» هنوز هست!')
  ;(await mobileNav.getByText('تکالیف', { exact: false }).count()) === 0
    ? ok('موبایل دانش‌آموز: «تکالیف» حذف شد')
    : bad('موبایل دانش‌آموز: «تکالیف» هنوز هست!')
  await mob.close()

  /* ---------- ۲) ثبت تکلیف از تقویم توسط معلم (تسک ۱) ---------- */
  section('ثبت تکلیف درسی از دیالوگ روز تقویم (معلم)')
  await uiLogin(page, TEACHER)
  await page.goto(`${BASE}/calendar`)
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  await pickSelect(page, 'انتخاب کلاس تقویم', 'هفتم۱')
  await sleep(800)

  const HW_TITLE = `حل تمرین فصل ۳ — تست ${Date.now() % 100000}`
  await openDay(page, D1)
  let dlg = page.getByRole('dialog')
  ;(await dlg.getByText('حضور و غیاب این روز').count()) === 1
    ? ok('معلم: بخش «حضور و غیاب این روز» در دیالوگ هست')
    : bad('معلم: بخش حضور و غیاب در دیالوگ نیست!')
  ;(await dlg.getByRole('button', { name: 'ثبت غیبت‌های امروز' }).count()) === 1
    ? ok('معلم: دکمه «ثبت غیبت‌های امروز» قابل مشاهده است')
    : bad('معلم: دکمه ثبت غیبت‌های امروز نیست!')

  await dlg.getByRole('button', { name: 'نوع تکلیف', exact: true }).click()
  const hwForm = dlg.locator('[data-testid="homework-form"]')
  await hwForm.waitFor({ state: 'visible', timeout: 5000 })
  ok('معلم: فرم تکلیف (گروه درسی/عنوان/مهلت/نمره/پیوست) با انتخاب نوع «تکلیف» باز شد')
  await pickSelect(page, 'گروه درسی تکلیف', g7.name)
  ok(`گروه درسی «${g7.name}» انتخاب شد`)
  await fillHydrated(page.locator('#assignment-title'), HW_TITLE)
  await fillHydrated(page.locator('#event-description'), 'تمرین‌های ۱ تا ۵ فصل ۳ را حل کنید')
  await dlg.getByRole('button', { name: 'مهلت پایان همین روز' }).click()
  ;((await page.locator('#assignment-due').inputValue()) !== '')
    ? ok('دکمه «مهلت پایان همین روز» فیلد مهلت را پر کرد')
    : bad('مهلت پایان همین روز پر نشد!')
  await shot(page, 'integration-homework-form')
  await dlg.getByRole('button', { name: 'ثبت تکلیف و رویداد تقویم' }).click()
  await expectToast(page, 'تکلیف ثبت شد')
  // رویداد تکلیف با لینک در فهرست روز
  await dlg.getByRole('link', { name: 'مشاهده تکلیف و پاسخ‌ها' }).waitFor({ timeout: 8000 })
  ok('رویداد «تکلیف» با لینک «مشاهده تکلیف و پاسخ‌ها» در دیالوگ ظاهر شد')
  await shot(page, 'integration-homework-created')

  // بررسی API: رویداد متصل به تکلیف واقعی
  const { data: evData } = await apiGet(
    teacherCookie,
    `/api/calendar/events?classroomId=${SEVENTH1.id}&from=${keyOf(T, D1)}&to=${keyOf(T, D1)}`,
  )
  const hwEvent = (evData.events ?? []).find((e) => e.type === 'HOMEWORK' && e.assignmentId)
  if (hwEvent) {
    ok(`رویداد تقویم assignmentId دارد و title آن «${hwEvent.assignmentTitle}» است`)
    createdEventIds.push(hwEvent.id)
    createdAssignmentIds.push(hwEvent.assignmentId)
  } else bad('رویداد HOMEWORK با assignmentId در API یافت نشد!')
  const { data: afterAssignments } = await apiGet(teacherCookie, '/api/assignments')
  const createdAssignment = (afterAssignments.assignments ?? []).find((a) => a.title === HW_TITLE)
  createdAssignment
    ? ok('تکلیف واقعی در API تکالیف ثبت شد (اعلان و پیام گروه خودکار)')
    : bad('تکلیف واقعی در فهرست تکالیف یافت نشد!')
  await closeTopDialog(page)

  /* ---------- ۳) دانش‌آموز: مشاهده تکلیف از تقویم ---------- */
  section('دانش‌آموز: مشاهده رویداد تکلیف و ورود به صفحه تکلیف')
  await uiLogin(page, STUDENT)
  await page.goto(`${BASE}/calendar`)
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  await sleep(800)
  await openDay(page, D1)
  dlg = page.getByRole('dialog')
  const hwLink = dlg.getByRole('link', { name: 'مشاهده تکلیف و ارسال پاسخ' })
  await hwLink.waitFor({ timeout: 8000 })
  ok('دانش‌آموز: لینک «مشاهده تکلیف و ارسال پاسخ» دیده می‌شود')
  ;(await dlg.getByText('حضور و غیاب این روز').count()) === 0
    ? ok('دانش‌آموز: بخش حضور و غیاب در دیالوگ روز ندارد')
    : bad('دانش‌آموز: بخش حضور و غیاب دیده می‌شود!')
  ;(await dlg.getByRole('button', { name: 'ثبت غیبت‌های امروز' }).count()) === 0
    ? ok('دانش‌آموز: دکمه «ثبت غیبت‌های امروز» ندارد')
    : bad('دانش‌آموز: دکمه ثبت غیبت دیده می‌شود!')
  await hwLink.click()
  await page.waitForURL((u) => u.pathname.startsWith('/assignments/'), { timeout: 15000 })
  await page.getByText(HW_TITLE).first().waitFor({ timeout: 15000 })
  ok('کلیک لینک → صفحه جزئیات تکلیف با عنوان تکلیف باز شد')
  await shot(page, 'integration-student-assignment')
  await page.goBack()

  /* ---------- ۴) مدیر: رویداد تکلیف ساده + راهنما ---------- */
  section('مدیر مدرسه: نوع «تکلیف» به‌صورت رویداد ساده + راهنمای انتساب به معلم')
  await uiLogin(page, ADMIN)
  await page.goto(`${BASE}/calendar`)
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  await pickSelect(page, 'انتخاب کلاس تقویم', 'هفتم۱')
  await sleep(800)
  await openDay(page, D2)
  dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'نوع تکلیف', exact: true }).click()
  ;(await dlg.getByText('تکلیف درسیِ متصل به گروه درسی', { exact: false }).count()) === 1
    ? ok('مدیر: راهنمای «ثبت تکلیف توسط معلم» نمایش داده شد')
    : bad('مدیر: راهنمای نوع تکلیف دیده نشد!')
  ;(await dlg.locator('[data-testid="homework-form"]').count()) === 0
    ? ok('مدیر: فرم تکلیف درسی (گروه/مهلت/نمره) ندارد')
    : bad('مدیر: فرم تکلیف درسی نباید نمایش داده شود!')
  await fillHydrated(page.locator('#event-description'), 'یادآوری تکالیف درسی این هفته')
  await dlg.getByRole('button', { name: 'ثبت رویداد', exact: true }).click()
  await expectToast(page, 'ثبت شد')
  await closeTopDialog(page)
  ok('مدیر: رویداد ساده «تکلیف» ثبت شد')
  {
    const { data: ev2 } = await apiGet(
      adminCookie,
      `/api/calendar/events?classroomId=${SEVENTH1.id}&from=${keyOf(T, D2)}&to=${keyOf(T, D2)}`,
    )
    const plain = (ev2.events ?? []).find((e) => e.type === 'HOMEWORK' && !e.assignmentId)
    if (plain) createdEventIds.push(plain.id)
    plain ? ok('مدیر: رویداد تکلیف بدون تکلیف متصل ثبت شد (assignmentId=null)')
          : bad('رویداد تکلیف مدیر یافت نشد!')
  }

  // مجوزهای منفی لینک تکلیف
  section('مجوزهای منفی لینک تکلیف در API تقویم')
  let r = await apiPost(teacherCookie, '/api/calendar/events', {
    classroomId: SEVENTH1.id, dateKey: keyOf(T, D2), type: 'EXAM',
    assignmentId: hwEvent?.assignmentId ?? 'x',
  })
  r.status === 400 ? ok('لینک تکلیف برای نوع غیر HOMEWORK → ۴۰۰') : bad(`نوع غیر HOMEWORK با لینک → ${r.status}`)
  r = await apiPost(teacherCookie, '/api/calendar/events', {
    classroomId: SEVENTH1.id, dateKey: keyOf(T, D2), type: 'HOMEWORK',
    assignmentId: 'nonexistent-id',
  })
  r.status === 404 ? ok('شناسه تکلیف ناموجود → ۴۰۴') : bad(`تکلیف ناموجود → ${r.status}`)
  r = await apiPost(adminCookie, '/api/calendar/events', {
    classroomId: SEVENTH1.id, dateKey: keyOf(T, D2), type: 'HOMEWORK',
    assignmentId: hwEvent?.assignmentId ?? 'x',
  })
  r.status === 403 ? ok('لینک تکلیف معلم توسط مدیر → ۴۰۳') : bad(`لینک تکلیف توسط مدیر → ${r.status}`)

  /* ---------- ۵) حضور و غیاب در دیالوگ روز (تسک ۲) ---------- */
  section('ثبت غیبت از تقویم (معلم): دکمه → لیست دانش‌آموزان → ثبت')
  await uiLogin(page, TEACHER)
  await page.goto(`${BASE}/calendar`)
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  await pickSelect(page, 'انتخاب کلاس تقویم', 'هفتم۱')
  await sleep(800)
  await openDay(page, D3)
  dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'ثبت غیبت‌های امروز' }).click()
  // دیالوگ تو در تو حضور و غیاب
  const attDlg = page.getByRole('dialog').filter({ hasText: 'ثبت حضور و غیاب —' })
  await attDlg.waitFor({ state: 'visible', timeout: 7000 })
  ok('دیالوگ «ثبت حضور و غیاب» روی دیالوگ روز باز شد')
  const path = await ensureAttendanceEditor(attDlg)
  path === 'created'
    ? ok('با کلیک «شروع ثبت غیبت‌های امروز» جلسه ساخته و لیست دانش‌آموزان باز شد')
    : ok('جلسه موجود روز (از ران قبلی) مستقیم باز شد — لیست دانش‌آموزان نمایش داده شد')
  attDlg.locator('[data-testid="attendance-editor"]')
  const rows = attDlg.locator('[data-testid="att-student-row"]')
  const rowCount = await rows.count()
  rowCount >= 1
    ? ok(`${faNum(rowCount)} دانش‌آموز در لیست هست`)
    : bad('هیچ دانش‌آموزی در لیست نیست!')
  // غیبت‌کردن اولین دانش‌آموز
  const firstRow = rows.first()
  const studentName = (await firstRow.locator('label').first().textContent())?.trim() ?? ''
  await firstRow.getByRole('checkbox').uncheck()
  await firstRow.getByText('غایب', { exact: true }).waitFor({ timeout: 5000 })
  ok(`«${studentName}» غایب علامت خورد (چک‌باکس حاضری برداشته شد)`)
  await shot(page, 'integration-attendance-editor')
  await attDlg.getByRole('button', { name: 'ذخیره پیش‌نویس' }).click()
  await expectToast(page, 'پیش‌نویس ذخیره شد')
  // بستن دیالوگ حضور و غیاب (تودرتو)
  ;(await closeTopDialog(page))
    ? ok('دیالوگ حضور و غیاب با Escape بسته شد (دیالوگ روز باز ماند)')
    : bad('بستن دیالوگ تو در تو ناموفق بود!')

  // بررسی API جلسه حضور و غیاب همان روز
  {
    const { data: sData } = await apiGet(
      teacherCookie,
      `/api/attendance/sessions?classroomId=${SEVENTH1.id}&from=${keyOf(T, D3)}&to=${keyOf(T, D3)}`,
    )
    const ss = sData.sessions ?? []
    ss.length >= 1
      ? ok(`جلسه حضور و غیاب در API برای روز ثبت شد (${ss.length} جلسه)`)
      : bad('جلسه حضور و غیاب در API یافت نشد!')
    if (ss[0]) {
      createdSessionIds.push(ss[0].id)
      ss[0].dateKey === keyOf(T, D3)
        ? ok(`dateKey جلسه دقیقاً روز انتخابی تقویم است (${ss[0].dateKey})`)
        : bad(`dateKey جلسه نادرست: ${ss[0].dateKey}`)
    }
  }

  // بازکردن مجدد روز → جلسه موجود مستقیم باز می‌شود
  await closeTopDialog(page) // بستن دیالوگ روز
  await sleep(300)
  await openDay(page, D3)
  dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'ثبت غیبت‌های امروز' }).click()
  const attDlg2 = page.getByRole('dialog').filter({ hasText: 'ثبت حضور و غیاب —' })
  await attDlg2.waitFor({ state: 'visible', timeout: 7000 })
  await ensureAttendanceEditor(attDlg2)
  ;(await attDlg2.getByText('پیش‌نویس').count()) >= 1
    ? ok('بازکردن مجدد: جلسه موجود با نشان «پیش‌نویس» مستقیم باز شد')
    : bad('جلسه موجود در بازکردن مجدد نمایش داده نشد!')
  await closeTopDialog(page)
  await closeTopDialog(page)

  /* ---------- ۶) حضور و غیاب برای مدیر + منفی دانش‌آموز ---------- */
  section('مدیر: دکمه ثبت غیبت + دانش‌آموز: بدون دکمه و ۴۰۳ API')
  await uiLogin(page, ADMIN)
  await page.goto(`${BASE}/calendar`)
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  await pickSelect(page, 'انتخاب کلاس تقویم', 'هفتم۱')
  await sleep(800)
  await openDay(page, D3)
  dlg = page.getByRole('dialog')
  ;(await dlg.getByRole('button', { name: 'ثبت غیبت‌های امروز' }).count()) === 1
    ? ok('مدیر: دکمه «ثبت غیبت‌های امروز» در دیالوگ روز هست')
    : bad('مدیر: دکمه ثبت غیبت نیست!')
  await closeTopDialog(page)

  await uiLogin(page, STUDENT)
  await page.goto(`${BASE}/calendar`)
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  await sleep(800)
  await openDay(page, D3)
  dlg = page.getByRole('dialog')
  ;(await dlg.getByRole('button', { name: 'ثبت غیبت‌های امروز' }).count()) === 0
    ? ok('دانش‌آموز: دکمه ثبت غیبت ندارد (مجدداً تأیید شد)')
    : bad('دانش‌آموز: دکمه ثبت غیبت دیده می‌شود!')
  await closeTopDialog(page)
  r = await apiPost(studentCookie, '/api/attendance/sessions', {
    classroomId: SEVENTH1.id, dateKey: keyOf(T, D3),
  })
  r.status === 403 ? ok('دانش‌آموز: ایجاد جلسه حضور و غیاب → ۴۰۳') : bad(`دانش‌آموز ایجاد جلسه → ${r.status}`)

  /* ---------- ۷) رگرسیون کلاس آنلاین (تسک ۳) ---------- */
  section('کلاس آنلاین: ورود معلم → اعلام → ورود دانش‌آموز')
  const { data: liveList } = await apiGet(teacherCookie, '/api/live-sessions')
  const c1 = (liveList.classrooms ?? []).find((c) => c.name === 'هفتم۱')
  if (!c1 || !c1.groups?.length) throw new Error('کلاس/گروه اطلاع‌رسانی هفتم۱ یافت نشد')
  const live = await apiPost(teacherCookie, '/api/live-sessions', {
    classroomId: c1.id, notifyGroupId: c1.groups[0].id, title: 'جلسه تست ادغام تقویم',
  })
  live.status === 201 ? ok('جلسه آنلاین ساخته شد') : bad(`ساخت جلسه → ${live.status} ${JSON.stringify(live.data)}`)
  const liveId = live.data.id

  // مرورگر معلم با رسانه ساختگی — ورود به اتاق باید در مهلت انجام شود
  const tctx = await liveBrowser.newContext({ viewport: { width: 1366, height: 860 } })
  const tpage = await tctx.newPage()
  tpage.on('pageerror', (err) => pageErrors.push(String(err)))
  await uiLogin(tpage, TEACHER)
  await tpage.goto(`${BASE}/live/${liveId}`)
  try {
    await tpage.locator('[data-tile-self]').first().waitFor({ timeout: 45000 })
    ok('معلم: وارد اتاق جلسه شد (فاز in-room — بدون گیر کردن در «در حال ورود به جلسه…»)')
  } catch {
    bad('معلم: ورود به اتاق در ۴۵ ثانیه انجام نشد!')
  }
  await shot(tpage, 'integration-live-teacher-room')

  // اعلام شروع باید خودکار انجام شود
  let announced = false
  for (let i = 0; i < 12; i++) {
    const { data: ls } = await apiGet(teacherCookie, '/api/live-sessions')
    const cc = (ls.classrooms ?? []).find((c) => c.id === c1.id)
    if (cc?.activeSession?.announcedAt) { announced = true; break }
    await sleep(2500)
  }
  announced ? ok('اعلان شروع کلاس خودکار ثبت شد (announcedAt ثبت گردید)') : bad('اعلان شروع ثبت نشد!')

  // دانش‌آموز: دکمه ورود فعال + ورود به اتاق
  const { data: sLive } = await apiGet(studentCookie, '/api/live-sessions')
  const sc = (sLive.classrooms ?? []).find((c) => c.id === c1.id)
  sc?.activeSession?.announcedAt
    ? ok('دانش‌آموز (API): جلسه اعلام‌شده را می‌بیند')
    : bad('دانش‌آموز (API): جلسه اعلام‌شده نیست!')
  const sctx = await liveBrowser.newContext({ viewport: { width: 1366, height: 860 } })
  const spage = await sctx.newPage()
  spage.on('pageerror', (err) => pageErrors.push(String(err)))
  await uiLogin(spage, STUDENT)
  await spage.goto(`${BASE}/live`)
  const enterBtn = spage.getByRole('link', { name: 'ورود به کلاس' }).first()
  await enterBtn.waitFor({ timeout: 20000 })
  ok('دانش‌آموز (UI): دکمه «ورود به کلاس» فعال شد')
  await enterBtn.click()
  try {
    await spage.locator('[data-tile-self]').first().waitFor({ timeout: 45000 })
    ok('دانش‌آموز: وارد اتاق جلسه شد')
  } catch {
    bad('دانش‌آموز: ورود به اتاق انجام نشد!')
  }
  await shot(spage, 'integration-live-student-room')

  // پایان جلسه — پاک‌سازی وضعیت
  await apiPost(teacherCookie, `/api/live-sessions/${liveId}/end`, {})

  /* ---------- ۸) پاک‌سازی خودکار جلسات بی‌اعلام (تسک ۳) ---------- */
  section('پاک‌سازی خودکار جلسه رهاشده اعلام‌نشده (۵ دقیقه)')
  const live2 = await apiPost(teacherCookie, '/api/live-sessions', {
    classroomId: c1.id, notifyGroupId: c1.groups[0].id, title: 'جلسه رهاشده برای تست پاک‌سازی',
  })
  if (live2.status === 201) {
    const staleId = live2.data.id
    // شبیه‌سازی گذشت زمان: startedAt را ۶ دقیقه عقب می‌بریم
    await db.liveSession.update({
      where: { id: staleId },
      data: { startedAt: new Date(Date.now() - 6 * 60 * 1000) },
    })
    const { data: sList2 } = await apiGet(studentCookie, '/api/live-sessions')
    const sc2 = (sList2.classrooms ?? []).find((c) => c.id === c1.id)
    sc2?.activeSession === null
      ? ok('دانش‌آموز: جلسه رهاشده از فهرست حذف شد (auto-end)')
      : bad(`جلسه رهاشده هنوز فعال است: ${JSON.stringify(sc2?.activeSession)}`)
    const dbSess = await db.liveSession.findUnique({ where: { id: staleId }, select: { status: true } })
    dbSess?.status === 'ENDED'
      ? ok('پایگاه داده: جلسه رهاشده به ENDED تغییر کرد')
      : bad(`وضعیت دیتابیس: ${dbSess?.status}`)
  } else bad(`ساخت جلسه دوم → ${live2.status}`)

  await shot(page, 'integration-final')
} catch (err) {
  bad(`خطای غیرمنتظره: ${err.message}`)
  try { await shot(page, 'integration-crash') } catch {}
} finally {
  /* ---------- پاک‌سازی ---------- */
  try {
    const adminCookie2 = await apiLogin(ADMIN)
    for (const id of createdEventIds) await apiDelete(adminCookie2, `/api/calendar/events/${id}`)
    const tCookie2 = await apiLogin(TEACHER)
    for (const id of createdAssignmentIds) await apiDelete(tCookie2, `/api/assignments/${id}`).catch(() => {})
    console.log(`\n🧹 پاک‌سازی: ${createdEventIds.length} رویداد + ${createdAssignmentIds.length} تکلیف تست`)
  } catch (e) {
    console.log(`🧹 پاک‌سازی ناموفق: ${e.message}`)
  }
  await db.$disconnect()
  await browser.close()
  await liveBrowser.close()
  console.log(`\n══════════════════════════════`)
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`)
  if (pageErrors.length) {
    console.log(`⚠️ خطاهای صفحه (pageerror): ${pageErrors.length}`)
    for (const e of pageErrors.slice(0, 5)) console.log('   ', e.slice(0, 200))
  } else {
    console.log('✅ هیچ خطای جاوااسکریپتی در صفحه رخ نداد')
  }
  process.exit(fail === 0 && pageErrors.length === 0 ? 0 : 1)
}
