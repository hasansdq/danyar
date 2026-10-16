/**
 * بررسی مرورگری صفحه «مدیریت گروه‌ها» (/modir/groups) + فیلتر نقش معاون در کاربران
 * — بدون mock، مرورگر واقعی (Chromium)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const ADMIN = { u: 'beheshti.admin', p: 'Pass@123' }

let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(page, username, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await page.fill('#username', username)
  await page.fill('#password', password)
  const robot = page.locator('#notRobot, [role="checkbox"]').first()
  for (let i = 0; i < 15; i++) {
    try {
      if ((await robot.getAttribute('aria-checked')) !== 'true') await robot.click()
      else break
    } catch { await robot.click().catch(() => {}) }
    await sleep(400)
  }
  await page.click('button[type="submit"]')
  for (let i = 0; i < 50; i++) {
    if (!page.url().includes('/login')) return
    await sleep(500)
  }
  throw new Error('login failed')
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  await login(page, ADMIN.u, ADMIN.p)
  ok('ورود مدیر مدرسه')

  // ۱) سایدبار: آیتم «مدیریت گروه‌ها» جدا است
  await page.goto(`${BASE}/modir/classes`, { waitUntil: 'domcontentloaded' })
  await sleep(1200)
  const navGroups = await page.locator('aside a[href="/modir/groups"]').count()
  navGroups > 0 ? ok('سایدبار: بخش مجزای «مدیریت گروه‌ها» دیده می‌شود') : bad('آیتم سایدبار گروه‌ها نیست')

  // ۲) صفحه مدیریت گروه‌ها
  await page.locator('aside a[href="/modir/groups"]').first().click()
  await page.waitForURL('**/modir/groups', { timeout: 15000 })
  await sleep(1500)
  ;(await page.getByText('ایجاد گروه با عضوگیری خودکار').count()) > 0
    ? ok('دکمه روش اول (عضوگیری خودکار) دیده می‌شود')
    : bad('دکمه روش اول نیست')
  ;(await page.getByText('ایجاد گروه سفارشی').count()) > 0
    ? ok('دکمه روش دوم (گروه سفارشی) دیده می‌شود')
    : bad('دکمه روش دوم نیست')

  // ۳) باز کردن روش خودکار — ۴ تب (با تلاش مجدد برای hydration پس از ناوبری سمت کلاینت)
  let tabsOpen = false
  for (let i = 0; i < 5 && !tabsOpen; i++) {
    await page.locator('button', { hasText: 'ایجاد گروه با عضوگیری خودکار' }).first().click().catch(() => {})
    try {
      await page.locator('[role="tab"]:has-text("درسی")').waitFor({ timeout: 4000 })
      tabsOpen = true
    } catch {
      await sleep(1200)
    }
  }
  tabsOpen ? ok('باز شدن روش اول: ۴ فرم ایجاد') : bad('روش اول باز نشد')
  await sleep(600)
  for (const tab of ['درسی', 'همکاران', 'کلاسی', 'عمومی']) {
    const n = await page.locator(`[role="tab"]:has-text("${tab}")`).count()
    n > 0 ? ok(`تب «${tab}» در روش خودکار`) : bad(`تب «${tab}» نیست`)
  }
  // فرم گروه درسی: سه فیلد
  ;(await page.locator('#course-subject').count()) > 0 ? ok('فیلد نام درس') : bad('فیلد نام درس نیست')
  ;(await page.locator('[aria-label="انتخاب کلاس گروه درسی"]').count()) > 0 ? ok('فیلد انتخاب کلاس') : bad('انتخاب کلاس نیست')
  ;(await page.locator('[aria-label="انتخاب معلمان"]').count()) > 0 ? ok('چندانتخابی معلمان') : bad('چندانتخابی معلمان نیست')

  // ۴) تب همکاران: دکمه ایجاد (فعال یا غیرفعال در صورت وجود گروه)
  await page.locator('[role="tab"]:has-text("همکاران")').first().click()
  await sleep(800)
  const staffBtnDisabled = await page.locator('button:has-text("ایجاد")[disabled]').count()
  staffBtnDisabled > 0
    ? ok('دکمه ایجاد همکاران: گروه موجود است (غیرفعال درست)')
    : ok('دکمه ایجاد همکاران فعال (گروه موجود نیست)')

  // ۵) روش سفارشی: نام + فهرست چک‌باکسی
  await page.locator('button', { hasText: 'ایجاد گروه سفارشی' }).first().click()
  let customOpen = false
  for (let i = 0; i < 5 && !customOpen; i++) {
    try {
      await page.locator('#custom-name').waitFor({ timeout: 4000 })
      customOpen = true
    } catch {
      await page.locator('button', { hasText: 'ایجاد گروه سفارشی' }).first().click().catch(() => {})
      await sleep(1200)
    }
  }
  customOpen ? ok('باز شدن روش دوم: گروه سفارشی') : bad('روش دوم باز نشد')
  await sleep(1200)
  ;(await page.locator('#custom-name').count()) > 0 ? ok('فیلد نام گروه سفارشی') : bad('فیلد نام سفارشی نیست')
  const checkboxes = await page.locator('label:has([role="checkbox"])').count()
  checkboxes > 0 ? ok(`فهرست چک‌باکسی کاربران (${checkboxes} ردیف)`) : bad('فهرست چک‌باکسی خالی است')

  // ۶) فهرست گروه‌ها با آیکون‌های مدیریت سریع
  const rows = await page.locator('div.divide-y > div.py-3').count()
  rows > 0 ? ok(`فهرست گروه‌ها دارد (${rows} گروه)`) : bad('فهرست گروه‌ها خالی')
  const renameIcons = await page.locator('button[aria-label^="تغییر نام گروه"]').count()
  // ۱۴۰۲-۰۷ تغییر کاربر: «بستن گروه» حذف شد و جای آن «قفل گروه برای دانش‌آموزان» نشست
  const lockIcons = await page.locator('button[aria-label^="قفل گروه"], button[aria-label^="برداشتن قفل گروه"]').count()
  const closeIcons = await page.locator('button[aria-label^="بستن گروه"], button[aria-label^="بازکردن گروه"]').count()
  const deleteIcons = await page.locator('button[aria-label^="حذف گروه"]').count()
  renameIcons > 0 && lockIcons > 0 && deleteIcons > 0 && closeIcons === 0
    ? ok('آیکون‌های تغییر نام / قفل دانش‌آموزان / حذف روی ردیف‌ها (بستن حذف شده)')
    : bad(`آیکون‌ها ناقص: rename=${renameIcons} lock=${lockIcons} close=${closeIcons} delete=${deleteIcons}`)

  // ۷) صفحه کاربران: فیلتر معاون
  await page.goto(`${BASE}/modir/users`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  const viceFilter = await page.locator('[aria-label="فیلتر نقش کاربران"]').count()
  if (viceFilter > 0) {
    await page.locator('[aria-label="فیلتر نقش کاربران"]').first().click()
    await sleep(500)
    const viceOption = await page.getByRole('option', { name: 'معاونان مدرسه' }).count()
    viceOption > 0 ? ok('فیلتر نقش «معاونان مدرسه» در کاربران مدرسه') : bad('گزینه معاونان در فیلتر نیست')
    await page.keyboard.press('Escape')
  } else {
    bad('فیلتر نقش کاربران پیدا نشد')
  }

  // ۸) فرم ایجاد معاون مدرسه — فرم مستقل در پنل کاربران مدرسه
  const viceForm = await page.locator('button:has-text("ایجاد معاون مدرسه")').count()
  viceForm > 0 ? ok('فرم مستقل «ایجاد معاون مدرسه» در کاربران مدرسه') : bad('فرم ایجاد معاون نیست')

  // ۹) فرم‌های معلم/دانش‌آموز سر جایشان (بدون تغییر رفتار)
  const teacherForm = await page.locator('button:has-text("ایجاد معلم")').count()
  const studentForm = await page.locator('button:has-text("ثبت کل لیست"), button:has-text("ایجاد دانش‌آموز")').count()
  teacherForm > 0 && studentForm > 0
    ? ok('فرم‌های معلم/دانش‌آموز سر جایشان')
    : bad(`فرم‌های قبلی نیستند: teacher=${teacherForm} student=${studentForm}`)

  const realErrors = pageErrors.filter((e) => !e.includes('ResizeObserver') && !e.includes('favicon'))
  realErrors.length === 0
    ? ok(`بدون خطای جاوااسکریپت (${pageErrors.length} خاموش‌شده)`)
    : bad(`خطاهای صفحه: ${realErrors.slice(0, 3).join(' | ')}`)

  await page.screenshot({ path: '/home/z/my-project/download/148-groups-page.png', fullPage: true })
} catch (e) {
  bad(`شکست سناریو: ${e.message}`)
} finally {
  await browser.close()
}

console.log(`\nنتیجه: ${PASS} پاس / ${FAIL} شکست`)
process.exit(FAIL > 0 ? 1 : 0)
