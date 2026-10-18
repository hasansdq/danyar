/**
 * تست E2E مرورگر — راستی‌آزمایی دو تغییر UI:
 * ۱) نام بخش دانش‌آموز «حضور غیاب» → «گزارش کار» + آیکون ClipboardList (بدون تغییر محتوا)
 * ۲) تقویم آموزشی: حذف متن «تقویم جلالی کلاس — رویدادهای حال و آینده» + انتقال راهنمای آیکون‌ها به زیر باکس تقویم
 *
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-ui-rename-calendar.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOT = '/home/z/my-project/download'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))

async function login(username, password) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  // صبر تا ورود واقعی: صفحهٔ اپ (فهرست گفتگوها) یا پیام خطا
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45000 })
  await sleep(1200)
}

try {
  // ─────────────── ۱) بخش «گزارش کار» دانش‌آموز ───────────────
  section('ورود دانش‌آموز (beheshti.s1)')
  await login('beheshti.s1', 'Pass@123')
  ok('ورود موفق')

  section('صفحه «گزارش کار» (محتوای حضور و غیاب)')
  await page.goto(`${BASE}/attendance`)
  // صبر تا سرصفحهٔ صفحه (کامپایل سرد dev ممکن است طول بکشد)
  await page.locator('h1', { hasText: 'گزارش کار من' }).waitFor({ state: 'visible', timeout: 60000 })
  ok('سرصفحهٔ صفحه: «گزارش کار من»')
  ;(await page.locator('h1', { hasText: 'حضور و غیاب من' }).count()) === 0
    ? ok('سرصفحهٔ قدیمی «حضور و غیاب من» حذف شده')
    : bad('سرصفحهٔ قدیمی هنوز هست')

  // محتوا بدون تغییر: کارت‌های آمار + تقویم جلالی + لیست سوابق (پس از پایان لودینگ)
  const statsGrid = page.locator('.grid.grid-cols-2').first()
  await statsGrid.waitFor({ state: 'visible', timeout: 30000 })
  const statCards = await statsGrid.locator('> div').count()
  statCards >= 4 ? ok(`کارت‌های آمار محتوا سرجایشان هستند (${statCards})`) : bad('کارت‌های آمار ناپیدا شدند')
  const statsText = (await statsGrid.innerText().catch(() => '')) || ''
  statsText.includes('جلسات نهایی') ? ok('کارت «جلسات نهایی» (محتوا دست‌نخورده)') : bad('کارت جلسات نهایی غایب')
  statsText.includes('تخلفات ثبت‌شده') ? ok('کارت «تخلفات ثبت‌شده» (محتوا دست‌نخورده)') : bad('کارت تخلفات غایب')
  ;(await page.locator('text=سوابق نهایی‌شده حضور و تخلفات ثبت‌شدهٔ شما').count()) >= 1
    ? ok('زیرنویس توضیح محتوا بدون تغییر')
    : bad('زیرنویس توضیح تغییر کرده')
  // آیکون سرصفحه = ClipboardList (svg فرزند مستقیم هدر)
  const headerIconClass = await page
    .locator('.max-w-6xl > div > svg.lucide-clipboard-list')
    .first()
    .getAttribute('class')
    .catch(() => null)
  headerIconClass ? ok('آیکون سرصفحه ClipboardList رندر شد') : bad('آیکون سرصفحه ClipboardList نیست')
  await page.screenshot({ path: `${SHOT}/ui-report-card-student.png`, fullPage: false })

  // منوی سایدبار دسکتاپ
  section('منوی سایدبار دانش‌آموز')
  await page.goto(`${BASE}/`)
  await page.locator('nav[aria-label="منوی اصلی"]').waitFor({ state: 'visible', timeout: 30000 })
  const navReport = page.locator('nav[aria-label="منوی اصلی"] a', { hasText: 'گزارش کار' })
  await navReport.waitFor({ state: 'visible', timeout: 15000 })
  ;(await navReport.count()) === 1 ? ok('آیتم منو: «گزارش کار»') : bad('آیتم منو «گزارش کار» نیست')
  ;(await page.locator('nav[aria-label="منوی اصلی"] a', { hasText: 'حضور غیاب' }).count()) === 0
    ? ok('آیتم منوی قدیمی «حضور غیاب» حذف شد')
    : bad('آیتم منوی قدیمی هنوز هست')
  ;(await navReport.locator('svg').count()) === 1 ? ok('آیکون ClipboardList در آیتم منو') : bad('آیکون آیتم منو نیست')
  await navReport.click()
  await page.locator('h1', { hasText: 'گزارش کار من' }).waitFor({ state: 'visible', timeout: 30000 })
  page.url().includes('/attendance') ? ok('کلیک منو → /attendance') : bad(`کلیک منو به ${page.url()} رفت`)
  await page.screenshot({ path: `${SHOT}/ui-report-nav-click.png` })

  // ─────────────── ۲) تقویم آموزشی (همه نقش‌ها — اینجا دانش‌آموز) ───────────────
  section('تقویم آموزشی — دانش‌آموز')
  await page.goto(`${BASE}/calendar`)
  await page.locator('[aria-label="راهنمای انواع رویداد"]').waitFor({ state: 'visible', timeout: 60000 })
  await sleep(500)

  ;(await page.locator('text=تقویم جلالی کلاس').count()) === 0
    ? ok('متن «تقویم جلالی کلاس — رویدادهای حال و آینده» حذف شد')
    : bad('متن تقویم جلالی کلاس هنوز موجود است')
  ;(await page.locator('text=رویدادهای حال و آینده').count()) === 0
    ? ok('عبارت «رویدادهای حال و آینده» حذف شد')
    : bad('عبارت رویدادهای حال و آینده هنوز هست')
  ;(await page.locator('h1', { hasText: 'تقویم آموزشی' }).count()) === 1
    ? ok('سرصفحهٔ «تقویم آموزشی» باقی است')
    : bad('سرصفحهٔ تقویم آموزشی نیست')

  // جای راهنما: زیر باکس تقویم (نه بالای آن)
  const legend = page.locator('[aria-label="راهنمای انواع رویداد"]')
  const calBox = page.locator('div.rounded-xl.border.bg-card').first()
  if ((await legend.count()) === 1 && (await calBox.count()) >= 1) {
    const lb = await legend.boundingBox()
    const cb = await calBox.boundingBox()
    if (lb && cb) {
      lb.y > cb.y + cb.height - 5
        ? ok('راهنما زیر باکس تقویم قرار گرفت')
        : bad(`راهنما هنوز بالای/داخل باکس است (legend y=${Math.round(lb.y)} vs box bottom=${Math.round(cb.y + cb.height)})`)
    }
  }
  const legendText = (await legend.innerText().catch(() => '')) || ''
  const want = ['تعطیل', 'امتحان', 'تکلیف', 'جشن', 'مسابقه ورزشی', 'مسابقه علمی', 'اردو', 'رویداد سفارشی']
  const missing = want.filter((w) => !legendText.includes(w))
  missing.length === 0 ? ok('هر ۸ آیتم راهنما موجودند') : bad(`آیتم‌های غایب: ${missing.join('، ')}`)

  // نمای لیستی هم راهنما پایین بماند
  await page.locator('button[aria-label="نمای لیستی"]').click()
  await sleep(900)
  const lb2 = await page.locator('[aria-label="راهنمای انواع رویداد"]').boundingBox()
  const cb2 = await page.locator('div.rounded-xl.border.bg-card').first().boundingBox()
  if (lb2 && cb2) {
    lb2.y > cb2.y + cb2.height - 5 ? ok('در نمای لیستی هم راهنما زیر باکس است') : bad('نمای لیستی: راهنما زیر باکس نیست')
  }
  await page.screenshot({ path: `${SHOT}/ui-calendar-legend-below.png`, fullPage: true })

  // نقش دیگر: معلم — همان رفتار
  section('تقویم آموزشی — معلم (beheshti.t1)')
  await page.locator('button[aria-label="خروج از حساب"]').first().click()
  await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 20000 })
  await login('beheshti.t1', 'Pass@123')
  await page.goto(`${BASE}/calendar`)
  await page.locator('[aria-label="راهنمای انواع رویداد"]').waitFor({ state: 'visible', timeout: 60000 })
  await sleep(500)
  ;(await page.locator('text=تقویم جلالی کلاس').count()) === 0
    ? ok('معلم: متن حذف‌شده حذف است')
    : bad('معلم: متن هنوز هست')
  const lT = await page.locator('[aria-label="راهنمای انواع رویداد"]').boundingBox()
  const cT = await page.locator('div.rounded-xl.border.bg-card').first().boundingBox()
  if (lT && cT) {
    lT.y > cT.y + cT.height - 5 ? ok('معلم: راهنما زیر باکس تقویم') : bad('معلم: جای راهنما اشتباه')
  } else {
    bad('معلم: باکس تقویم یا راهنما پیدا نشد')
  }
  // معلم منو «گزارش کار» ندارد (فقط دانش‌آموز)
  ;(await page.locator('nav[aria-label="منوی اصلی"] a', { hasText: 'گزارش کار' }).count()) === 0
    ? ok('معلم: آیتم «گزارش کار» فقط برای دانش‌آموز است')
    : bad('معلم: آیتم گزارش کار نباید باشد')

  section('خطاهای صفحه')
  pageErrors.length === 0 ? ok('صفر خطای صفحه (pageerror)') : bad(`${pageErrors.length} خطا: ${pageErrors[0]}`)
} catch (e) {
  bad(`استثنا: ${String(e).slice(0, 300)}`)
  try { await page.screenshot({ path: `${SHOT}/ui-verify-fail.png` }) } catch {}
} finally {
  await browser.close()
}

console.log(`\n————————————\nنتیجه: ${pass} سبز / ${fail} قرمز`)
process.exit(fail > 0 ? 1 : 0)
