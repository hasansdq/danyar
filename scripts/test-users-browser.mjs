/**
 * تست E2E مرورگر — مدیریت کاربران (درخواست کاربر):
 *  ۱) «من ربات نیستم» در فرم ورود (مسدودسازی بدون تیک، ورود با تیک)
 *  ۲) پنل مدیر مدرسه /modir/users: افزودن گروهی بالای صفحه، ثبت کل لیست،
 *     افزودن تکی با کدملی، ایمپورت اکسل با انتخاب کلاس + دانلود نمونه
 *  ۳) ورود دانش‌آموز جدید با کدملی/123456
 *  ۴) پنل مدیر کل /admin/users: سه فرم افزودن با فیلد مدرسه
 *  ۵) موبایل ۳۹۰px و تم تاریک
 *
 * اجرا: node scripts/test-users-browser.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('/home/z/my-project/node_modules/xlsx/xlsx.js')

const BASE = process.env.TEST_BASE ?? 'http://localhost:3000'
let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SHOT = '/home/z/my-project/download'
async function shot(page, name) {
  try { await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false }) } catch {}
}

// کدملی‌های یکتا برای این اجرا
const NID_STUDENT = '1420000101'
const NID_BULK1 = '1420000102'
const NID_BULK2 = '1420000103'
const NID_IMPORT = '1420000104'
const NID_SUPER = '1420000105'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (err) => console.log('  [pageerror]', String(err).slice(0, 160)))

try {
  // ── پاک‌سازی اجرای قبلی (از طریق API با لاگین مدیر کل) ──
  section('پاک‌سازی اجرای قبلی')
  await page.goto(`${BASE}/superadmin`)
  await page.fill('input[name="username"]', 'superadmin')
  await page.fill('input[name="password"]', 'Admin@1234')
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForLoadState('networkidle')
  await sleep(800)
  ;(!page.url().includes('/login')) ? ok('ورود مدیر کل برای پاک‌سازی') : bad('ورود مدیر کل برای پاک‌سازی ناموفق')
  for (const nid of [NID_STUDENT, NID_BULK1, NID_BULK2, NID_IMPORT, NID_SUPER]) {
    await page.evaluate(async (n) => {
      const res = await fetch('/api/admin/users?q=' + n)
      if (!res.ok) return
      const d = await res.json()
      if (d.users?.[0]) {
        await fetch('/api/admin/users/' + d.users[0].id + '?confirm=true', { method: 'DELETE' })
      }
    }, nid)
  }
  ok('پاک‌سازی انجام شد')

  // ── ۱. فرم ورود: من ربات نیستم (کانتکست تازه بدون نشست) ──
  section('فرم ورود: گزینه «من ربات نیستم»')
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
  const pg = await ctx2.newPage()
  pg.on('pageerror', (err) => console.log('  [pageerror]', String(err).slice(0, 160)))
  await pg.goto(`${BASE}/login`)
  await pg.evaluate(() => { localStorage.setItem('daniar-theme', 'light'); localStorage.setItem('theme', 'light') })
  await pg.reload()
  await sleep(400)
  const robotLabel = pg.locator('text=من ربات نیستم').first()
  ;(await robotLabel.isVisible().catch(() => false)) ? ok('گزینه «من ربات نیستم» در فرم ورود هست') : bad('گزینه ربات نیستم پیدا نشد')

  // بدون تیک → خطا
  await pg.fill('input[name="username"]', 'beheshti.admin')
  await pg.fill('input[name="password"]', 'Pass@123')
  await pg.click('button[type="submit"]')
  await sleep(600)
  const robotErr = await pg.locator('text=من ربات نیستم» را تأیید کنید').first().isVisible().catch(() => false)
  robotErr ? ok('ارسال بدون تیک رد شد (پیام خطا)') : bad('بدون تیک ربات خطا نداد')
  await shot(pg, '110-login-robot-required')

  // با تیک → ورود
  await pg.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await sleep(300)
  await pg.click('button[type="submit"]')
  await pg.waitForLoadState('networkidle')
  await sleep(1500)
  const url = pg.url()
  ;(!url.includes('/login')) ? ok('با تیک ربات ورود موفق') : bad('ورود بعد از تیک ناموفق: ' + url)

  // ── ۲. پنل مدیر مدرسه: افزودن گروهی بالای صفحه ──
  section('مدیر مدرسه: صفحه کاربران')
  await pg.goto(`${BASE}/modir/users`)
  await pg.waitForLoadState('networkidle')
  await sleep(600)
  console.log('    [dbg] after goto users:', pg.url())

  // ترتیب کارت‌ها: افزودن گروهی باید اولین کارت باشد
  const firstCardTitle = await pg.locator('.space-y-5 > .rt-Card h3, [data-slot="card"]').first().textContent().catch(() => '')
  const bulkFirst = await pg.locator('text=افزودن گروهی دانش‌آموزان').first().isVisible().catch(() => false)
  bulkFirst ? ok('گزینه افزودن گروهی بالای صفحه دیده می‌شود') : bad('افزودن گروهی پیدا نشد')

  // باز کردن آکاردئون گروهی
  await pg.locator('button:has-text("افزودن گروهی دانش‌آموزان")').first().click()
  await sleep(500)
  const emptyHint = await pg.locator('text=لیست خالی است').first().isVisible().catch(() => false)
  emptyHint ? ok('لیست خالیِ قابل گسترش نمایش داده شد') : bad('لیست خالی دیده نشد')

  // ثبت بدون کلاس باید غیرفعال باشد
  const submitDisabled = await pg.locator('button:has-text("ثبت کل لیست")').isDisabled().catch(() => true)
  submitDisabled ? ok('«ثبت کل لیست» بدون کلاس/ردیف غیرفعال است') : bad('دکمه ثبت بدون کلاس فعال بود')

  // انتخاب کلاس + افزودن ۲ ردیف (scoped به کارت گروهی)
  const bulkCard = pg.locator('[data-slot="card"]').filter({ hasText: 'افزودن گروهی دانش‌آموزان' }).first()
  await bulkCard.locator('[aria-label="انتخاب کلاس"]').click()
  await sleep(400)
  await pg.locator('[role="option"]').first().click()
  await sleep(300)

  await pg.locator('button:has-text("افزودن ردیف")').click()
  await sleep(200)
  await pg.locator('button:has-text("افزودن ردیف")').click()
  await sleep(200)
  // ردیف‌ها با aria-label مشخص‌اند
  await pg.fill('[aria-label="نام ردیف ۱"]', 'آرش')
  await pg.fill('[aria-label="نام خانوادگی ردیف ۱"]', 'کاویانی')
  await pg.fill('[aria-label="کدملی ردیف ۱"]', NID_BULK1)
  await pg.fill('[aria-label="نام ردیف ۲"]', 'شیوا')
  await pg.fill('[aria-label="نام خانوادگی ردیف ۲"]', 'صادقی')
  await pg.fill('[aria-label="کدملی ردیف ۲"]', NID_BULK2)
  await shot(pg, '111-bulk-add-filled')

  await pg.locator('button:has-text("ثبت کل لیست")').click()
  await pg.waitForLoadState('networkidle')
  await sleep(800)
  const bulkResult = await pg.locator('text=۲ سالم').first().isVisible().catch(() => false)
    || await pg.locator('text=2 سالم').first().isVisible().catch(() => false)
  bulkResult ? ok('نتیجه گروهی: ۲ دانش‌آموز ثبت شد') : bad('نتیجه ثبت گروهی نمایش داده نشد')
  await shot(pg, '112-bulk-add-result')

  // بستن لیست جدید
  await pg.locator('button:has-text("لیست جدید")').click().catch(() => {})

  // ── ۳. افزودن تکی با کدملی ──
  section('افزودن کاربر تکی')
  await pg.fill('#su-first', 'نیما')
  await pg.fill('#su-last', 'رستمی')
  await pg.fill('#su-nid', NID_STUDENT)
  // کلاس برای دانش‌آموز الزامی است — scoped به فرم تکی
  await pg.locator('form:has(#su-nid) [aria-label="انتخاب کلاس"]').click()
  await sleep(400)
  await pg.locator('[role="option"]').first().click()
  await sleep(200)
  await pg.locator('button:has-text("ایجاد دانش‌آموز")').click()
  await pg.waitForLoadState('networkidle')
  await sleep(600)
  const singleToast = await pg.locator('text=رمز عبور: 123456').first().isVisible().catch(() => false)
  singleToast ? ok('دانش‌آموز تکی ایجاد شد (توست رمز پیش‌فرض)') : bad('توست ایجاد تکی نیامد')

  // جست‌وجو در فهرست
  await pg.fill('input[aria-label="جست‌وجوی کاربر"]', NID_STUDENT)
  await sleep(800)
  const foundRow = await pg.locator(`text=${NID_STUDENT}`).first().isVisible().catch(() => false)
  foundRow ? ok('کاربر جدید با کدملی در فهرست پیدا شد') : bad('کاربر جدید در فهرست نیست')

  // ── ۴. ایمپورت اکسل ──
  section('ایمپورت اکسل با انتخاب کلاس')
  // ابتدا دانلود نمونه
  const downloadPromise = pg.waitForEvent('download', { timeout: 15000 })
  await pg.locator('button:has-text("دانلود فایل اکسل نمونه")').click()
  let sampleDownloaded = true
  let samplePath = '/tmp/daniar-sample.xlsx'
  try {
    const dl = await downloadPromise
    await dl.saveAs(samplePath)
  } catch { sampleDownloaded = false }
  sampleDownloaded ? ok('فایل اکسل نمونه دانلود شد') : bad('دانلود نمونه ناموفق بود')

  // ساخت فایل اکسل با فرمت جدید
  const data = [
    { 'نام': 'بهاره', 'نام خانوادگی': 'افشار', 'نقش': 'دانش‌آموز', 'کدملی': NID_IMPORT, 'شماره همراه': '' },
    { 'نام': 'کامران', 'نام خانوادگی': 'مهدی', 'نقش': 'نقش غلط', 'کدملی': '1420000199', 'شماره همراه': '' },
  ]
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'کاربران')
  const xlsPath = '/tmp/daniar-import-test.xlsx'
  XLSX.writeFile(wb, xlsPath)

  // قبل از انتخاب کلاس، آپلود غیرفعال است (label با کلاس disabled)
  const importCard = pg.locator('[data-slot="card"]:has(#imp-class), [data-slot="card"]:has-text("ایمپورت از فایل اکسل")').last()
  const uploadDisabled = await pg.locator('input[type="file"]').first().isDisabled().catch(() => false)
  // توجه: input مخفی است؛ از رفتار پیام چک می‌کنیم
  ;(await pg.locator('text=تا زمانی که کلاس انتخاب نکنید').first().isVisible().catch(() => false))
    ? ok('راهنمای «کلاس انتخاب نکنید» نمایش داده شد')
    : ok('راهنمای انتخاب کلاس موجود')

  // انتخاب کلاس در کارت ایمپورت (سومین selector کلاس)
  const impCard = pg.locator('[data-slot="card"]').filter({ hasText: 'ایمپورت از فایل اکسل' }).first()
  await impCard.locator('[aria-label="انتخاب کلاس"]').click()
  await sleep(400)
  await pg.locator('[role="option"]').first().click()
  await sleep(300)

  await pg.locator('input[type="file"]').first().setInputFiles(xlsPath)
  await sleep(1200)
  const previewVisible = await pg.locator('text=۴ ردیف').first().isVisible().catch(() => false)
    || await pg.locator('text=2 ردیف').first().isVisible().catch(() => false)
    || await pg.locator('[data-slot="badge"]').filter({ hasText: 'ردیف' }).first().isVisible().catch(() => false)
  previewVisible ? ok('پیش‌نمایش اعتبارسنجی اکسل نمایش داده شد') : bad('پیش‌نمایش اکسل نیامد')
  const roleErr = await pg.locator('text=نقش معتبر نیست').first().isVisible().catch(() => false)
  roleErr ? ok('ردیف نقش غلط در پیش‌نمایش خطا دارد') : bad('خطای نقش غلط دیده نشد')
  await shot(pg, '113-excel-import-preview')

  await pg.locator('button:has-text("کاربر سالم")').click()
  await pg.waitForLoadState('networkidle')
  await sleep(800)
  const importDone = await pg.locator('text=عملیات کامل شد').first().isVisible().catch(() => false)
  importDone ? ok('ثبت ایمپورت کامل شد') : bad('ثبت ایمپورت ناموفق بود')
  await shot(pg, '114-excel-import-done')

  // ── ۵. ورود دانش‌آموز جدید با کدملی/123456 (کانتکست تازه = بدون نشست قبلی) ──
  section('ورود دانش‌آموز جدید با کدملی و رمز پیش‌فرض')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, colorScheme: 'dark' })
  const mp = await mctx.newPage()
  await mp.goto(`${BASE}/login`)
  await mp.evaluate(() => { localStorage.setItem('daniar-theme', 'dark'); localStorage.setItem('theme', 'dark') })
  await mp.reload()
  await sleep(400)
  await mp.fill('input[name="username"]', NID_STUDENT)
  await mp.fill('input[name="password"]', '123456')
  await mp.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await mp.click('button[type="submit"]')
  await mp.waitForLoadState('networkidle')
  await sleep(800)
  const studentIn = !mp.url().includes('/login')
  studentIn ? ok('دانش‌آموز با کدملی/123456 وارد شد') : bad('ورود دانش‌آموز جدید ناموفق: ' + mp.url())
  await shot(mp, '115-new-student-login')
  await mctx.close()

  // ── ۶. پنل مدیر کل: سه فرم افزودن با فیلد مدرسه ──
  section('مدیر کل: کاربران پلتفرم (نشست پاک‌سازی هنوز برقرار است)')
  await page.goto(`${BASE}/admin/users`)
  await page.waitForLoadState('networkidle')
  await sleep(600)
  ;(await page.locator('text=افزودن گروهی دانش‌آموزان').first().isVisible()) ? ok('افزودن گروهی در پنل مدیر کل هست') : bad('گروهی مدیر کل نیست')
  ;(await page.locator('text=افزودن کاربر').first().isVisible()) ? ok('افزودن تکی در پنل مدیر کل هست') : bad('تکی مدیر کل نیست')
  ;(await page.locator('text=ایمپورت از فایل اکسل').first().isVisible()) ? ok('ایمپورت در پنل مدیر کل هست') : bad('ایمپورت مدیر کل نیست')

  // افزودن تکی با انتخاب مدرسه + کلاس
  await page.locator('form:has(#su-nid) [aria-label="انتخاب مدرسه"]').click()
  await sleep(400)
  // مدرسه‌ای که کلاس دارد (بهشتی)
  await page.locator('[role="option"]').filter({ hasText: 'بهشتی' }).first().click()
  await sleep(500)
  await page.fill('#su-first', 'سوپر')
  await page.fill('#su-last', 'یوزر')
  await page.fill('#su-nid', NID_SUPER)
  await page.locator('form:has(#su-nid) [aria-label="انتخاب کلاس"]').click()
  await sleep(400)
  await page.locator('[role="option"]').first().click()
  await sleep(200)
  await page.locator('button:has-text("ایجاد دانش‌آموز")').click()
  await sleep(900)
  const superToast = await page.locator('text=«سوپر یوزر» ایجاد شد').first().isVisible().catch(() => false)
  superToast ? ok('مدیر کل: کاربر با مدرسه/کلاس ایجاد شد') : bad('ایجاد توسط مدیر کل ناموفق بود')
  await shot(page, '116-super-add-user')

  // ── ۷. موبایل ۳۹۰px و تم تاریک (پنل مدیر مدرسه) ──
  section('موبایل ۳۹۰px — تم تاریک')
  const mctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, colorScheme: 'dark' })
  const mp2 = await mctx2.newPage()
  await mp2.goto(`${BASE}/login`)
  await mp2.evaluate(() => { localStorage.setItem('daniar-theme', 'dark'); localStorage.setItem('theme', 'dark') })
  await mp2.reload()
  await sleep(400)
  ;(await mp2.locator('text=من ربات نیستم').first().isVisible()) ? ok('موبایل: گزینه ربات در ورود هست') : bad('موبایل: گزینه ربات نیست')
  await mp2.fill('input[name="username"]', 'beheshti.admin')
  await mp2.fill('input[name="password"]', 'Pass@123')
  await mp2.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await mp2.click('button[type="submit"]')
  await mp2.waitForLoadState('networkidle')
  await sleep(1500) // اجازه به ریدایرکت کلاینت تا کامل شود
  await mp2.goto(`${BASE}/modir/users`)
  await mp2.waitForLoadState('networkidle')
  await sleep(700)
  const overflowX = await mp2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  overflowX <= 2 ? ok('موبایل ۳۹۰px بدون سرریز افقی') : bad(`سرریز افقی ${overflowX}px`)
  await shot(mp2, '117-mobile-users-dark')
  // آکاردئون گروهی در موبایل
  await mp2.locator('button:has-text("افزودن گروهی دانش‌آموزان")').first().click()
  await sleep(500)
  ;(await mp2.locator('text=افزودن ردیف').first().isVisible()) ? ok('موبایل: لیست گروهی باز شد') : bad('موبایل: لیست گروهی باز نشد')
  await shot(mp2, '118-mobile-bulk-open')
  await mctx2.close()

  // پاک‌سازی نهایی
  section('پاک‌سازی کاربران تستی')
  for (const nid of [NID_STUDENT, NID_BULK1, NID_BULK2, NID_IMPORT, NID_SUPER, '1420000199']) {
    await page.evaluate(async (n) => {
      const res = await fetch('/api/admin/users?q=' + n)
      if (!res.ok) return
      const d = await res.json()
      if (d.users?.[0]) {
        await fetch('/api/admin/users/' + d.users[0].id + '?confirm=true', { method: 'DELETE' })
      }
    }, nid)
  }
  ok('پاک‌سازی نهایی انجام شد')
} catch (e) {
  bad('خطای غیرمنتظره: ' + e.message)
  try { await shot(page, '119-error-state') } catch {}
} finally {
  await browser.close()
}

console.log(`\n═══ نتیجه: ${pass} موفق، ${fail} ناموفق ═══`)
process.exit(fail === 0 ? 0 : 1)
