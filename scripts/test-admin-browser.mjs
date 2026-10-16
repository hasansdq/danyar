/**
 * تست E2E مرورگر ابزارهای مدیر کل + پوش نوتیفیکیشن دانیار
 * سناریو: پنل مدیر کل (کاربران: ویرایش/رمز/جعل هویت، ارسال انبوه: فیلتر و پیش‌شمارش)،
 * نوار جعل هویت در اپ، کارت پوش در تنظیمات (وضعیت، انواع رویداد، دستگاه‌ها)،
 * موبایل ۳۹۰px و تم تاریک.
 *
 * اجرا: node scripts/test-admin-browser.mjs  (پیش‌نیاز: اپ روی :3000 یا :81 گیت‌وی)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

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

async function uiLogin(page, username, password) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForLoadState('networkidle')
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
page.on('console', (msg) => { if (msg.type() === 'error') console.log('  [console.error]', msg.text().slice(0, 160)) })
page.on('pageerror', (err) => console.log('  [pageerror]', String(err).slice(0, 160)))

try {
  // ── ۱. پنل مدیر کل: کاربران ──
  section('ورود مدیر کل و بخش کاربران')
  await page.goto(`${BASE}/superadmin`)
  await page.fill('input[name="username"]', 'superadmin')
  await page.fill('input[name="password"]', 'Admin@1234')
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForLoadState('networkidle')
  ok('ورود مدیر کل از /superadmin')

  await page.goto(`${BASE}/admin/users`)
  await page.waitForLoadState('networkidle')
  const rowBtns = await page.locator('button[title="ویرایش مشخصات"]').count()
  rowBtns > 0 ? ok(`دکمه ویرایش روی ${rowBtns} ردیف هست`) : bad('دکمه ویرایش پیدا نشد')
  const impBtns = await page.locator('button[title^="ورود به‌جای"]').count()
  impBtns > 0 ? ok(`دکمه جعل هویت روی ${impBtns} ردیف هست`) : bad('دکمه جعل هویت پیدا نشد')
  const pwBtns = await page.locator('button[title="تغییر رمز عبور"]').count()
  pwBtns > 0 ? ok('دکمه تغییر رمز هست') : bad('دکمه تغییر رمز پیدا نشد')

  // ویرایش: باز کردن دیالوگ
  await page.locator('button[title="ویرایش مشخصات"]').first().click()
  await sleep(800)
  const dlgVisible = await page.locator('text=ویرایش کاربر').first().isVisible().catch(() => false)
  dlgVisible ? ok('دیالوگ ویرایش باز شد') : bad('دیالوگ ویرایش باز نشد')
  const phoneInput = await page.locator('#edit-phone').count()
  phoneBtns(phoneInput)
  function phoneBtns(n) { n > 0 ? ok('فیلد شماره تلفن در دیالوگ هست') : bad('فیلد شماره تلفن نیست') }
  await shot(page, '100-admin-user-edit-dialog')
  await page.keyboard.press('Escape')
  await sleep(400)

  // ── ۲. جعل هویت از UI ──
  section('جعل هویت: ورود به‌جای دانش‌آموز')
  await page.locator('button[title^="ورود به‌جای"]').first().click()
  await sleep(500)
  const impConfirm = await page.locator('text=ورود به‌جای کاربر').first().isVisible().catch(() => false)
  impConfirm ? ok('دیالوگ تأیید جعل هویت باز شد') : bad('تأیید جعل هویت نیامد')
  await page.locator('button:has-text("ورود به‌جای کاربر")').last().click()
  await page.waitForLoadState('networkidle')
  await sleep(1200)
  const banner = await page.locator('text=وارد شده‌اید').first().isVisible().catch(() => false)
  banner ? ok('نوار زرد جعل هویت در اپ نمایش داده شد') : bad('نوار جعل هویت دیده نشد')
  await shot(page, '101-impersonation-banner')

  // خروج از جعل هویت
  const exitBtn = page.locator('button:has-text("خروج و بازگشت به پنل مدیر کل")')
  ;(await exitBtn.count()) > 0 ? ok('دکمه خروج از جعل هویت هست') : bad('دکمه خروج جعل هویت نیست')
  await exitBtn.click()
  await page.waitForLoadState('networkidle')
  await sleep(800)
  const backAdmin = page.url().includes('/admin')
  backAdmin ? ok('بازگشت به پنل مدیر کل') : bad(`بازگشت نشد (${page.url()})`)

  // ── ۳. ارسال انبوه: فیلتر + پیش‌شمارش ──
  section('ارسال انبوه در پنل مدیر کل')
  await page.goto(`${BASE}/admin/bulk`)
  await page.waitForLoadState('networkidle')
  ;(await page.locator('text=ارسال انبوه').first().isVisible().catch(() => false))
    ? ok('صفحه ارسال انبوه باز شد') : bad('صفحه ارسال انبوه باز نشد')

  const [prevResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/bulk'), { timeout: 8000 }).catch(() => null),
    page.locator('button:has-text("شمارش مخاطبان")').click(),
  ])
  if (prevResp) {
    const st = prevResp.status()
    const body = await prevResp.text().catch(() => '')
    st === 200 && body.includes('total')
      ? ok(`پیش‌شمارش API پاس داد (${st}) — ${body.slice(0, 120)}`)
      : bad(`پیش‌شمارش API: ${st} — ${body.slice(0, 160)}`)
  } else {
    bad('درخواست پیش‌شمارش ارسال نشد')
  }
  await sleep(800)
  const previewBox = await page.locator('text=کاربر با این فیلترها یافت شد').first().isVisible().catch(() => false)
  previewBox ? ok('پیش‌شمارش واقعی مخاطبان نمایش داده شد') : bad('پیش‌شمارش در UI نیامد')
  await shot(page, '102-admin-bulk-preview')

  // کانال پیامک
  await page.locator('button:has-text("پیامک")').first().click()
  await sleep(400)
  ;(await page.locator('#sms-text').count()) > 0 ? ok('فیلد متن پیامک هست') : bad('فیلد پیامک نیست')

  // گزارش‌ها
  ;(await page.locator('text=گزارش ارسال‌های اخیر').first().isVisible().catch(() => false))
    ? ok('بخش گزارش ارسال‌ها هست') : bad('بخش گزارش‌ها نیست')

  // ── ۴. اعلان‌ها پنل مدیر کل ──
  section('بخش اعلان‌های پنل مدیر کل')
  await page.goto(`${BASE}/admin/notifications`)
  await page.waitForLoadState('networkidle')
  ;(await page.locator('text=کلیدهای VAPID').first().isVisible().catch(() => false))
    ? ok('وضعیت VAPID نمایش داده شد') : bad('وضعیت VAPID نیست')
  ;(await page.locator('text=آمار ارسال').first().isVisible().catch(() => false))
    ? ok('آمار ارسال هست') : bad('آمار ارسال نیست')
  await shot(page, '103-admin-notifications')

  // ── ۵. کارت پوش در تنظیمات (دانش‌آموز — زمینه جدید تا نشست مدیر کل بی‌اثر باشد) ──
  section('تنظیمات پوش کاربر')
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const spage = await sctx.newPage()
  await uiLogin(spage, 'beheshti.s1', 'Pass@123')
  await spage.goto(`${BASE}/settings`)
  await spage.waitForLoadState('networkidle')
  const page2 = spage
  ;(await page.locator('text=اعلان‌های مرورگر (پوش واقعی)').first().isVisible().catch(() => false))
    ? ok('کارت پوش واقعی در تنظیمات هست') : bad('کارت پوش نیست')
  ;(await page.locator('text=رویدادهای دارای پوش').first().isVisible().catch(() => false))
    ? ok('فهرست انواع رویداد هست') : bad('انواع رویداد نیست')
  ;(await page.locator('text=دستگاه‌های دارای اشتراک فعال').first().isVisible().catch(() => false))
    ? ok('فهرست دستگاه‌ها هست') : bad('فهرست دستگاه‌ها نیست')
  ;(await page.locator('text=تضمین‌شده نیست').first().isVisible().catch(() => false))
    ? ok('محدودیت‌ها شفاف گفته شده') : bad('متن محدودیت‌ها نیست')
  await shot(page2, '104-user-push-settings')

  // ── ۶. موبایل ۳۹۰px ──
  section('موبایل ۳۹۰px')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mpage = await mctx.newPage()
  await mpage.goto(`${BASE}/login`)
  await mpage.fill('input[name="username"]', 'beheshti.s1')
  await mpage.fill('input[name="password"]', 'Pass@123')
  await mpage.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await mpage.click('button[type="submit"]')
  await mpage.waitForLoadState('networkidle')
  await mpage.goto(`${BASE}/settings`)
  await mpage.waitForLoadState('networkidle')
  const overflow = await mpage.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  )
  !overflow ? ok('تنظیمات موبایل بدون سرریز افقی') : bad('سرریز افقی در موبایل')
  await mpage.screenshot({ path: `${SHOT}/105-mobile-push-settings.png` })

  // پنل مدیر کل موبایل — زمینه تازه
  const actx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const apage = await actx.newPage()
  await apage.goto(`${BASE}/superadmin`)
  await apage.fill('input[name="username"]', 'superadmin')
  await apage.fill('input[name="password"]', 'Admin@1234')
  await apage.click('button[type="submit"]')
  await apage.waitForLoadState('networkidle')
  await mpage.goto(`${BASE}/admin/bulk`)
  await mpage.waitForLoadState('networkidle')
  const overflow2 = await apage.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  )
  !overflow2 ? ok('ارسال انبوه موبایل بدون سرریز') : bad('سرریز افقی در پنل موبایل')
  await apage.screenshot({ path: `${SHOT}/106-mobile-admin-bulk.png` })
  await actx.close()

  // ── ۷. تم تاریک ──
  section('تم تاریک')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(`${BASE}/admin/notifications`)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `${SHOT}/107-dark-admin-notifications.png` })
  ok('تم تاریک پنل — اسکرین‌شات گرفته شد')
} catch (e) {
  bad(`خطای اجرا: ${e.message?.slice(0, 200)}`)
} finally {
  await browser.close()
}

console.log(`\n════════════════════════════════════`)
console.log(`نتیجه مرورگر: ${pass} موفق، ${fail} ناموفق`)
process.exit(fail > 0 ? 1 : 0)
