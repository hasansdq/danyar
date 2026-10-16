/**
 * تست E2E مرورگر — «تقویم آموزشی کلاسی» (درخواست کاربر):
 *  ۱) تقویم جلالی کاملاً ایرانی، کلاس‌محور (هر کلاس تقویم جداگانه)
 *  ۲) دو نمای سوئیچ‌شدنی: شبکه‌ای (روزهای رویداددار با رنگ مجزا، گذشته هم قابل مشاهده)
 *     و لیستی (تک‌ستونه، از امروز به بعد، امروز در صدر، پیش‌نمایش آیکونی رویدادها)
 *  ۳) ۸ نوع رویداد با آیکون و رنگ سفارشی؛ ثبت با توضیحات توسط معلم/مدیر؛ دانش‌آموز فقط مشاهده
 *  ۴) مجوزها: معلم فقط کلاس خودش؛ مدیر کلاس یا کل مدرسه؛ تعطیل فقط مدیر؛ حذف
 *
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-class-calendar.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const jalaali = require('/home/z/my-project/node_modules/jalaali-js')

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const ADMIN = { username: 'beheshti.admin', password: 'Pass@123' }
const TEACHER = { username: 'beheshti.t1', password: 'Pass@123' }
const STUDENT = { username: 'beheshti.s1', password: 'Pass@123' }
const FARZ_ADMIN = { username: 'farzanegan.admin', password: 'Pass@123' }
const FARZ_NAHOM1_ID = 'cmv1aryrh001tlokrwo9kd4q9' // کلاس مدرسه دیگر (برای تست دسترسی بین‌مدرسه‌ای)

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
// سه روز آینده داخل همین ماه برای تست (در صورت نزدیکی انتهای ماه، جابه‌جا)
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

async function pickSelect(page, ariaLabel, optionText) {
  const trigger = page.getByRole('combobox', { name: ariaLabel })
  await trigger.waitFor({ state: 'visible', timeout: 10000 })
  await trigger.click()
  const option = page.getByRole('option', { name: optionText, exact: true }).first()
  await option.waitFor({ state: 'visible', timeout: 5000 })
  await option.click()
}

async function expectToast(page, text, timeout = 7000) {
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

/** باز کردن دیالوگ روز از نمای شبکه‌ای/لیستی با کلیک روی سلول روز */
async function openDay(page, d) {
  await page.getByRole('button', { name: new RegExp(`^${dayLabel(d)}`) }).first().click()
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 7000 })
}

async function closeDialog(page) {
  // اول Escape؛ اگر باز ماند، دکمه بستن (X) — و مطمئن می‌شویم بسته شده است
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(350)
  const dlgContent = page.locator('[data-slot="dialog-content"]')
  if ((await dlgContent.count()) > 0) {
    const x = dlgContent.locator('[data-slot="dialog-close"]').first()
    if ((await x.count()) > 0) await x.click().catch(() => {})
  }
  await dlgContent.waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
  await sleep(250)
}

/** ثبت رویداد از فرم داخل دیالوگ */
async function createEventInDialog(page, { typeLabel, description, customTitle, schoolScope }) {
  await page.getByRole('button', { name: `نوع ${typeLabel}`, exact: true }).click()
  if (customTitle !== undefined) {
    await fillHydrated(page.locator('#custom-event-title'), customTitle)
  }
  if (description !== undefined) {
    await fillHydrated(page.locator('#event-description'), description)
  }
  if (schoolScope) {
    await page.getByRole('button', { name: 'کل مدرسه', exact: true }).click()
  }
  await page.getByRole('button', { name: 'ثبت رویداد', exact: true }).click()
}

const createdIds = [] // برای پاک‌سازی پایان تست
async function trackCreated(cookie, classroomId) {
  const { data } = await apiGet(cookie, `/api/calendar/events?classroomId=${classroomId}&from=${keyOf(T, 1)}&to=${keyOf(T, MONTH_LEN)}`)
  for (const e of data.events ?? []) if (!createdIds.includes(e.id)) createdIds.push(e.id)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (err) => pageErrors.push(String(err)))

try {
  /* ---------- ۰) آماده‌سازی ---------- */
  section('آماده‌سازی: ورود API + یافتن کلاس‌ها')
  const adminCookie = await apiLogin(ADMIN)
  const teacherCookie = await apiLogin(TEACHER)
  const studentCookie = await apiLogin(STUDENT)
  ok('ورود API مدیر/معلم/دانش‌آموز')

  const { data: adminClasses } = await apiGet(adminCookie, '/api/calendar/classes')
  const classes = adminClasses.classrooms ?? []
  const SEVENTH1 = classes.find((c) => c.name === 'هفتم۱')
  const SEVENTH703 = classes.find((c) => c.name === 'هفتم ۷۰۳')
  if (!SEVENTH1 || !SEVENTH703) throw new Error('کلاس‌های آزمایشی یافت نشدند: ' + JSON.stringify(classes.map((c) => c.name)))
  ok(`کلاس‌های مدیر: ${classes.map((c) => c.name).join('، ')}`)

  const { data: teacherClasses } = await apiGet(teacherCookie, '/api/calendar/classes')
  const tNames = (teacherClasses.classrooms ?? []).map((c) => c.name).sort().join('، ')
  tNames === 'هشتم۱، هفتم۱'
    ? ok('کلاس‌های معلم دقیقاً هفتم۱ و هشتم۱ است')
    : bad(`کلاس‌های معلم نادرست: ${tNames}`)

  const { data: studentClasses } = await apiGet(studentCookie, '/api/calendar/classes')
  const sNames = (studentClasses.classrooms ?? []).map((c) => c.name).join('، ')
  sNames === 'هفتم۱'
    ? ok('کلاس دانش‌آموز فقط هفتم۱ است')
    : bad(`کلاس‌های دانش‌آموز نادرست: ${sNames}`)

  /* ---------- ۱) ورود UI مدیر → تقویم آموزشی ---------- */
  section('ورود مدیر مدرسه و صفحه تقویم')
  await uiLogin(page, ADMIN)
  ok('ورود UI مدیر')
  const navLink = page.locator('aside').getByText('تقویم آموزشی')
  ;(await navLink.count()) > 0 ? ok('آیتم منوی «تقویم آموزشی» در سایدبار هست') : bad('آیتم منوی تقویم آموزشی نیست')
  await page.goto(`${BASE}/calendar`)
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  ok('صفحه /calendar بارگذاری شد')
  await pickSelect(page, 'انتخاب کلاس تقویم', 'هفتم۱')
  ok('کلاس «هفتم۱» انتخاب شد')
  await sleep(800)
  await shot(page, 'calendar-admin-grid')

  // نمای شبکه‌ای پیش‌فرض: عنوان ماه جلالی جاری + امروز
  const monthTitle = await page.locator('div').filter({ hasText: new RegExp(`^${MONTH_NAME} ${faNum(T.jy)}$`) }).count()
  monthTitle > 0 ? ok(`عنوان ماه جلالی: «${MONTH_NAME} ${faNum(T.jy)}»`) : bad('عنوان ماه جلالی پیدا نشد')
  await page.getByRole('button', { name: new RegExp(`^${dayLabel(T.jd)}`) }).first().waitFor({ timeout: 7000 })
  ok(`سلول امروز (${faNum(T.jd)} ${MONTH_NAME}) در شبکه هست`)

  // سوییچ‌های نمای شبکه‌ای/لیستی
  ;(await page.getByRole('button', { name: 'نمای شبکه‌ای', pressed: true }).count()) === 1
    ? ok('نمای پیش‌فرض «شبکه‌ای» فعال است')
    : bad('نمای پیش‌فرض شبکه‌ای نیست')

  /* ---------- ۲) ثبت رویدادها توسط مدیر (دیالوگ روز) ---------- */
  section('ثبت رویداد توسط مدیر — امتحان، تکلیف، سفارشی، تعطیل کل مدرسه')

  // ۲-۱) امتحان روی امروز
  await openDay(page, T.jd)
  const dlg = page.getByRole('dialog')
  ;(await dlg.locator('[aria-label="نوع تعطیل"]').count()) === 1
    ? ok('مدیر: چیپ «تعطیل» در فرم هست (۸ نوع)')
    : bad('مدیر: چیپ «تعطیل» در فرم نیست')
  ;(await dlg.getByRole('button', { name: /^نوع / }).count()) === 8
    ? ok('مدیر: ۸ نوع رویداد در فرم نمایش داده می‌شود')
    : bad('مدیر: تعداد انواع رویداد ۸ نیست')
  ;(await dlg.getByRole('button', { name: 'کل مدرسه', exact: true }).count()) === 1
    ? ok('مدیر: انتخاب دامنه (کلاس/کل مدرسه) هست')
    : bad('مدیر: انتخاب دامنه نیست')
  await shot(page, 'calendar-day-dialog-admin')
  await createEventInDialog(page, { typeLabel: 'امتحان', description: 'امتحان ریاضی فصل ۲ — ساعت ۸ صبح' })
  await expectToast(page, 'ثبت شد')
  await dlg.getByText('امتحان').first().waitFor({ timeout: 7000 })
  await dlg.getByText('ثبت‌کننده: محمد کریمی').waitFor({ timeout: 5000 })
  ok('رویداد امتحان در دیالوگ با ثبت‌کننده نمایش داده شد')
  await closeDialog(page)

  // رنگ مجزای روز رویداددار در شبکه
  const todayCell = page.getByRole('button', { name: new RegExp(`^${dayLabel(T.jd)} — دارای رویداد`) }).first()
  ;(await todayCell.count()) === 1 ? ok('امروز در شبکه «دارای رویداد» شد') : bad('برچسب دارای رویداد روی امروز نیست')
  const cellClass = (await todayCell.getAttribute('class')) ?? ''
  cellClass.includes('amber')
    ? ok('روز رویداددار با رنگ کهربایی مجزا مشخص شده')
    : bad(`رنگ مجزا روی روز رویداددار نیست: ${cellClass.slice(0, 80)}`)
  ;(await todayCell.locator('span.rounded-full').count()) >= 1
    ? ok('نقطه رنگی رویداد داخل سلول شبکه هست')
    : bad('نقطه رنگی رویداد در سلول نیست')

  // ۲-۲) تکلیف روی D1
  await openDay(page, D1)
  await createEventInDialog(page, { typeLabel: 'تکلیف', description: 'حل تمرین‌های فصل ۲ ریاضی' })
  await expectToast(page, 'ثبت شد')
  await closeDialog(page)
  ok(`تکلیف برای ${faNum(D1)} ${MONTH_NAME} ثبت شد`)

  // ۲-۳) رویداد سفارشی روی D2
  await openDay(page, D2)
  await createEventInDialog(page, { typeLabel: 'رویداد سفارشی', customTitle: 'جشن زنجیر معرفت', description: 'با حضور اولیا' })
  await expectToast(page, 'ثبت شد')
  await dlg.getByText('جشن زنجیر معرفت').first().waitFor({ timeout: 5000 })
  ok('رویداد سفارشی با نام «جشن زنجیر معرفت» ثبت و نمایش داده شد')
  await closeDialog(page)

  // ۲-۴) تعطیل «کل مدرسه» روی D3
  await openDay(page, D3)
  await createEventInDialog(page, { typeLabel: 'تعطیل', description: 'مناسبت ملی', schoolScope: true })
  await expectToast(page, 'ثبت شد')
  await dlg.getByText('کل مدرسه').first().waitFor({ timeout: 5000 })
  ok('رویداد تعطیل با دامنه «کل مدرسه» ثبت شد (نشان «کل مدرسه» دیده شد)')
  await closeDialog(page)
  await trackCreated(adminCookie, SEVENTH1.id)

  /* ---------- ۳) نمای لیستی مدیر ---------- */
  section('نمای لیستی — امروز در صدر، بدون روزهای گذشته، پیش‌نمایش آیکونی')
  await page.getByRole('button', { name: 'نمای لیستی' }).click()
  await page.locator('[aria-label="فهرست روزهای تقویم"]').waitFor({ timeout: 7000 })
  const rows = page.locator('[aria-label^="روز "]')
  const rowCount = await rows.count()
  const expectedRows = MONTH_LEN - T.jd + 1
  rowCount === expectedRows
    ? ok(`تعداد ردیف‌ها ${faNum(rowCount)} = از امروز تا پایان ماه (بدون گذشته)`)
    : bad(`تعداد ردیف‌ها ${rowCount} ≠ ${expectedRows}`)
  const firstRow = rows.first()
  ;(await firstRow.getByText('امروز', { exact: true }).count()) === 1
    ? ok('«امروز» با نشان مخصوص در صدر لیست است')
    : bad('نشان «امروز» در صدر لیست نیست')
  const firstRowText = (await firstRow.textContent()) ?? ''
  firstRowText.includes('امتحان')
    ? ok('پیش‌نمایش متنی رویداد امروز (امتحان) در ردیف هست')
    : bad('پیش‌نمایش رویداد امروز در ردیف اول نیست')
  ;(await firstRow.locator('span[title="امتحان"]').count()) === 1
    ? ok('آیکون سفارشی امتحان در پیش‌نمایش آیکونی روز هست')
    : bad('آیکون سفارشی امتحان در ردیف امروز نیست')
  const d1Row = page.getByRole('button', { name: new RegExp(`^${dayLabel(D1)} — دارای رویداد`) }).first()
  ;(await d1Row.locator('span[title="تکلیف"]').count()) === 1
    ? ok(`آیکون تکلیف در ردیف ${faNum(D1)} هست`)
    : bad(`آیکون تکلیف در ردیف ${faNum(D1)} نیست`)
  await shot(page, 'calendar-admin-list')

  // کلیک ردیف لیستی → همان دیالوگ روز
  await d1Row.click()
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 7000 })
  ;(await page.getByRole('dialog').getByText('حل تمرین‌های فصل ۲ ریاضی').count()) === 1
    ? ok('کلیک روی ردیف لیستی، دیالوگ روز با توضیحات رویداد را باز کرد')
    : bad('توضیحات رویداد در دیالوگ بازشده از لیست نیست')
  await closeDialog(page)

  /* ---------- ۴) نمای شبکه‌ای: ماه‌های گذشته قابل مشاهده ---------- */
  section('نمای شبکه‌ای — ناوبری به ماه گذشته مجاز است')
  await page.getByRole('button', { name: 'نمای شبکه‌ای' }).click()
  await page.getByRole('button', { name: 'ماه قبل' }).click()
  await sleep(500)
  const prevMonthIdx = T.jm === 1 ? 11 : T.jm - 2
  const prevYear = T.jm === 1 ? T.jy - 1 : T.jy
  const prevTitle = `${MONTHS[prevMonthIdx]} ${faNum(prevYear)}`
  ;(await page.getByText(prevTitle, { exact: true }).count()) >= 1
    ? ok(`ناوبری به ماه گذشته: «${prevTitle}»`)
    : bad(`عنوان ماه قبل («${prevTitle}») پیدا نشد`)
  // کلیک روی یک روز ماه گذشته (روز ۱۰)
  await page.getByRole('button', { name: new RegExp(`^روز ${faNum(10)} ${MONTHS[prevMonthIdx]}$`) }).first().click()
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 7000 })
  ;(await page.getByRole('dialog').getByText('رویدادی برای این روز ثبت نشده است').count()) === 1
    ? ok('روز ماه گذشته قابل کلیک است (مشاهده دیالوگ)')
    : bad('دیالوگ روز ماه گذشته باز نشد')
  await closeDialog(page)
  await page.getByRole('button', { name: 'ماه بعد' }).click() // بازگشت به ماه جاری
  await sleep(400)

  /* ---------- ۵) نقطه ورود «تقویم آموزشی» در جزئیات کلاس ---------- */
  section('دکمه «تقویم آموزشی» در جزئیات کلاس مدیر')
  await page.goto(`${BASE}/modir/classes/${SEVENTH1.id}`)
  const calBtn = page.locator('a[aria-label="تقویم آموزشی کلاس"]')
  await calBtn.waitFor({ state: 'visible', timeout: 15000 })
  ok('دکمه «تقویم آموزشی» در هدر جزئیات کلاس هست')
  await calBtn.click()
  await page.waitForURL((u) => u.pathname === '/calendar' && (u.search ?? '').includes('class='), { timeout: 15000 })
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  await sleep(800)
  ;(await page.locator('[aria-label="انتخاب کلاس تقویم"]', { hasText: 'هفتم۱' }).count()) === 1
    ? ok('پس از کلیک، تقویم همان کلاس (هفتم۱) از پیش انتخاب شده است')
    : bad('کلاس انتخابی از پارامتر ?class= اعمال نشد')

  /* ---------- ۶) اعتبارسنجی API مدیر ---------- */
  section('اعتبارسنجی API (مدیر)')
  let r = await apiPost(adminCookie, '/api/calendar/events', { classroomId: SEVENTH1.id, type: 'EXAM' })
  r.status === 400 ? ok('بدون تاریخ → ۴۰۰') : bad(`بدون تاریخ → ${r.status}`)
  r = await apiPost(adminCookie, '/api/calendar/events', { classroomId: SEVENTH1.id, dateKey: keyOf(T, D1), type: 'CUSTOM' })
  r.status === 400 ? ok('سفارشی بدون نام → ۴۰۰') : bad(`سفارشی بدون نام → ${r.status}`)
  r = await apiPost(adminCookie, '/api/calendar/events', { classroomId: SEVENTH1.id, dateKey: keyOf(T, D1), type: 'WEDDING' })
  r.status === 400 ? ok('نوع نامعتبر → ۴۰۰') : bad(`نوع نامعتبر → ${r.status}`)

  /* ---------- ۷) معلم ---------- */
  section('معلم — کلاس خودش، بدون تعطیل، بدون دامنه کل مدرسه')
  await uiLogin(page, TEACHER)
  await page.goto(`${BASE}/calendar`)
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  await pickSelect(page, 'انتخاب کلاس تقویم', 'هفتم۱')
  await sleep(800)
  await openDay(page, D1)
  const tDlg = page.getByRole('dialog')
  ;(await tDlg.getByText('رویدادهای ثبت‌شده توسط معلم و مدیر مدرسه').count()) === 0
    ? ok('معلم: حالت مشاهده‌محور (عنوان ثبت) دیده می‌شود')
    : bad('معلم: توضیح دیالوگ نادرست')
  ;(await tDlg.getByRole('button', { name: /^نوع / }).count()) === 7
    ? ok('معلم: ۷ نوع رویداد (بدون تعطیل)')
    : bad(`معلم: تعداد انواع نادرست (${await tDlg.getByRole('button', { name: /^نوع / }).count()})`)
  ;(await tDlg.locator('[aria-label="نوع تعطیل"]').count()) === 0
    ? ok('معلم: چیپ «تعطیل» مخفی است')
    : bad('معلم: چیپ «تعطیل» دیده می‌شود!')
  ;(await tDlg.getByRole('button', { name: 'کل مدرسه', exact: true }).count()) === 0
    ? ok('معلم: انتخاب دامنه «کل مدرسه» ندارد')
    : bad('معلم: دامنه «کل مدرسه» دیده می‌شود!')
  // رویداد مدیر (امتحان امروز/تکلیف D1) برای معلم قابل مشاهده است
  ;(await tDlg.getByText('حل تمرین‌های فصل ۲ ریاضی').count()) === 1
    ? ok('معلم: رویداد ثبت‌شده مدیر (تکلیف) را می‌بیند')
    : bad('معلم: رویداد مدیر دیده نمی‌شود')
  // رویداد تعطیل کل‌مدرسه‌ای مدیر روی D3 — قابل مشاهده ولی بدون دکمه حذف
  await closeDialog(page)
  await openDay(page, D3)
  ;(await tDlg.getByText('تعطیل').first().count()) === 1
    ? ok('معلم: رویداد «تعطیل» مدیر را می‌بیند')
    : bad('معلم: رویداد تعطیل دیده نمی‌شود')
  ;(await tDlg.locator('[aria-label^="حذف رویداد تعطیل"]').count()) === 0
    ? ok('معلم: دکمه حذف رویداد مدیر را ندارد')
    : bad('معلم: دکمه حذف رویداد مدیر دیده می‌شود!')

  // ثبت مسابقه ورزشی توسط معلم — در دیالوگ D1 (کلاس هفتم۱)
  await closeDialog(page)
  await openDay(page, D1)
  await createEventInDialog(page, { typeLabel: 'مسابقه ورزشی', description: 'مسابقه فوتبال کلاسی — زنگ ورزش' })
  await expectToast(page, 'ثبت شد')
  await closeDialog(page)
  ok('معلم: رویداد «مسابقه ورزشی» ثبت شد')
  await trackCreated(teacherCookie, SEVENTH1.id)
  await shot(page, 'calendar-teacher-dialog')

  /* ---------- ۸) مجوزهای منفی API معلم ---------- */
  section('مجوزهای منفی (معلم)')
  r = await apiPost(teacherCookie, '/api/calendar/events', { classroomId: SEVENTH1.id, dateKey: keyOf(T, D1), type: 'HOLIDAY', description: 'x' })
  r.status === 403 ? ok('تعطیل توسط معلم → ۴۰۳') : bad(`تعطیل توسط معلم → ${r.status}`)
  r = await apiPost(teacherCookie, '/api/calendar/events', { classroomId: SEVENTH703.id, dateKey: keyOf(T, D1), type: 'EXAM' })
  r.status === 403 ? ok('کلاس غیرمنتسب (هفتم ۷۰۳) → ۴۰۳') : bad(`کلاس غیرمنتسب → ${r.status}`)
  r = await apiPost(teacherCookie, '/api/calendar/events', { classroomId: SEVENTH1.id, dateKey: keyOf(T, D1), type: 'EXAM', scope: 'SCHOOL' })
  r.status === 403 ? ok('دامنه «کل مدرسه» توسط معلم → ۴۰۳') : bad(`دامنه کل مدرسه توسط معلم → ${r.status}`)

  // حذف رویداد خودش توسط معلم (رویداد «اردو» موقت)
  let tmp = await apiPost(teacherCookie, '/api/calendar/events', { classroomId: SEVENTH1.id, dateKey: keyOf(T, D2), type: 'TRIP', description: 'اردوی موقت برای تست حذف' })
  if (tmp.status === 201) {
    ok('معلم: ثبت اردوی موقت (برای تست حذف)')
    const del = await apiDelete(teacherCookie, `/api/calendar/events/${tmp.data.event.id}`)
    del.status === 200 ? ok('معلم: حذف رویداد ثبت‌شده خودش → ۲۰۰') : bad(`حذف رویداد خودش → ${del.status}`)
  } else bad(`ثبت اردوی موقت → ${tmp.status}`)
  // حذف رویداد مدیر توسط معلم → ۴۰۳
  const { data: evsForDel } = await apiGet(teacherCookie, `/api/calendar/events?classroomId=${SEVENTH1.id}&from=${keyOf(T, T.jd)}&to=${keyOf(T, T.jd)}`)
  const adminExam = (evsForDel.events ?? []).find((e) => e.type === 'EXAM')
  if (adminExam) {
    r = await apiDelete(teacherCookie, `/api/calendar/events/${adminExam.id}`)
    r.status === 403 ? ok('حذف رویداد مدیر توسط معلم → ۴۰۳') : bad(`حذف رویداد مدیر توسط معلم → ${r.status}`)
  } else bad('رویداد امتحان مدیر برای تست حذف یافت نشد')

  /* ---------- ۹) دانش‌آموز ---------- */
  section('دانش‌آموز — فقط مشاهده')
  await uiLogin(page, STUDENT)
  await page.goto(`${BASE}/calendar`)
  await page.getByRole('heading', { name: 'تقویم آموزشی' }).waitFor({ timeout: 15000 })
  await sleep(800)
  ;(await page.getByText('کلاس «هفتم۱»').count()) >= 1
    ? ok('دانش‌آموز: کلاس خودش (هفتم۱) بدون انتخابگر نمایش داده شد')
    : bad('دانش‌آموز: کلاس پیش‌فرض نادرست')
  // لیستی: امروز در صدر، آیکون‌ها
  await page.getByRole('button', { name: 'نمای لیستی' }).click()
  await page.locator('[aria-label="فهرست روزهای تقویم"]').waitFor({ timeout: 7000 })
  const sRows = page.locator('[aria-label^="روز "]')
  const sCount = await sRows.count()
  sCount === expectedRows
    ? ok(`دانش‌آموز: ${faNum(sCount)} ردیف از امروز (بدون گذشته)`)
    : bad(`دانش‌آموز: تعداد ردیف‌ها ${sCount} ≠ ${expectedRows}`)
  ;(await sRows.first().locator('span[title="امتحان"]').count()) === 1
    ? ok('دانش‌آموز: آیکون امتحانِ امروز دیده می‌شود')
    : bad('دانش‌آموز: آیکون امتحان در ردیف امروز نیست')
  await shot(page, 'calendar-student-list')
  // دیالوگ روز: فقط مشاهده
  await sRows.first().click()
  const sDlg = page.getByRole('dialog')
  await sDlg.waitFor({ state: 'visible', timeout: 7000 })
  ;(await sDlg.getByText('امتحان ریاضی فصل ۲ — ساعت ۸ صبح').count()) === 1
    ? ok('دانش‌آموز: توضیحات رویداد (ثبت‌شده مدیر) را می‌بیند')
    : bad('دانش‌آموز: توضیحات رویداد دیده نمی‌شود')
  ;(await sDlg.getByText('ثبت رویداد جدید').count()) === 0
    ? ok('دانش‌آموز: فرم ثبت رویداد ندارد')
    : bad('دانش‌آموز: فرم ثبت رویداد دیده می‌شود!')
  ;(await sDlg.getByRole('button', { name: /^نوع / }).count()) === 0
    ? ok('دانش‌آموز: چیپ‌های نوع رویداد ندارد')
    : bad('دانش‌آموز: چیپ نوع رویداد دیده می‌شود!')
  ;(await sDlg.locator('[aria-label^="حذف رویداد"]').count()) === 0
    ? ok('دانش‌آموز: دکمه حذف ندارد')
    : bad('دانش‌آموز: دکمه حذف دیده می‌شود!')
  await closeDialog(page)
  // نمای شبکه‌ای: روزهای گذشته قابل مشاهده برای دانش‌آموز
  await page.getByRole('button', { name: 'نمای شبکه‌ای' }).click()
  await page.getByRole('button', { name: 'ماه قبل' }).click()
  await sleep(500)
  ;(await page.getByRole('button', { name: new RegExp(`^روز ${faNum(5)} ${MONTHS[prevMonthIdx]}$`) }).count()) === 1
    ? ok('دانش‌آموز: روزهای ماه گذشته در نمای شبکه‌ای قابل مشاهده است')
    : bad('دانش‌آموز: ماه گذشته در شبکه دیده نمی‌شود')
  await page.getByRole('button', { name: 'ماه بعد' }).click()
  await shot(page, 'calendar-student-grid')

  /* ---------- ۱۰) مجوزهای منفی API دانش‌آموز ---------- */
  section('مجوزهای منفی (دانش‌آموز)')
  r = await apiPost(studentCookie, '/api/calendar/events', { classroomId: SEVENTH1.id, dateKey: keyOf(T, D1), type: 'PARTY' })
  r.status === 403 ? ok('ثبت رویداد توسط دانش‌آموز → ۴۰۳') : bad(`ثبت توسط دانش‌آموز → ${r.status}`)
  if (adminExam) {
    r = await apiDelete(studentCookie, `/api/calendar/events/${adminExam.id}`)
    r.status === 403 ? ok('حذف رویداد توسط دانش‌آموز → ۴۰۳') : bad(`حذف توسط دانش‌آموز → ${r.status}`)
  }
  r = await apiGet(studentCookie, `/api/calendar/events?classroomId=${FARZ_NAHOM1_ID}&from=${keyOf(T, 1)}&to=${keyOf(T, MONTH_LEN)}`)
  r.status === 403 ? ok('تقویم کلاس مدرسه دیگر → ۴۰۳') : bad(`تقویم مدرسه دیگر → ${r.status}`)

  /* ---------- ۱۱) حذف رویداد معلم توسط مدیر + جداسازی دامنه تعطیل ---------- */
  section('حذف توسط مدیر + بررسی نمایش تعطیل در کلاس دیگر')
  const { data: sportsEvs } = await apiGet(adminCookie, `/api/calendar/events?classroomId=${SEVENTH1.id}&from=${keyOf(T, D1)}&to=${keyOf(T, D1)}`)
  const sports = (sportsEvs.events ?? []).find((e) => e.type === 'SPORTS')
  if (sports) {
    r = await apiDelete(adminCookie, `/api/calendar/events/${sports.id}`)
    r.status === 200 ? ok('مدیر: حذف رویداد ثبت‌شده معلم → ۲۰۰') : bad(`حذف رویداد معلم توسط مدیر → ${r.status}`)
  } else bad('رویداد مسابقه ورزشی معلم یافت نشد')
  // تعطیل کل‌مدرسه‌ای باید در تقویم کلاس دیگر هم دیده شود
  const { data: otherClassEvs } = await apiGet(adminCookie, `/api/calendar/events?classroomId=${SEVENTH703.id}&from=${keyOf(T, D3)}&to=${keyOf(T, D3)}`)
  ;(otherClassEvs.events ?? []).some((e) => e.type === 'HOLIDAY' && e.scope === 'SCHOOL')
    ? ok('رویداد «کل مدرسه» در تقویم کلاس دیگر هم دیده می‌شود')
    : bad('رویداد کل مدرسه در تقویم کلاس دیگر نیست')
  // اما رویداد کلاسی هفتم۱ نباید در هفتم ۷۰۳ باشد
  ;(otherClassEvs.events ?? []).every((e) => e.scope === 'SCHOOL')
    ? ok('رویداد کلاسی هفتم۱ به تقویم کلاس دیگر نشت نکرده است')
    : bad('نشت رویداد کلاسی به کلاس دیگر!')
  // مدیر مدرسه دیگر به تقویم بهشتی دسترسی ندارد
  const farzCookie = await apiLogin(FARZ_ADMIN)
  r = await apiGet(farzCookie, `/api/calendar/events?classroomId=${SEVENTH1.id}&from=${keyOf(T, 1)}&to=${keyOf(T, MONTH_LEN)}`)
  r.status === 403 ? ok('مدیر مدرسه دیگر → ۴۰۳') : bad(`مدیر مدرسه دیگر → ${r.status}`)

  await shot(page, 'calendar-final')
} catch (err) {
  bad(`خطای غیرمنتظره: ${err.message}`)
  try { await shot(page, 'calendar-crash') } catch {}
} finally {
  /* ---------- پاک‌سازی رویدادهای تست ---------- */
  try {
    const adminCookie2 = await apiLogin(ADMIN)
    let cleaned = 0
    for (const id of createdIds) {
      const d = await apiDelete(adminCookie2, `/api/calendar/events/${id}`)
      if (d.status === 200) cleaned++
    }
    console.log(`\n🧹 پاک‌سازی: ${cleaned}/${createdIds.length} رویداد تست حذف شد`)
  } catch (e) {
    console.log(`🧹 پاک‌سازی ناموفق: ${e.message}`)
  }
  await browser.close()
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
