/**
 * تست E2E مرورگر — پنل مدیریت مدرسه (درخواست کاربر):
 *  ۱) فرم دو فیلدی «ایجاد کلاس»: کشویی «انتخاب پایه» (۱۲ پایه اول تا دوازدهم) +
 *     متنی «انتخاب نام شعبه» (مثلاً ۷۰۳) → نام کلاس با الگوی «پایه + شعبه» در فهرست (مثلاً «هفتم ۷۰۳»)
 *  ۲) بخش جدید «ایجاد گروه درسی»: کشویی انتخاب کلاس + کشویی انتخاب نام درس (مثلاً ریاضی) + گزینه «سایر»
 *  ۳) جریان کامل: پیش‌نمایش زنده نام، ایجاد موفق، تکراری (۴۰۹)، جست‌وجو با ارقام لاتین،
 *     گروه درسی از کشویی درس و «سایر»، ماتریس اعتبارسنجی API
 *
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-class-group-forms.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const ADMIN = { username: 'beheshti.admin', password: 'Pass@123' }
const TEACHER = { username: 'beheshti.t1', password: 'Pass@123' }
const CLASS_NAME = 'هفتم ۷۰۳'
const GROUP1_NAME = 'ریاضی هفتم ۷۰۳'
const GROUP2_NAME = 'استعدادهای درخشان هفتم ۷۰۳'

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOT = '/home/z/my-project/download'
async function shot(page, name) {
  try { await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false }) } catch {}
}

/* ---------- کمکی‌های API (کوکی‌دار) ---------- */
async function apiLogin(user) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: user.password, realm: 'app' }),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';')[0]
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

/** انتخاب از Select شادکن با برچسب aria و متن گزینه */
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
    await page.locator('[role="status"]').filter({ hasText: text }).first().waitFor({ state: 'visible', timeout })
    ok(`توست: «${text}»`)
  } catch {
    bad(`توست «${text}» دیده نشد`)
  }
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (err) => pageErrors.push(String(err)))

try {
  /* ---------- ۰) آماده‌سازی: پاک‌سازی بقایای ران قبلی ---------- */
  section('آماده‌سازی: ورود API مدیر + پاک‌سازی ران قبلی')
  const adminCookie = await apiLogin(ADMIN)
  ok('ورود API مدیر مدرسه')
  const { data: list0 } = await apiGet(adminCookie, '/api/classes')
  const stale = (list0.classrooms ?? []).filter(
    (c) => c.name === CLASS_NAME || c.name === 'نهم ۲۰۵',
  )
  for (const c of stale) {
    const d = await apiDelete(adminCookie, `/api/classes/${c.id}`)
    d.status === 200 ? ok(`پاک‌سازی کلاس جامانده: ${c.name}`) : bad(`پاک‌سازی ${c.name} (${d.status})`)
  }
  if (stale.length === 0) ok('ران قبلی جامانده‌ای ندارد')

  /* ---------- ۱) ورود UI مدیر → مدیریت مدرسه ---------- */
  section('ورود مدیر مدرسه از /login')
  await page.goto(`${BASE}/login`)
  await fillHydrated(page.locator('#username'), ADMIN.username)
  await fillHydrated(page.locator('#password'), ADMIN.password)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 })
  ok('ورود موفق (خروج از صفحه ورود)')
  // مدیر پس از ورود به گفتگوها می‌رود — به پنل مدیریت مدرسه می‌رویم
  await page.goto(`${BASE}/modir/classes`)
  await page.waitForURL((u) => u.pathname.includes('/modir/classes'), { timeout: 15000 })
  ok('هدایت به مدیریت مدرسه (/modir/classes)')
  await page.waitForSelector('text=ایجاد کلاس جدید', { timeout: 15000 })

  /* ---------- ۲) فرم دو فیلدی ایجاد کلاس ---------- */
  section('فرم دو فیلدی «ایجاد کلاس»')
  const gradeTrigger = page.getByRole('combobox', { name: 'انتخاب پایه' })
  ;(await gradeTrigger.count()) > 0
    ? ok('کشویی «انتخاب پایه» هست')
    : bad('کشویی «انتخاب پایه» نیست')
  const branchInput = page.locator('#branch-input')
  ;(await branchInput.count()) > 0
    ? ok('فیلد متنی «انتخاب نام شعبه» هست')
    : bad('فیلد متنی «انتخاب نام شعبه» نیست')
  const branchPlaceholder = await branchInput.getAttribute('placeholder')
  branchPlaceholder === 'مثلاً ۷۰۳'
    ? ok('نمونهٔ شعبه «مثلاً ۷۰۳» در placeholder')
    : bad(`placeholder شعبه: ${branchPlaceholder}`)

  const createClassBtn = page.getByRole('button', { name: 'ایجاد کلاس', exact: true })
  ;(await createClassBtn.isDisabled())
    ? ok('دکمه ایجاد کلاس قبل از تکمیل فرم غیرفعال است')
    : bad('دکمه ایجاد کلاس بدون تکمیل فرم فعال است')

  // ۱۲ گزینه پایه به ترتیب
  await gradeTrigger.click()
  const optionNames = await page.getByRole('option').allTextContents()
  const expected = ['اول','دوم','سوم','چهارم','پنجم','ششم','هفتم','هشتم','نهم','دهم','یازدهم','دوازدهم']
  const trimmed = optionNames.map((o) => o.trim())
  trimmed.length === 12 && expected.every((g, i) => trimmed[i] === g)
    ? ok('کشویی پایه دقیقاً ۱۲ گزینه اول تا دوازدهم به ترتیب دارد')
    : bad(`گزینه‌های پایه نادرست: ${JSON.stringify(trimmed)}`)
  await page.getByRole('option', { name: 'هفتم', exact: true }).click()
  ok('پایه «هفتم» انتخاب شد')

  // دکمه هنوز غیرفعال تا شعبه پر شود
  ;(await createClassBtn.isDisabled())
    ? ok('دکمه ایجاد کلاس بدون شعبه هنوز غیرفعال است')
    : bad('دکمه ایجاد کلاس بدون شعبه فعال شد')

  // شعبه با ارقام لاتین — پیش‌نمایش فارسی
  await fillHydrated(branchInput, '703')
  const previewClass = page.locator('p', { hasText: 'نام کلاس:' })
  ;(await previewClass.textContent())?.includes('هفتم ۷۰۳')
    ? ok('پیش‌نمایش زنده نام کلاس: «هفتم ۷۰۳» (ارقام لاتین → فارسی)')
    : bad('پیش‌نمایش نام کلاس «هفتم ۷۰۳» نیست')
  ;(await createClassBtn.isEnabled())
    ? ok('دکمه ایجاد کلاس پس از تکمیل هر دو فیلد فعال شد')
    : bad('دکمه ایجاد کلاس پس از تکمیل فرم هنوز غیرفعال است')

  const postClass = page.waitForResponse(
    (r) => r.url().includes('/api/classes') && r.request().method() === 'POST' && r.status() === 201,
    { timeout: 15000 },
  )
  await createClassBtn.click()
  const resp = await postClass
  const created = (await resp.json())?.classroom?.name
  created === CLASS_NAME
    ? ok('POST /api/classes با {grade,branch} → نام ساخته‌شده «هفتم ۷۰۳»')
    : bad(`نام ساخته‌شده سرور: ${created}`)
  await expectToast(page, 'کلاس «هفتم ۷۰۳» ایجاد شد')
  await page.waitForSelector(`text=${CLASS_NAME}`, { timeout: 10000 })
  ok('کلاس «هفتم ۷۰۳» در فهرست کلاس‌ها با الگوی پایه+شعبه نمایش داده شد')
  await shot(page, '142-class-created-703')

  // فرم پس از ایجاد ریست شود
  ;(await gradeTrigger.textContent())?.includes('انتخاب پایه')
    ? ok('کشویی پایه پس از ایجاد ریست شد')
    : bad('کشویی پایه پس از ایجاد ریست نشد')

  /* ---------- ۳) تکراری → خطای ۴۰۹ ---------- */
  section('ایجاد تکراری «هفتم ۷۰۳» → خطا')
  await pickSelect(page, 'انتخاب پایه', 'هفتم')
  await fillHydrated(branchInput, '۷۰۳')
  await createClassBtn.click()
  await expectToast(page, 'کلاسی با این نام در مدرسه شما وجود دارد')
  const dupCount = await page.locator('button', { hasText: CLASS_NAME }).count()
  dupCount <= 2 ? ok('فهرست هنوز یک «هفتم ۷۰۳» دارد (تکراری ساخته نشد)') : bad('کلاس تکراری ساخته شد؟')

  /* ---------- ۴) جست‌وجوی کلاس با ارقام لاتین ---------- */
  section('جست‌وجوی «703» کلاس «هفتم ۷۰۳» را می‌یابد')
  const searchInput = page.getByLabel('جست‌وجوی کلاس')
  await fillHydrated(searchInput, '703')
  await sleep(400)
  const visibleRows = await page.locator('button', { hasText: CLASS_NAME }).count()
  const otherRows = await page.locator('button', { hasText: 'هفتم۱' }).count()
  visibleRows > 0 && otherRows === 0
    ? ok('جست‌وجوی ارقام لاتین «703» → «هفتم ۷۰۳» (نرمال‌سازی ارقام کار می‌کند)')
    : bad(`جست‌وجو: ${CLASS_NAME}=${visibleRows}، هفتم۱=${otherRows}`)
  await fillHydrated(searchInput, '')
  await sleep(300)

  /* ---------- ۵) بخش ایجاد گروه درسی ---------- */
  section('بخش جدید «ایجاد گروه درسی»')
  const groupHeading = await page.getByText('ایجاد گروه درسی', { exact: true }).count()
  groupHeading > 0 ? ok('بخش «ایجاد گروه درسی» در پنل مدیریت مدرسه هست') : bad('بخش «ایجاد گروه درسی» نیست')
  const groupClassTrigger = page.getByRole('combobox', { name: 'انتخاب کلاس' })
  const subjectTrigger = page.getByRole('combobox', { name: 'انتخاب نام درس' })
  ;(await groupClassTrigger.count()) > 0 ? ok('کشویی «انتخاب کلاس» هست') : bad('کشویی «انتخاب کلاس» نیست')
  ;(await subjectTrigger.count()) > 0 ? ok('کشویی «انتخاب نام درس» هست') : bad('کشویی «انتخاب نام درس» نیست')

  const createGroupBtn = page.getByRole('button', { name: 'ایجاد گروه', exact: true })
  ;(await createGroupBtn.isDisabled())
    ? ok('دکمه ایجاد گروه قبل از انتخاب کلاس/درس غیرفعال است')
    : bad('دکمه ایجاد گروه بدون انتخاب فعال است')

  // فقط کلاس انتخاب شود → هنوز غیرفعال (درس لازم است)
  await pickSelect(page, 'انتخاب کلاس', CLASS_NAME)
  ok(`کلاس «${CLASS_NAME}» در کشویی گروه درسی انتخاب شد`)
  ;(await createGroupBtn.isDisabled())
    ? ok('دکمه ایجاد گروه بدون انتخاب درس هنوز غیرفعال است')
    : bad('دکمه ایجاد گروه بدون درس فعال شد')

  // درس ریاضی از کشویی
  await pickSelect(page, 'انتخاب نام درس', 'ریاضی')
  const previewGroup = page.locator('p', { hasText: 'نام گروه:' })
  ;(await previewGroup.textContent())?.includes(GROUP1_NAME)
    ? ok(`پیش‌نمایش زنده نام گروه: «${GROUP1_NAME}»`)
    : bad(`پیش‌نمایش نام گروه «${GROUP1_NAME}» نیست`)

  const postGroup = page.waitForResponse(
    (r) => r.url().includes('/api/groups') && r.request().method() === 'POST' && r.status() === 201,
    { timeout: 15000 },
  )
  await createGroupBtn.click()
  await postGroup
  await expectToast(page, `گروه «${GROUP1_NAME}» ایجاد شد`)
  ok(`گروه «${GROUP1_NAME}» با الگوی «درس + کلاس» ساخته شد`)

  // شمارنده گروه در فهرست کلاس‌ها (فیلتر روی ردیف فهرست — نه تریگر کشویی هم‌متن)
  await sleep(600)
  const classRow = page
    .locator('button', { hasText: CLASS_NAME })
    .filter({ hasText: 'گروه درسی' })
    .first()
  const rowText = await classRow.textContent()
  rowText?.includes('۱ گروه درسی')
    ? ok('بج فهرست کلاس‌ها: «۱ گروه درسی» برای «هفتم ۷۰۳»')
    : bad(`بج گروه‌های کلاس: ${rowText?.slice(0, 80)}`)
  await shot(page, '143-subject-group-created')

  /* ---------- ۶) درس دلخواه از «سایر» ---------- */
  section('گزینه «سایر (نام دلخواه)» برای درس')
  await pickSelect(page, 'انتخاب نام درس', 'سایر (نام دلخواه)')
  const customInput = page.locator('#custom-subject-input')
  ;(await customInput.count()) > 0
    ? ok('با انتخاب «سایر»، فیلد نام درس دلخواه ظاهر شد')
    : bad('فیلد نام درس دلخواه ظاهر نشد')
  await fillHydrated(customInput, 'استعدادهای درخشان')
  ;(await previewGroup.textContent())?.includes(GROUP2_NAME)
    ? ok(`پیش‌نمایش گروه دلخواه: «${GROUP2_NAME}»`)
    : bad(`پیش‌نمایش «${GROUP2_NAME}» نیست`)
  const postGroup2 = page.waitForResponse(
    (r) => r.url().includes('/api/groups') && r.request().method() === 'POST' && r.status() === 201,
    { timeout: 15000 },
  )
  await createGroupBtn.click()
  await postGroup2
  await expectToast(page, `گروه «${GROUP2_NAME}» ایجاد شد`)
  await sleep(500)
  const rowText2 = await page
    .locator('button', { hasText: CLASS_NAME })
    .filter({ hasText: 'گروه درسی' })
    .first()
    .textContent()
  rowText2?.includes('۲ گروه درسی')
    ? ok('بج فهرست: «۲ گروه درسی» پس از گروه دوم')
    : bad('بج «۲ گروه درسی» نیست')

  /* ---------- ۷) گروه تکراری ---------- */
  section('ایجاد گروه تکراری «ریاضی هفتم ۷۰۳» → خطا')
  await pickSelect(page, 'انتخاب نام درس', 'ریاضی')
  await createGroupBtn.click()
  await expectToast(page, 'گروهی با این نام در این کلاس وجود دارد')

  /* ---------- ۸) گروه ساخته‌شده در صفحه کلاس ---------- */
  section('گروه‌ها در صفحه مدیریت کلاس (/modir/classes/{id})')
  await page
    .locator('button', { hasText: CLASS_NAME })
    .filter({ hasText: 'گروه درسی' })
    .first()
    .click()
  await page.waitForURL((u) => /\/modir\/classes\/[a-z0-9]+/.test(u.pathname), { timeout: 10000 })
  await page.waitForSelector('text=گروه درسی', { timeout: 10000 })
  const g1 = await page.getByText(GROUP1_NAME).count()
  const g2 = await page.getByText(GROUP2_NAME).count()
  g1 > 0 && g2 > 0
    ? ok('هر دو گروه (ریاضی + درس دلخواه) در صفحه کلاس موجودند')
    : bad(`گروه‌ها در صفحه کلاس: ریاضی=${g1}، سایر=${g2}`)
  await shot(page, '144-class-detail-groups')
  await page.goBack()
  await page.waitForSelector('text=ایجاد کلاس جدید', { timeout: 10000 })

  /* ---------- ۹) ماتریس اعتبارسنجی API ---------- */
  section('ماتریس اعتبارسنجی API')
  const t1 = await apiPost(null, '/api/classes', { grade: 'هفتم', branch: '1' })
  t1.status === 401 ? ok('بدون نشست → ۴۰۱') : bad(`بدون نشست: ${t1.status}`)
  const teacherCookie = await apiLogin(TEACHER)
  const t2 = await apiPost(teacherCookie, '/api/classes', { grade: 'هفتم', branch: '1' })
  t2.status === 403 ? ok('معلم → ۴۰۳') : bad(`معلم: ${t2.status}`)
  const t3 = await apiPost(adminCookie, '/api/classes', { grade: 'سیزدهم', branch: '1' })
  t3.status === 400 ? ok('پایه نامعتبر («سیزدهم») → ۴۰۰') : bad(`پایه نامعتبر: ${t3.status}`)
  const t4 = await apiPost(adminCookie, '/api/classes', { grade: 'هفتم', branch: '   ' })
  t4.status === 400 ? ok('شعبه خالی → ۴۰۰') : bad(`شعبه خالی: ${t4.status}`)
  const t5 = await apiPost(adminCookie, '/api/classes', { grade: 'هفتم', branch: '۷۰۳' })
  t5.status === 409 ? ok('تکراری «هفتم ۷۰۳» (ارقام فارسی) → ۴۰۹') : bad(`تکراری: ${t5.status}`)
  const t6 = await apiPost(adminCookie, '/api/classes', { grade: 'نهم', branch: '205' })
  t6.status === 201 && t6.data?.classroom?.name === 'نهم ۲۰۵'
    ? ok('ایجاد «نهم ۲۰۵» (شعبه ۲۰۵ لاتین → فارسی) → ۲۰۱')
    : bad(`نهم ۲۰۵: ${t6.status} ${JSON.stringify(t6.data)}`)
  const t7 = await apiPost(teacherCookie, '/api/groups', { name: 'هک', classroomId: 'x' })
  t7.status === 403 ? ok('ایجاد گروه توسط معلم → ۴۰۳') : bad(`گروه معلم: ${t7.status}`)
  // پاک‌سازی کلاس موقت ماتریس
  const { data: list1 } = await apiGet(adminCookie, '/api/classes')
  const tmp = (list1.classrooms ?? []).find((c) => c.name === 'نهم ۲۰۵')
  if (tmp) {
    const d = await apiDelete(adminCookie, `/api/classes/${tmp.id}`)
    d.status === 200 ? ok('پاک‌سازی «نهم ۲۰۵»') : bad(`پاک‌سازی نهم ۲۰۵: ${d.status}`)
  }

  /* ---------- ۱۰) خطاهای صفحه ---------- */
  section('سلامت صفحه')
  pageErrors.length === 0
    ? ok('صفر خطای pageerror در کل جریان')
    : bad(`${pageErrors.length} خطای صفحه: ${pageErrors.slice(0, 3).join(' | ')}`)

  await shot(page, '145-final-panel')
} catch (err) {
  bad(`استثنای کلی: ${err.message}`)
  try { await shot(page, '145-error-state') } catch {}
} finally {
  await browser.close()
}

console.log(`\n═══ نتیجه: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
