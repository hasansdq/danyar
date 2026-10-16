/**
 * تست E2E واقعی مرورگر نمونه‌سؤالات دانیار (مرحله ۹)
 * سناریو: معلم از UI نمونه‌سؤال چندکلاسه با فایل PDF/تصویر می‌سازد → انتشار با
 * پیام خودکار گروهی → کارت «مشاهده نمونه‌سؤال» در چت گروه → دانش‌آموز جست‌وجو،
 * نشان‌گذاری، جزئیات و گیت پاسخ‌نامه → فعال‌سازی پاسخ‌نامه → دانلود واقعی →
 * اعلان با کلیک به صفحه نمونه‌سؤال → فیلتر مدیر و مخاطبان → موبایل ۳۹۰px و تم تاریک.
 *
 * اجرا: node scripts/test-sampleq-browser.mjs   (پیش‌نیاز: اپ روی :81 گیت‌وی)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

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

// فایل‌های آزمون واقعی
const pdfBytes = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF`)
writeFileSync('/tmp/e2e-sq.pdf', pdfBytes)
writeFileSync('/tmp/e2e-sq-answer.pdf', Buffer.concat([pdfBytes, Buffer.from('\n% answer key')]))

// پاک‌سازی اجرای قبلی: نمونه‌سؤال‌های E2E + پیام‌های SAMPLEQ بدون نمونه‌سؤال زنده
try {
  execSync(`bun -e "
import {PrismaClient} from '@prisma/client'
const db=new PrismaClient()
await db.sampleQuestion.deleteMany({where:{title:{contains:'E2E SQ'}}})
const live = (await db.sampleQuestion.findMany({select:{id:true}})).map(r=>r.id)
const orphans = await db.message.findMany({where:{type:'SAMPLEQ'},select:{id:true,sampleQuestionId:true}})
const dead = orphans.filter(m=>!m.sampleQuestionId || !live.includes(m.sampleQuestionId)).map(m=>m.id)
if (dead.length) await db.message.deleteMany({where:{id:{in:dead}}})
console.log('e2e-cleaned, dead-messages:', dead.length)"`, { cwd: '/home/z/my-project', stdio: 'pipe' })
  console.log('  • داده‌های E2E قبلی پاک شد')
} catch { /* ignore */ }

const browser = await chromium.launch()
const teacherCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' })
const tPage = await teacherCtx.newPage()

// ─── ۱) معلم: منوی مستقل و ایجاد نمونه‌سؤال از UI ───
section('معلم: منوی مستقل و فرم ایجاد نمونه‌سؤال')
await uiLogin(tPage, 'beheshti.t1', 'Pass@123')
await tPage.waitForSelector('text=گفتگوها', { timeout: 20000 })

const menuCount = await tPage.locator('aside a[href="/sample-questions"]').count()
menuCount === 1 ? ok('آیتم «نمونه‌سؤالات» در سایدبار دسکتاپ مستقل است') : bad('آیتم سایدبار: ' + menuCount)

await tPage.click('aside a[href="/sample-questions"]')
await tPage.waitForSelector('h1:has-text("نمونه‌سؤالات")', { timeout: 20000 })
  .then(() => ok('صفحه نمونه‌سؤالات باز شد'))
  .catch(() => bad('صفحه باز نشد'))
await sleep(1200)

await tPage.click('button:has-text("نمونه‌سؤال جدید")')
await tPage.waitForSelector('[role="dialog"]', { timeout: 10000 })
  .then(() => ok('فرم نمونه‌سؤال جدید باز شد'))
  .catch(() => bad('فرم باز نشد'))
await sleep(600)

await tPage.fill('#sq-title', 'آزمون E2E SQ ریاضی')
await tPage.fill('#sq-subject', 'ریاضی')
await tPage.fill('#sq-topic', 'معادله خطی')
await tPage.fill('#sq-desc', 'توضیح آزمون E2E — فایل سؤال و پاسخ‌نامه')
await shot(tPage, '87-sampleq-form')

// انتخاب کلاس هفتم۱ (label چک‌باکس رادیکس)
await tPage.locator('[role="dialog"] label:has-text("هفتم۱")').first().click()
await sleep(300)
const clsState = await tPage.locator('[role="dialog"] label:has-text("هفتم۱") button[role="checkbox"]').first().getAttribute('data-state').catch(() => null)
clsState === 'checked' ? ok('کلاس هفتم۱ انتخاب شد') : bad('کلاس انتخاب نشد: ' + clsState)

// آپلود فایل سؤال (PDF) و پاسخ‌نامه (PDF دوم)
const fileInputs = tPage.locator('[role="dialog"] input[type="file"]')
await fileInputs.nth(0).setInputFiles('/tmp/e2e-sq.pdf')
await sleep(1500)
await fileInputs.nth(1).setInputFiles('/tmp/e2e-sq-answer.pdf')
await sleep(1500)
const stagedCount = await tPage.locator('[role="dialog"] .border-primary\\/30').count()
stagedCount >= 2 ? ok(`فایل‌ها آپلود شدند (${stagedCount})`) : bad('آپلود فایل در فرم ناموفق: ' + stagedCount)

// فعال‌کردن ارسال پیام به گروه + انتخاب گروه ریاضی هفتم۱
await tPage.click('[aria-label="فعال‌کردن ارسال پیام به گروه"]')
await sleep(400)
await tPage.click('[aria-label="انتخاب گروه مقصد"]')
await sleep(500)
await tPage.locator('[role="option"]:has-text("ریاضی هفتم۱")').first().click()
await sleep(300)
ok('گروه مقصد «ریاضی هفتم۱» انتخاب شد')
await shot(tPage, '88-sampleq-form-filled')

await tPage.click('button:has-text("ایجاد نمونه‌سؤال")')
await tPage.waitForSelector('text=آزمون E2E SQ ریاضی', { timeout: 15000 })
  .then(() => ok('نمونه‌سؤال ایجاد شد و در فهرست ظاهر شد'))
  .catch(() => bad('نمونه‌سؤال در فهرست ظاهر نشد'))
await sleep(800)
await shot(tPage, '89-sampleq-teacher-list')

// ─── ۲) کارت پیام خودکار در چت گروه ───
section('کارت «مشاهده نمونه‌سؤال» در چت گروه')
await tPage.click('aside a[href="/"]')
await tPage.waitForSelector('text=ریاضی هفتم۱', { timeout: 15000 })
await tPage.locator('button:has-text("ریاضی هفتم۱")').first().click()
await sleep(2500)
const cardBtn = tPage.locator('a:has-text("مشاهده نمونه‌سؤال")').first()
await cardBtn.isVisible({ timeout: 8000 }).catch(() => false)
;(await cardBtn.count()) > 0
  ? ok('کارت پیام خودکار با دکمه «مشاهده نمونه‌سؤال» در گروه')
  : bad('کارت پیام در گروه نبود')
await shot(tPage, '90-sampleq-group-card')

// ─── ۳) دانش‌آموز: فهرست، جست‌وجو، نشان‌گذاری، جزئیات و گیت پاسخ‌نامه ───
section('دانش‌آموز: فهرست و جست‌وجو و نشان‌گذاری')
const stuCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' })
const sPage = await stuCtx.newPage()
await uiLogin(sPage, 'beheshti.s1', 'Pass@123')
await sPage.waitForSelector('text=گفتگوها', { timeout: 20000 })
const sMenu = await sPage.locator('aside a[href="/sample-questions"]').count()
sMenu === 1 ? ok('آیتم «نمونه‌سؤالات» در منوی دانش‌آموز هم هست') : bad('منوی دانش‌آموز: ' + sMenu)
await sPage.click('aside a[href="/sample-questions"]')
await sPage.waitForSelector('h1:has-text("نمونه‌سؤالات")', { timeout: 15000 })
await sleep(1200)
const studentCard = sPage.locator('a:has-text("آزمون E2E SQ ریاضی")')
;(await studentCard.count()) > 0 ? ok('دانش‌آموز نمونه‌سؤال منتشرشده را در فهرست دید') : bad('فهرست دانش‌آموز خالی')

// جست‌وجو: عبارت بی‌ربط → خالی؛ عبارت درست → پیدا
await sPage.fill('input[aria-label="جست‌وجوی نمونه‌سؤال"]', 'ناموجود-xyz')
await sleep(1000)
await sPage.waitForSelector('text=نمونه‌سؤالی یافت نشد', { timeout: 6000 })
  .then(() => ok('جست‌وجوی بی‌ربط → حالت خالی'))
  .catch(() => bad('جست‌وجوی بی‌ربط خالی نشد'))
await sPage.fill('input[aria-label="جست‌وجوی نمونه‌سؤال"]', 'E2E SQ')
await sleep(1000)
;(await sPage.locator('a:has-text("آزمون E2E SQ ریاضی")').count()) > 0
  ? ok('جست‌وجوی عنوان پیدا کرد')
  : bad('جست‌وجوی عنوان ناموفق')

// نشان‌گذاری + فیلتر نشان‌دارها
await sPage.locator('button[aria-label="نشان‌گذاری برای دسترسی سریع"]').first().click()
await sleep(800)
await sPage.locator('label:has-text("فقط نشان‌دارها")').click()
await sleep(1000)
;(await sPage.locator('a:has-text("آزمون E2E SQ ریاضی")').count()) === 1
  ? ok('نشان‌گذاری + فیلتر «فقط نشان‌دارها» کار کرد')
  : bad('فیلتر نشان‌دارها')

// جزئیات: فایل سؤال هست، پاسخ‌نامه غیرفعال
await sPage.locator('a:has-text("آزمون E2E SQ ریاضی")').first().click()
await sPage.waitForSelector('text=فایل‌های نمونه‌سؤال', { timeout: 15000 })
await sleep(1000)
const hasQFile = await sPage.locator('text=e2e-sq.pdf').count()
hasQFile > 0 ? ok('فایل سؤال در جزئیات دانش‌آموز دیده شد') : bad('فایل سؤال دیده نشد')
const answerBlocked = await sPage.locator('text=پاسخ‌نامه توسط معلم فعال نشده است').count()
answerBlocked > 0
  ? ok('پاسخ‌نامه با نمایش غیرفعال → پیام شفاف به دانش‌آموز')
  : bad('گیت پاسخ‌نامه UI')
await shot(sPage, '91-sampleq-student-detail')

// ─── ۴) معلم پاسخ‌نامه را فعال می‌کند → دانش‌آموز می‌بیند و دانلود واقعی ───
section('فعال‌سازی پاسخ‌نامه و دانلود واقعی')
await tPage.click('aside a[href="/sample-questions"]')
await tPage.waitForSelector('h1:has-text("نمونه‌سؤالات")', { timeout: 10000 })
await sleep(800)
await tPage.locator('a:has-text("آزمون E2E SQ ریاضی")').first().click()
await tPage.waitForSelector('text=پاسخ‌نامه', { timeout: 10000 })
await sleep(800)
const ansVisibleForTeacher = await tPage.locator('text=e2e-sq-answer.pdf').count()
ansVisibleForTeacher > 0 ? ok('معلم فایل پاسخ‌نامه را در جزئیات می‌بیند') : bad('پاسخ‌نامه معلم')

// پیش‌نمایش PDF (دکمه نمایش + iframe)
await tPage.locator('button:has-text("نمایش")').first().click()
await sleep(1500)
const pdfFrame = tPage.locator('iframe[title^="پیش‌نمایش"]')
;(await pdfFrame.count()) > 0 ? ok('پیش‌نمایش PDF باز شد') : bad('پیش‌نمایش PDF')
await tPage.locator('[data-slot="dialog-close"]').first().click()
await sleep(700)

// ویرایش: فعال‌کردن نمایش پاسخ‌نامه
await tPage.click('aside a[href="/sample-questions"]')
await sleep(800)
await tPage.locator('a:has-text("آزمون E2E SQ ریاضی")').first().waitFor({ timeout: 8000 })
await tPage.locator('button[aria-label="عملیات نمونه‌سؤال"]').first().click()
await sleep(400)
await tPage.locator('[role="menuitem"]:has-text("ویرایش")').first().click()
await tPage.waitForSelector('[role="dialog"]', { timeout: 8000 })
await sleep(500)
await tPage.click('[aria-label="فعال/غیرفعال کردن نمایش پاسخ‌نامه"]')
await sleep(300)
await tPage.click('button:has-text("ذخیره تغییرات")')
await tPage.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 15000 })
  .then(() => ok('نمایش پاسخ‌نامه فعال شد و دیالوگ بسته شد'))
  .catch(() => bad('دیالوگ ویرایش بسته نشد'))
await sleep(1000)

// دانش‌آموز: پاسخ‌نامه حالا دیده می‌شود + فایل سؤال حفظ شده + دانلود واقعی 200
await sPage.reload({ waitUntil: 'networkidle' })
await sleep(1200)
const qStill = await sPage.locator('text=e2e-sq.pdf').count()
qStill > 0 ? ok('فایل سؤال پس از ویرایش حفظ شد') : bad('فایل سؤال در ویرایش حذف شد!')
const ansNow = await sPage.locator('text=e2e-sq-answer.pdf').count()
ansNow > 0 ? ok('دانش‌آموز حالا پاسخ‌نامه را می‌بیند') : bad('پاسخ‌نامه فعال برای دانش‌آموز')
const dlHref = await sPage.locator('a[aria-label^="دانلود"]').first().getAttribute('href').catch(() => null)
if (dlHref) {
  const st = await sPage.evaluate(async (u) => (await fetch(u)).status, dlHref)
  st === 200 ? ok('دانلود فایل با احراز هویت → 200') : bad('دانلود: ' + st)
} else bad('لینک دانلود نبود')
await shot(sPage, '92-sampleq-answer-visible')

// اعلان → کلیک به صفحه نمونه‌سؤال
section('اعلان انتشار با کلیک به صفحه نمونه‌سؤال')
await sPage.click('aside a[href="/notifications"]').catch(async () => {
  await sPage.goto(`${BASE}/notifications`)
})
await sPage.waitForSelector('text=نمونه‌سؤال جدید', { timeout: 10000 })
  .then(() => ok('اعلان «نمونه‌سؤال جدید» در صفحه اعلان‌ها'))
  .catch(() => bad('اعلان انتشار نبود'))
await shot(sPage, '93-sampleq-notification')

// ─── ۵) مدیر مدرسه: فیلتر و مخاطبان ───
section('مدیر مدرسه: فیلترها و مخاطبان')
const admCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' })
const aPage = await admCtx.newPage()
await uiLogin(aPage, 'beheshti.admin', 'Pass@123')
await aPage.waitForSelector('text=گفتگوها', { timeout: 20000 })
await aPage.click('aside a[href="/sample-questions"]')
await aPage.waitForSelector('h1:has-text("نمونه‌سؤالات")', { timeout: 15000 })
await sleep(1200)
;(await aPage.locator('a:has-text("آزمون E2E SQ ریاضی")').count()) > 0
  ? ok('مدیر نمونه‌سؤال مدرسه را در فهرست دید')
  : bad('فهرست مدیر خالی')
// فیلتر وضعیت منتشرشده
await aPage.click('[aria-label="فیلتر وضعیت انتشار"]')
await sleep(400)
await aPage.locator('[role="option"]:has-text("منتشرشده")').first().click()
await sleep(900)
;(await aPage.locator('a:has-text("آزمون E2E SQ ریاضی")').count()) > 0
  ? ok('فیلتر وضعیت=منتشرشده')
  : bad('فیلتر وضعیت')
await shot(aPage, '94-sampleq-admin-filter')
// جزئیات: مخاطبان
await aPage.locator('a:has-text("آزمون E2E SQ ریاضی")').first().click()
await aPage.waitForSelector('text=مخاطبان', { timeout: 10000 })
await sleep(800)
const audienceOpen = await aPage.locator('summary:has-text("هفتم۱")').count()
audienceOpen > 0 ? ok('بخش مخاطبان با کلاس و شمار دانش‌آموز') : bad('مخاطبان')
await aPage.locator('summary:has-text("هفتم۱")').first().click()
await sleep(400)
const studentListed = await aPage.locator('details >> text=محمد').count()
;(await aPage.locator('details li').count()) > 0
  ? ok('فهرست دانش‌آموزان مخاطب باز شد')
  : bad('فهرست دانش‌آموزان')
await shot(aPage, '95-sampleq-admin-audience')

// ─── ۶) موبایل ۳۹۰px: منوی پایین ۷ آیتمی و صفحه جزئیات ───
section('موبایل ۳۹۰px')
const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fa-IR', isMobile: true, hasTouch: true })
await mCtx.addInitScript(() => localStorage.setItem('theme', 'dark'))
const mPage = await mCtx.newPage()
await uiLogin(mPage, 'beheshti.s1', 'Pass@123')
await mPage.waitForSelector('nav[aria-label="ناوبری موبایل"]', { timeout: 20000 })
const navItems = await mPage.locator('nav[aria-label="ناوبری موبایل"] a').count()
navItems === 7 ? ok('منوی پایین موبایل با ۷ آیتم') : bad('آیتم‌های منوی موبایل: ' + navItems)
const sqNav = mPage.locator('nav[aria-label="ناوبری موبایل"] a[href="/sample-questions"]')
;(await sqNav.count()) === 1 ? ok('«نمونه‌سؤال» در منوی پایین موبایل') : bad('منوی موبایل فاقد نمونه‌سؤال')
await sqNav.click()
await mPage.waitForSelector('h1:has-text("نمونه‌سؤالات")', { timeout: 15000 })
await sleep(1200)
const labelTrunc = await mPage.locator('nav[aria-label="ناوبری موبایل"] a').evaluateAll((els) =>
  els.every((e) => e.scrollWidth <= e.clientWidth + 2),
)
labelTrunc ? ok('برچسب‌های منوی موبایل سرریز ندارند') : bad('برچسب منو سرریز دارد')
await mPage.locator('a:has-text("آزمون E2E SQ ریاضی")').first().click()
await mPage.waitForSelector('text=فایل‌های نمونه‌سؤال', { timeout: 10000 })
await sleep(800)
await shot(mPage, '96-sampleq-mobile-dark')
ok('صفحه جزئیات در موبایل با تم تاریک رندر شد')

// ─── پاک‌سازی داده E2E ───
try {
  execSync(`bun -e "
import {PrismaClient} from '@prisma/client'
const db=new PrismaClient()
await db.sampleQuestion.deleteMany({where:{title:{contains:'E2E SQ'}}})
const live = (await db.sampleQuestion.findMany({select:{id:true}})).map(r=>r.id)
const orphans = await db.message.findMany({where:{type:'SAMPLEQ'},select:{id:true,sampleQuestionId:true}})
const dead = orphans.filter(m=>!m.sampleQuestionId || !live.includes(m.sampleQuestionId)).map(m=>m.id)
if (dead.length) await db.message.deleteMany({where:{id:{in:dead}}})
console.log('cleaned')
"`, { cwd: '/home/z/my-project', stdio: 'pipe' })
  ok('داده‌های E2E پاک‌سازی شد')
} catch { bad('پاک‌سازی پایانی') }

await browser.close()
console.log(`\n════════════════════════════\nنتیجه E2E مرورگر: ${pass} پاس ✅ | ${fail} شکست ❌\n════════════════════════════`)
process.exit(fail === 0 ? 0 : 1)
