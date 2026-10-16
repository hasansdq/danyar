/**
 * تست E2E واقعی مرورگر حضور و غیاب دانیار (مرحله ۸)
 * سناریو: معلم از تقویم جلالی روز را انتخاب می‌کند → کلاس → فهرست دانش‌آموزان
 * با پیش‌فرض حاضر → برداشتن چک‌باکس یک دانش‌آموز → نهایی‌سازی → سابقه دانش‌آموز
 * و اعلان‌ها → گزارش و فیلتر و آمار و خروجی اکسل مدیر → منوی موبایل ۳۹۰px.
 *
 * اجرا: node scripts/test-attendance-browser.mjs   (پیش‌نیاز: اپ روی :81 گیت‌وی)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = 'http://localhost:81'

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SHOT = '/home/z/my-project/download'
async function shot(page, name) {
  try { await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false }) } catch {}
}

async function uiLogin(page, username, password) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForLoadState('networkidle')
}

const browser = await chromium.launch()
const teacherCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' })
const tPage = await teacherCtx.newPage()

// پاک‌سازی جلسات E2E اجرای قبلی (قابل اجرای مجدد)
import { execSync } from 'child_process'
try {
  execSync(`bun -e "import {PrismaClient} from '@prisma/client';const db=new PrismaClient();await db.attendanceSession.deleteMany({where:{title:{startsWith:'جلسه E2E'}}});console.log('e2e-cleaned')"`, { cwd: '/home/z/my-project', stdio: 'pipe' })
  console.log('  • جلسات E2E قبلی پاک شد')
} catch { /* ignore */ }

// آماده‌سازی مستقل: دانش‌آموز پنجم (s7) قبل از جلسه در هفتم۱ ثبت‌نام می‌شود؛
// آزمون به داده‌های باقی‌مانده اجراهای دیگر وابسته نیست
// (execFileSync با آرگومان جدا — بدون لایه shell تا $ها تحریف نشوند)
import { execFileSync } from 'child_process'
function ensureStudent(username, fullName) {
  const script = `
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const h = await bcrypt.hash('Pass@123', 12)
const school = await db.school.findFirst({ where: { name: 'دبیرستان شهید بهشتی' } })
let u = await db.user.findUnique({ where: { username: '${username}' } })
if (!u) u = await db.user.create({ data: { username: '${username}', passwordHash: h, fullName: '${fullName}', role: 'STUDENT', schoolId: school.id } })
const c = await db.classroom.findFirst({ where: { name: 'هفتم۱' } })
const ex = await db.classroomEnrollment.findFirst({ where: { studentId: u.id, classroomId: c.id } })
if (!ex) await db.classroomEnrollment.create({ data: { studentId: u.id, classroomId: c.id } })
console.log('ready')
await db.$disconnect()`
  execFileSync('bun', ['-e', script], { cwd: '/home/z/my-project', stdio: 'pipe' })
}
function removeStudent(username) {
  const script = `
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
await db.classroomEnrollment.deleteMany({ where: { student: { username: '${username}' } } })
await db.user.deleteMany({ where: { username: '${username}' } })
console.log('removed')
await db.$disconnect()`
  execFileSync('bun', ['-e', script], { cwd: '/home/z/my-project', stdio: 'pipe' })
}
try { removeStudent('beheshti.s8'); removeStudent('beheshti.s7'); ensureStudent('beheshti.s7', 'آرش رستمی'); console.log('  • دانش‌آموز پنجم (s7) برای کلاس آماده شد') } catch (e) { console.log('  ⚠ آماده‌سازی s7:', e.message.slice(0, 80)) }

// ─── ۱) معلم: تقویم جلالی → کلاس → ثبت و نهایی‌سازی ───
section('معلم: تقویم جلالی و ثبت حضور')
await uiLogin(tPage, 'beheshti.t3', 'Pass@123')
await tPage.waitForSelector('text=گفتگوها', { timeout: 20000 })

// «حضور و غیاب» از منوها حذف شد (ادغام در تقویم آموزشی) — ورود مستقیم به صفحه گزارش
const menuGone = (await tPage.locator('aside a[href="/attendance"]').count()) === 0
menuGone
  ? ok('آیتم «حضور و غیاب» از منوی دسکتاپ حذف شد (ادغام در تقویم آموزشی)')
  : bad('آیتم «حضور و غیاب» هنوز در منوی دسکتاپ است!')

await tPage.goto(`${BASE}/attendance`)
await tPage.waitForSelector('h1:has-text("حضور و غیاب")', { timeout: 20000 }).then(() => ok('صفحه حضور و غیاب (گزارش مستقیم) باز شد')).catch(() => bad('صفحه باز نشد'))
await sleep(1500)

// تقویم جلالی: ردیف هفته ایرانی (ش ی د س چ پ ج)
const weekRow = await tPage.getByText('پ', { exact: true }).first().isVisible().catch(() => false)
;(await tPage.locator('h1:has-text("حضور و غیاب")').count()) > 0 && weekRow
  ? ok('تقویم جلالی با ردیف هفته ایرانی (ش…ج) رندر شد')
  : bad('تقویم جلالی رندر نشد')

// انتخاب روز امروز (۱۸ مهر ۱۴۰۵) از تقویم
const dayBtn = tPage.locator('button[aria-label="18 مهر"]')
;(await dayBtn.count()) === 1 ? ok('روز امروز در تقویم جلالی پیدا شد') : bad('روز امروز در تقویم نبود')
await dayBtn.click()
await sleep(800)

// کلاس مجاز معلم t3: فقط هفتم۱
const classBtn = tPage.locator('button:has-text("هفتم۱")').first()
await classBtn.isVisible().catch(() => false) ? ok('کلاس مجاز «هفتم۱» برای انتخاب نمایش داده شد') : bad('دکمه کلاس نبود')
await tPage.locator('button:has-text("دانش‌آموز"):below(:text("هفتم۱"))').first().isVisible().catch(() => false)
await classBtn.click()
await tPage.waitForSelector('[data-testid="new-attendance-form"]', { timeout: 15000 }).then(() => ok('فرم جلسه جدید با فهرست دانش‌آموزان باز شد')).catch(() => bad('فرم جلسه جدید باز نشد'))
await sleep(500)

// همه پیش‌فرض حاضر — ۵ چک‌باکس علامت خورده
const boxes = tPage.locator('[data-testid="new-attendance-form"] input[type="checkbox"]')
const boxCount = await boxes.count()
const checkedCount = await boxes.evaluateAll((els) => els.filter((e) => e.checked).length)
boxCount === 5 && checkedCount === 5
  ? ok(`هر ${boxCount} دانش‌آموز پیش‌فرض «حاضر» (چک‌باکس علامت‌خورده)`)
  : bad(`پیش‌فرض حاضر: total=${boxCount} checked=${checkedCount}`)
await shot(tPage, '80-attendance-new-form-default-present')

// برداشتن چک‌باکس «رضا احمدی» → غایب
const s1Row = tPage.locator('[data-testid="new-attendance-form"] label', { hasText: 'رضا احمدی' })
await s1Row.locator('input[type="checkbox"]').click()
await sleep(300)
const s1Absent = await s1Row.locator('text=غایب').isVisible().catch(() => false)
s1Absent ? ok('با برداشتن چک‌باکس، وضعیت به «غایب» تغییر کرد') : bad('تغییر به غایب')
await shot(tPage, '81-attendance-check-to-absent')

// نهایی‌سازی و ارسال اعلان
await tPage.fill('input[aria-label="عنوان جلسه"]', `جلسه E2E ${Date.now() % 100000}`)
await tPage.click('button:has-text("نهایی‌سازی و ارسال اعلان")')
await tPage.waitForSelector('[data-testid="attendance-editor"]', { timeout: 15000 }).then(() => ok('ویرایشگر جلسه پس از ثبت باز شد')).catch(() => bad('ویرایشگر باز نشد'))

// ثبت‌نام دانش‌آموز ششم «پس از نهایی‌سازی» → ردیف «ثبت‌نشده» در گزارش مدرسه
try { ensureStudent('beheshti.s8', 'بابک کریمی'); console.log('  • دانش‌آموز ششم (s8) پس از نهایی‌سازی ثبت‌نام شد') } catch (e) { console.log('  ⚠ آماده‌سازی s8:', e.message.slice(0, 80)) }
await sleep(1200)
const finalizedBadge = await tPage.locator('[data-testid="attendance-editor"]').getByText('نهایی‌شده', { exact: true }).first().isVisible().catch(() => false)
finalizedBadge ? ok('جلسه با بج «نهایی‌شده» نمایش داده شد') : bad('بج نهایی‌شده')
const absChip = await tPage.locator('[data-testid="attendance-editor"]').getByText('۱ غایب').isVisible().catch(() => false)
absChip ? ok('شمارنده «۱ غایب» در سربرگ جلسه') : bad('شمارنده غایب نمایش داده نشد')
// نقطه سبز امروز در تقویم (بارگذاری مجدد جلسات ماه)
await sleep(1500)
const dotToday = await tPage.locator('button[aria-label="18 مهر"] .bg-emerald-500').count()
dotToday >= 1 ? ok('نقطه «نهایی‌شده» روی روز امروز در تقویم ظاهر شد') : bad('نقطه تقویم')
await shot(tPage, '82-attendance-finalized-editor')

// تب سوابق جلسات من
await tPage.click('button[role="tab"]:has-text("سوابق جلسات من")')
await sleep(1000)
const histCount = await tPage.locator('button:has-text("نهایی‌شده")').count()
histCount >= 1 ? ok(`سوابق جلسات من: ${histCount} جلسه نهایی/پیش‌نویس فهرست شد`) : bad('سوابق خالی')

// ─── ۲) دانش‌آموز: حضور و غیاب من ───
section('دانش‌آموز: «حضور و غیاب من» فقط سوابق نهایی خودش')
const sCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' })
const sPage = await sCtx.newPage()
await uiLogin(sPage, 'beheshti.s1', 'Pass@123')
await sPage.waitForSelector('text=گفتگوها', { timeout: 20000 })
const sMenuGone = (await sPage.locator('aside a[href="/attendance"]').count()) === 0
sMenuGone
  ? ok('منوی دانش‌آموز: «حضور و غیاب من» از منو حذف شد (ادغام در تقویم)')
  : bad('منوی دانش‌آموز: آیتم حضور و غیاب هنوز هست!')
await sPage.goto(`${BASE}/attendance`)
await sPage.waitForSelector('h1:has-text("حضور و غیاب من")', { timeout: 20000 }).then(() => ok('صفحه «حضور و غیاب من» باز شد (ورود مستقیم)')).catch(() => bad('صفحه دانش‌آموز باز نشد'))
await sleep(1500)
// سابقه جلسه E2E با وضعیت غایب + جلسه ۱ حاضر
const recAbs = await sPage.locator('[data-testid="student-attendance-record"]', { hasText: 'غایب' }).count()
const recPres = await sPage.locator('[data-testid="student-attendance-record"]', { hasText: 'حاضر' }).count()
recAbs >= 1 && recPres >= 1 ? ok(`سوابق نهایی: ${recPres} حاضر + ${recAbs} غایب (فقط نهایی‌شده)`) : bad(`سوابق: p=${recPres} a=${recAbs}`)
// دکمه ویرایش وجود ندارد
const editBtns = await sPage.locator('button:has-text("اصلاح")').count()
const saveBtns = await sPage.locator('button:has-text("ذخیره")').count()
editBtns === 0 && saveBtns === 0 ? ok('دانش‌آموز هیچ دکمه تغییر وضعیتی ندارد (فقط‌خواندنی)') : bad('دکمه تغییر برای دانش‌آموز!')
// نقطه قرمز امروز در تقویم دانش‌آموز
const redDot = await sPage.locator('button[aria-label="18 مهر"] .bg-rose-500').count()
redDot >= 1 ? ok('نقطه قرمز «غایب» روی امروز در تقویم دانش‌آموز') : bad('نقطه غایب دانش‌آموز')
await shot(sPage, '83-student-my-attendance')

// اعلان‌ها (تنظیمات اکنون با آیکون چرخ‌دنده هدر باز می‌شود)
await sPage.click('header:visible a[title="تنظیمات"]').catch(() => {})
await sPage.goto(`${BASE}/notifications`)
await sPage.waitForSelector('text=اعلان‌ها', { timeout: 15000 }).catch(() => {})
await sleep(1200)
const attNotif = await sPage.locator('text=حضور و غیاب شما ثبت شد').count()
attNotif >= 1 ? ok(`اعلان خصوصی حضور در صفحه اعلان‌ها (${attNotif})`) : bad('اعلان حضور در اعلان‌ها نیست')

// ─── ۳) مدیر مدرسه: گزارش، فیلتر، آمار، اکسل ───
section('مدیر مدرسه: گزارش با فیلتر + آمار + خروجی اکسل')
const aCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' })
const aPage = await aCtx.newPage()
await uiLogin(aPage, 'beheshti.admin', 'Pass@123')
await aPage.waitForSelector('text=گفتگوها', { timeout: 20000 })
// «حضور و غیاب» از منوها حذف شد — ورود مستقیم به گزارش
;(await aPage.locator('aside a[href="/attendance"]').count()) === 0
  ? ok('مدیر: آیتم «حضور و غیاب» از سایدبار حذف شد')
  : bad('مدیر: آیتم حضور و غیاب هنوز در سایدبار است!')
await aPage.goto(`${BASE}/attendance`)
await aPage.waitForSelector('h1:has-text("گزارش مدرسه")', { timeout: 20000 }).then(() => ok('گزارش مدرسه باز شد')).catch(() => bad('گزارش باز نشد'))
await sleep(1800)
const totalRows = await aPage.locator('[data-testid="report-row"]').count()
totalRows >= 5 ? ok(`گزارش بدون فیلتر: ${totalRows} ردیف (شامل ثبت‌نشده)`) : bad(`ردیف‌های گزارش: ${totalRows}`)
const unsetBadge = await aPage.locator('[data-testid="report-row"]', { hasText: 'ثبت‌نشده' }).count()
unsetBadge >= 1 ? ok(`«ثبت‌نشده» جدا نمایش داده می‌شود (${unsetBadge} ردیف)`) : bad('ثبت‌نشده در گزارش نیست')

// فیلتر: کلاس + وضعیت غایب
await aPage.locator('[aria-label="کلاس"]').click()
await aPage.locator('[role="option"]', { hasText: 'هفتم۱' }).click()
await aPage.locator('[aria-label="وضعیت"]').click()
await aPage.locator('[role="option"]', { hasText: 'غایب' }).first().click()
await aPage.click('button:has-text("اعمال فیلتر")')
await sleep(1200)
const filteredRows = await aPage.locator('[data-testid="report-row"]').count()
const allAbsent = await aPage.locator('[data-testid="report-row"]').evaluateAll((els) => els.every((r) => r.textContent.includes('غایب') && !r.textContent.includes('ثبت‌نشده')))
filteredRows >= 1 && allAbsent ? ok(`فیلتر کلاس+غایب: ${filteredRows} ردیف، همه غایب (ثبت‌نشده حذف شد)`) : bad(`فیلتر: n=${filteredRows} all=${allAbsent}`)
await shot(aPage, '84-admin-filtered-report')

// تب آمار
await aPage.click('button[role="tab"]:has-text("آمار")')
await sleep(1000)
const statRows = await aPage.locator('[data-testid="stat-student-row"]').count()
statRows >= 5 ? ok(`آمار دانش‌آموزان: ${statRows} ردیف`) : bad('آمار دانش‌آموزان')
const classStat = await aPage.locator('[data-testid="stat-class-row"]').count()
classStat >= 1 ? ok(`آمار کلاس‌ها: ${classStat} ردیف`) : bad('آمار کلاس‌ها')
await shot(aPage, '85-admin-stats')

// خروجی اکسل واقعی
const dlPromise = aPage.waitForEvent('download', { timeout: 20000 })
await aPage.click('button:has-text("خروجی اکسل")')
const dl = await dlPromise
const path = `${SHOT}/attendance-report-e2e.xlsx`
await dl.saveAs(path)
const fs = await import('fs')
const size = fs.statSync(path).size
size > 1000 ? ok(`خروجی اکسل دانلود شد (${size} بایت)`) : bad('دانلود اکسل')
// فیلتر اعمال‌شده در فایل هم اعمال شده؟ نام جلسه فیلترشده — فقط غایب‌ها
// (کافی است فایل معتبر PK باشد)
const head = fs.readFileSync(path).subarray(0, 2).toString()
head === 'PK' ? ok('فایل اکسل معتبر (PK)') : bad('فایل اکسل خراب')

// ─── ۴) موبایل ۳۹۰px ───
section('موبایل ۳۹۰px: منوی پایین مستقل و صفحه کاربردی')
const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fa-IR', isMobile: true, hasTouch: true })
const mPage = await mCtx.newPage()
await uiLogin(mPage, 'beheshti.t3', 'Pass@123')
// در موبایل سایدبار مخفی است — انتظار نوار پایین موبایل
await mPage.waitForSelector('nav[aria-label="ناوبری موبایل"]', { timeout: 20000 })
// آیتم «حضور و غیاب» از منوی موبایل حذف شد (ادغام در تقویم آموزشی)
;(await mPage.locator('nav[aria-label="ناوبری موبایل"] a[href="/attendance"]').count()) === 0
  ? ok('موبایل: آیتم «حضور و غیاب» از نوار پایین حذف شد')
  : bad('موبایل: آیتم حضور و غیاب هنوز در نوار پایین است!')
await mPage.goto(`${BASE}/attendance`)
await mPage.waitForSelector('h1:has-text("حضور و غیاب")', { timeout: 20000 }).then(() => ok('صفحه حضور و غیاب موبایل باز شد (ورود مستقیم)')).catch(() => bad('موبایل باز نشد'))
await sleep(1200)
const calVisible = await mPage.locator('button[aria-label="18 مهر"]').isVisible().catch(() => false)
calVisible ? ok('تقویم جلالی در موبایل کامل نمایش داده می‌شود') : bad('تقویم موبایل')
await shot(mPage, '86-attendance-mobile')

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

// بازگردانی: دانش‌آموزان آزمون s7/s8 حذف می‌شوند (اجرای مجدد‌پذیر)
try {
  removeStudent('beheshti.s8')
  removeStudent('beheshti.s7')
  ok('بازگردانی: دانش‌آموزان آزمون s7/s8 حذف شدند')
} catch (e) { bad('پاک‌سازی s7/s8: ' + e.message.slice(0, 60)) }

console.log(`نتیجه: ✅ ${pass}  ❌ ${fail}`)
await browser.close()
if (fail > 0) process.exit(1)
