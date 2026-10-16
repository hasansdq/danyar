/**
 * E2E — کارت‌های آماری «مدیریت مدرسه»:
 *  ۱) هفت کارت آماری (۴ قبلی + اطلاعیه‌ها، کلاس‌های آنلاین، اعلان‌ها)
 *  ۲) انیمیشن شمارنده ۰ → عدد
 *  ۳) آیکون ورود به مدیریت روی هر کارت → مقصد درست
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-admin-stat-cards.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE || 'http://localhost:81'
const SHOT = '/home/z/my-project/download'
let pass = 0
let fail = 0
const results = []

function check(name, ok, extra = '') {
  if (ok) {
    pass++
    results.push(`  ✅ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    results.push(`  ❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

const step = (s) => console.log(`▶ ${s}`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.setDefaultTimeout(30000)

try {
  // ─── ورود مدیر مدرسه ───
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#username', { timeout: 60000 })
  await page.fill('#username', 'beheshti.admin')
  await page.fill('#password', 'Pass@123')
  // تیک «من ربات نیستم» — با تلاش مجدد تا hydrate کامل شود
  const robotBtn = page.locator('button[role="checkbox"][aria-label="من ربات نیستم"]')
  for (let i = 0; i < 12; i++) {
    await robotBtn.click().catch(() => {})
    if ((await robotBtn.getAttribute('aria-checked')) === 'true') break
    await page.waitForTimeout(400)
  }
  check('تیک «من ربات نیستم» زده شد', (await robotBtn.getAttribute('aria-checked')) === 'true')
  await page.click('button[type="submit"]')
  await page
    .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
    .catch(async () => {
      // اگر ریدایرکت نشد شاید خطای فرم باشد — اسکرین‌شات برای دیباگ
      await page.screenshot({ path: SHOT + '/admin-login-stuck.png', fullPage: true })
      throw new Error('ورود انجام نشد — URL: ' + page.url())
    })
  step('ورود موفق → ' + page.url())

  // ─── صفحه مدیریت مدرسه ───
  step('رفتن به /modir/classes')
  await page.goto(BASE + '/modir/classes', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1:has-text("مدیریت مدرسه")', { timeout: 60000 })

  // صبر تا بارگذاری آمار (کارت‌ها ظاهر شوند)
  await page.waitForSelector('button[aria-label="لیست کلاس‌ها و مدیریت آنها"]', { timeout: 30000 })
  step('کارت‌ها بارگذاری شدند')

  // ─── ۱) هفت کارت آماری ───
  const expected = [
    'کلاس‌ها',
    'گروه‌های درسی',
    'معلمان',
    'دانش‌آموزان',
    'اطلاعیه‌ها',
    'کلاس‌های آنلاین',
    'اعلان‌ها',
  ]
  for (const label of expected) {
    const found = await page
      .locator(`span.text-xs:has-text("${label}")`)
      .first()
      .isVisible()
      .catch(() => false)
    check(`کارت «${label}» نمایش داده می‌شود`, found)
  }

  const cardCount = await page
    .locator('button[aria-label="لیست کلاس‌ها و مدیریت آنها"], button[aria-label="لیست گروه‌های درسی و مدیریت آنها"], button[aria-label="لیست معلمان و مدیریت آنها"], button[aria-label="لیست دانش‌آموزان و مدیریت آنها"], button[aria-label="مدیریت اطلاعیه‌ها"], button[aria-label="مدیریت کلاس‌های آنلاین"], button[aria-label="مدیریت اعلان‌ها"]')
    .count()
  check('هر ۷ کارت آیکون ورود به مدیریت دارند', cardCount === 7, `تعداد=${cardCount}`)

  // ─── ۲) انیمیشن شمارنده: بلافاصله عدد از ۰ شروع می‌شود و به مقدار نهایی می‌رسد ───
  // کارت «کلاس‌های آنلاین» احتمالاً ۰ است؛ کارت «کلاس‌ها» را نمونه می‌گیریم
  const classesCard = page
    .locator('div.grid')
    .filter({ has: page.locator('span.text-xs:has-text("کلاس‌ها")') })
    .first()
  const numEl = classesCard.locator('span.text-2xl span').first()

  // بازخوانی صفحه تا لحظه شروع انیمیشن را بگیریم
  await page.goto(BASE + '/modir/classes', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('span.text-2xl span', { timeout: 30000 })
  step('شروع نمونه‌برداری انیمیشن شمارنده')

  const samples = []
  const finalText = await numEl.textContent()
  for (let i = 0; i < 14; i++) {
    const t = await numEl.textContent().catch(() => null)
    if (t !== null) samples.push(t)
    await page.waitForTimeout(100)
  }
  const sawIntermediate = samples.some((t) => t !== samples[samples.length - 1])
  check(
    'انیمیشن شمارنده اجرا می‌شود (مقادیر میانی دیده شد)',
    sawIntermediate,
    `نمونه‌ها: ${[...new Set(samples)].slice(0, 6).join(' → ')} … نهایی ${finalText}`,
  )
  const settled = samples[samples.length - 1]
  await page.waitForTimeout(800)
  const settled2 = await numEl.textContent()
  check('عدد نهایی پایدار است', settled === settled2, `${settled2}`)

  // مقدار نهایی با API بخواند (ارقام فارسی → لاتین)
  const toLatin = (s) =>
    s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString())
  const apiStats = await page.evaluate(async () => {
    const r = await fetch('/api/dashboard', { cache: 'no-store' })
    const d = await r.json()
    return d.stats
  })
  const classesApi = apiStats.find((s) => s.key === 'classes')
  check(
    'عدد نهایی با API هم‌خوان است',
    classesApi && toLatin(settled2 ?? '') === String(classesApi.value),
    `کارت=${settled2} / API=${classesApi?.value}`,
  )

  await page.screenshot({ path: SHOT + '/admin-stat-cards.png', fullPage: true })

  // ─── ۳) آیکون کلاس‌ها → تب کلاس‌ها ───
  await page.click('button[aria-label="لیست کلاس‌ها و مدیریت آنها"]')
  await page.waitForTimeout(700)
  const classesTabActive = await page
    .locator('[role="tab"][data-state="active"]:has-text("کلاس‌ها")')
    .count()
  check('آیکون کلاس‌ها → تب «کلاس‌ها» فعال شد', classesTabActive === 1)

  // ─── آیکون گروه‌های درسی → تب گروه‌ها ───
  await page.click('button[aria-label="لیست گروه‌های درسی و مدیریت آنها"]')
  await page.waitForTimeout(700)
  const groupsTabActive = await page
    .locator('[role="tab"][data-state="active"]:has-text("گروه‌های درسی")')
    .count()
  check('آیکون گروه‌ها → تب «گروه‌های درسی» فعال شد', groupsTabActive === 1)

  // ─── آیکون معلمان → /modir/users?role=TEACHER ───
  await page.click('button[aria-label="لیست معلمان و مدیریت آنها"]')
  await page.waitForURL(/modir\/users\?role=TEACHER/, { timeout: 30000 })
  await page.waitForSelector('[role="tab"], form, .divide-y', { timeout: 30000 })
  await page.waitForTimeout(1500) // فیلتر از URL اعمال و فهرست بارگذاری شود
  const teacherFilter = await page
    .locator('[aria-label="فیلتر نقش کاربران"]')
    .textContent()
    .catch(() => '')
  check('آیکون معلمان → کاربران با فیلتر «معلمان»', /معلمان/.test(teacherFilter ?? ''), teacherFilter ?? '')
  const teacherTotal = await page.locator('p:has-text("معلم"), span:has-text("معلم")').count()
  await page.screenshot({ path: SHOT + '/admin-users-teachers.png', fullPage: true })

  // ─── آیکون دانش‌آموزان → /modir/users?role=STUDENT ───
  await page.goto(BASE + '/modir/classes', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="لیست دانش‌آموزان و مدیریت آنها"]', { timeout: 30000 })
  await page.click('button[aria-label="لیست دانش‌آموزان و مدیریت آنها"]')
  await page.waitForURL(/modir\/users\?role=STUDENT/, { timeout: 30000 })
  await page.waitForTimeout(1500)
  const studentFilter = await page
    .locator('[aria-label="فیلتر نقش کاربران"]')
    .textContent()
    .catch(() => '')
  check('آیکون دانش‌آموزان → کاربران با فیلتر «دانش‌آموزان»', /دانش‌آموزان/.test(studentFilter ?? ''), studentFilter ?? '')

  // ─── آیکون اطلاعیه‌ها → /modir/announcements ───
  await page.goto(BASE + '/modir/classes', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="مدیریت اطلاعیه‌ها"]', { timeout: 30000 })
  await page.click('button[aria-label="مدیریت اطلاعیه‌ها"]')
  await page.waitForURL(/modir\/announcements/, { timeout: 30000 })
  await page.waitForSelector('h1:has-text("ارسال اطلاعیه")', { timeout: 30000 })
  check('آیکون اطلاعیه‌ها → صفحه اطلاعیه‌ها', true)

  // ─── آیکون کلاس‌های آنلاین → /live ───
  await page.goto(BASE + '/modir/classes', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="مدیریت کلاس‌های آنلاین"]', { timeout: 30000 })
  await page.click('button[aria-label="مدیریت کلاس‌های آنلاین"]')
  await page.waitForURL(/\/live/, { timeout: 30000 })
  await page.waitForTimeout(1200)
  check('آیکون کلاس‌های آنلاین → صفحه کلاس آنلاین', true)

  // ─── آیکون اعلان‌ها → /modir/notifications ───
  await page.goto(BASE + '/modir/classes', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="مدیریت اعلان‌ها"]', { timeout: 30000 })
  await page.click('button[aria-label="مدیریت اعلان‌ها"]')
  await page.waitForURL(/modir\/notifications/, { timeout: 30000 })
  await page.waitForSelector('h1:has-text("اعلان‌ها")', { timeout: 30000 })
  check('آیکون اعلان‌ها → صفحه اعلان‌ها', true)

  // ─── مقادیر API سه کارت جدید ───
  console.log('\n  آمار API:', JSON.stringify(apiStats))
} catch (e) {
  fail++
  results.push(`  ❌ خطای غیرمنتظره: ${e.message}`)
  await page.screenshot({ path: SHOT + '/admin-stat-cards-error.png', fullPage: true }).catch(() => {})
} finally {
  await browser.close()
}

console.log('\n═══ نتیجه تست کارت‌های آماری مدیریت مدرسه ═══')
console.log(results.join('\n'))
console.log(`\n  ${pass} موفق / ${fail} ناموفق`)
process.exit(fail > 0 ? 1 : 0)
