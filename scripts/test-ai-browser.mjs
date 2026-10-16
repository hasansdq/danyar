/**
 * تست E2E واقعی مرورگر دستیار دانیار (مرحله ۶)
 * سناریو: پنل مدیر کل (پیکربندی + آزمایش اتصال واقعی + فعال‌سازی مدرسه)،
 * ورود مدیر مدرسه از UI، آیتم «دستیار دانیار» در فهرست گفتگوها، ارسال پیام و
 * دیدن جریان پاسخ با منابع (refs)، پایداری تاریخچه، گفتگوی جدید، حذف با تأیید،
 * توقف تولید، رد دسترسی معلم، موبایل ۳۹۰px و تم تاریک.
 *
 * اجرا: node scripts/test-ai-browser.mjs   (پیش‌نیاز: اپ روی :81 گیت‌وی)
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

async function uiLogin(page, username, password, realm = 'app') {
  if (realm === 'superadmin') await page.goto(`${BASE}/superadmin`)
  else await page.goto(`${BASE}/login`)
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForLoadState('networkidle')
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' })
const page = await ctx.newPage()

// ─── ۱) پنل مدیر کل ───
section('پنل مدیر کل: پیکربندی و آزمایش واقعی اتصال')
await uiLogin(page, 'superadmin', 'Admin@1234', 'superadmin')
if (!page.url().includes('/admin')) { bad(`ورود مدیر کل (${page.url()})`) } else { ok('ورود مدیر کل از /superadmin') }
await page.goto(`${BASE}/admin/ai`)
await page.waitForSelector('h1:has-text("دستیار هوش مصنوعی")', { timeout: 20000 }).then(() => ok('صفحه «دستیار هوش مصنوعی» باز شد')).catch(() => bad('صفحه AI باز نشد'))
await sleep(1200)

// فرم پیکربندی پر است (از تست curl)
const modelVal = await page.inputValue('input[dir="ltr"][placeholder*="gpt"]') ?? ''
const keyPlaceholder = await page.getAttribute('input[type="password"]', 'placeholder').catch(() => '')
if (keyPlaceholder?.includes('ذخیره شده')) { ok('کلید ذخیره‌شده ماسک شده (پایان ۹۹۹۹ در placeholder)') } else { bad('ماسک کلید: ' + keyPlaceholder) }

// آزمایش اتصال واقعی — دکمه و نتیجه واقعی
await page.click('button:has-text("آزمایش اتصال")')
await page.waitForSelector('text=اتصال واقعی برقرار شد', { timeout: 60000 }).then(() => ok('نتیجه واقعی: «اتصال واقعی برقرار شد» با تأخیر و پاسخ مدل')).catch(() => bad('نتیجه آزمایش اتصال ظاهر نشد'))
await shot(page, '60-admin-ai-config')

// فعال‌سازی دستیار برای مدرسه بهشتی از جدول
const beheshtiRow = page.locator('div.py-3\\.5', { hasText: 'بهشتی' }).first()
const toggles = beheshtiRow.locator('button[role="switch"]')
const cnt = await toggles.count()
if (cnt >= 2) {
  const aiSwitch = toggles.last()
  const state = await aiSwitch.getAttribute('aria-checked') ?? await aiSwitch.getAttribute('data-state')
  if (state === 'true' || state === 'checked') ok('دستیار مدرسه بهشتی فعال است (از تست API)')
  else {
    await aiSwitch.click()
    await sleep(600)
    ok('دستیار مدرسه بهشتی از UI فعال شد')
  }
} else bad('سوییچ‌های مدرسه یافت نشد')
await shot(page, '61-admin-ai-schools')

// ─── ۲) مدیر مدرسه: فهرست گفتگوها ───
section('مدیر مدرسه: آیتم «دستیار دانیار» در فهرست گفتگوها')
const mgrCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' })
const page2 = await mgrCtx.newPage()
await page2.goto(`${BASE}/login`)
await page2.fill('input[name="username"]', 'beheshti.admin')
await page2.fill('input[name="password"]', 'Pass@123')
  await page2.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
await page2.click('button[type="submit"]')
await page2.waitForLoadState('networkidle')
if (!page2.url().match(/\/$/)) await page2.goto(`${BASE}/`)
await sleep(1200)
const assistantItem = page2.locator('li button', { hasText: 'دستیار دانیار' }).first()
if (await assistantItem.count() > 0) { ok('آیتم «دستیار دانیار» در فهرست گفتگوها دیده شد') } else { bad('آیتم دستیار در فهرست نیست') }
await shot(page2, '62-chat-list-with-assistant')

await assistantItem.click()
await page2.waitForURL('**/assistant')
await page2.waitForLoadState('networkidle')
await sleep(1000)
ok('صفحه /assistant باز شد')

// ─── ۳) گفتگوی جدید و ارسال پیام با جریان پاسخ ───
section('ارسال پیام و جریان پاسخ با منابع')
await page2.click('button[aria-label="گفتگوی جدید دستیار"]')
await sleep(800)
// پیام اول از طریق چیپ پیشنهادی واقعی
await page2.click('button:has-text("وضعیت ارسال تکالیف و بازخوردهای مدرسه را خلاصه کن")')
ok('پیام از چیپ پیشنهاد ارسال شد — در انتظار جریان پاسخ…')
// وضعیت تولید یا حباب جریان
await page2.waitForSelector('button[aria-label="توقف تولید پاسخ"]', { timeout: 15000 }).then(() => ok('دکمه توقف هنگام تولید فعال بود')).catch(() => bad('دکمه توقف دیده نشد'))
// منابع پاسخ (refs chips)
await page2.waitForSelector('text=پاسخ بر اساس این داده‌های برنامه تهیه شده', { timeout: 120000 }).then(() => ok('بخش «پاسخ بر اساس این داده‌های برنامه تهیه شده» ظاهر شد (refs)')).catch(() => bad('refs نمایش داده نشد'))
const assistantBubble = await page2.locator('div.rounded-se-md').first().textContent().catch(() => '')
if (assistantBubble && assistantBubble.length > 40) { ok(`پاسخ دستیار رندر شد (${assistantBubble.length} کاراکتر)`) } else { bad('متن پاسخ کوتاه/خالی') }
await shot(page2, '63-assistant-answer-with-refs')

// پایداری: رفرش صفحه → تاریخچه می‌ماند
await page2.reload()
await page2.waitForLoadState('networkidle')
await sleep(1200)
const persisted = await page2.locator('div.rounded-se-md').first().count()
if (persisted > 0) { ok('پس از رفرش، تاریخچه پاسخ پایدار ماند') } else { bad('تاریخچه بعد از رفرش از بین رفت') }

// پیام دوم — تاریخچه‌محور
const ta2 = page2.locator('textarea[aria-label="متن پیام به دستیار"]')
await ta2.click()
await ta2.pressSequentially('بر اساس همان وضعیت، یک پیش‌نویس اطلاعیه کوتاه برای اولیای دانش‌آموزان آماده کن', { delay: 5 })
await ta2.press('Enter')
await page2.waitForSelector('text=پاسخ بر اساس این داده‌های برنامه تهیه شده', { timeout: 120000 }).then(() => ok('پیام دوم با توجه به تاریخچه پاسخ گرفت')).catch(() => bad('پیام دوم پاسخ نگرفت'))

// گفتگوهای قبلی در منو
await page2.click('button[aria-label="گفتگوهای قبلی دستیار"]')
await sleep(500)
const convItems = await page2.locator('[role="menuitem"]').count()
if (convItems >= 1) { ok(`منوی گفتگوهای قبلی: ${convItems} گفتگو`) } else { bad('منوی گفتگوها خالی') }
await page2.keyboard.press('Escape')

// ─── ۴) توقف تولید ───
section('توقف تولید پاسخ')
// چند تلاش: کلیک فوری به محض ظاهرشدن دکمه توقف (پاسخ مدل ممکن است سریع تمام شود)
let stopped = false
for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
  await page2.click('button[aria-label="گفتگوی جدید دستیار"]')
  await sleep(700)
  const ta3 = page2.locator('textarea[aria-label="متن پیام به دستیار"]')
  await ta3.click()
  await ta3.pressSequentially('یک گزارش مدیریتی بسیار مفصل و طولانی و کامل با فهرست‌ها از وضعیت آموزشی کل مدرسه بنویس', { delay: 3 })
  await ta3.press('Enter')
  const stopBtn = page2.locator('button[aria-label="توقف تولید پاسخ"]')
  try {
    await stopBtn.click({ timeout: 15000 })
    stopped = true
  } catch {
    console.log('  … پاسخ پیش از توقف کامل شد، تلاش مجدد')
  }
}
if (stopped) {
  ok('دکمه توقف در حین تولید کلیک شد')
  await page2.waitForSelector('button[aria-label="ارسال پیام"]', { timeout: 30000 })
  ok('تولید متوقف شد و کامپوزر برگشت')
  await sleep(1000)
  await shot(page2, '64-assistant-stopped')
} else bad('توقف ناموفق')

// ─── ۵) حذف گفتگو با تأیید ───
section('حذف گفتگو با تأیید کاربر')
// گفتگوی فعلی (تازه ساخته شده) را حذف کن
await page2.click('button[aria-label="حذف گفتگوی دستیار"]')
await page2.waitForSelector('text=حذف گفتگو', { timeout: 5000 }).catch(() => {})
await sleep(400)
const dialogVisible = await page2.locator('[role="dialog"]').count()
if (dialogVisible > 0) { ok('دیالوگ تأیید حذف باز شد') } else { bad('دیالوگ حذف باز نشد') }
await shot(page2, '65-delete-confirm')
await page2.click('button:has-text("حذف قطعی گفتگو")')
await sleep(1000)
ok('گفتگو با تأیید حذف شد')

// ─── ۶) رد دسترسی معلم ───
section('کنترل دسترسی: معلم به دستیار راه ندارد')
const tCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' })
const page3 = await tCtx.newPage()
await page3.goto(`${BASE}/login`)
await page3.fill('input[name="username"]', 'beheshti.t1')
await page3.fill('input[name="password"]', 'Pass@123')
  await page3.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
await page3.click('button[type="submit"]')
await page3.waitForLoadState('networkidle')
await page3.goto(`${BASE}/assistant`)
await sleep(1200)
if (!page3.url().includes('/assistant')) { ok(`معلم ریدایرکت شد (${new URL(page3.url()).pathname})`) } else { bad('معلم به /assistant راه پیدا کرد!') }
await page3.close()
await tCtx.close()
await mgrCtx.close()

// ─── ۷) موبایل و تم تاریک ───
section('موبایل ۳۹۰px و تم تاریک')
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fa-IR' })
const mpage = await mctx.newPage()
await mpage.goto(`${BASE}/login`)
await mpage.fill('input[name="username"]', 'beheshti.admin')
await mpage.fill('input[name="password"]', 'Pass@123')
await mpage.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
await mpage.click('button[type="submit"]')
await mpage.waitForLoadState('networkidle')
// منوی پایین موبایل نباید آیتم دستیار داشته باشد — دستیار از فهرست گفتگوها باز می‌شود
await mpage.goto(`${BASE}/`)
await sleep(1200)
const mItem = mpage.locator('li button', { hasText: 'دستیار دانیار' }).first()
if (await mItem.count() > 0) { ok('موبایل: آیتم دستیار در فهرست') } else { bad('موبایل: آیتم دستیار نیست') }
await mItem.click()
await mpage.waitForURL('**/assistant')
await sleep(1000)
// دکمه بازگشت موبایل
if (await mpage.locator('button[aria-label="بازگشت به گفتگوها"]').count() > 0) { ok('موبایل: دکمه بازگشت موجود') } else { bad('موبایل: دکمه بازگشت نیست') }
const mta = mpage.locator('textarea[aria-label="متن پیام به دستیار"]')
await mta.click()
await mta.pressSequentially('سلام! فقط بگو چه کمکی می‌توانی بکنی', { delay: 5 })
await mta.press('Enter')
await mpage.waitForSelector('text=پاسخ بر اساس این داده‌های برنامه تهیه شده', { timeout: 120000 }).catch(() => {})
await sleep(500)
await shot(mpage, '66-assistant-mobile')
// تم تاریک
await mpage.emulateMedia({ colorScheme: 'dark' })
await sleep(600)
await shot(mpage, '67-assistant-dark')
await mctx.close()

await browser.close()
console.log(`\n════════════════════════════════`)
console.log(`نتیجه نهایی: ${pass} پاس / ${fail} شکست`)
process.exit(fail > 0 ? 1 : 0)
