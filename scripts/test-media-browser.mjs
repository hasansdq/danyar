/**
 * تست مرورگر پنل مدیریت رسانه‌ها — /admin/media
 * ورود مدیر کل → تب گالری (جدول/فیلتر/شمارش دانلود) → تب تنظیمات (فرمت‌ها/سهمیه/ذخیره)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(page, username, password, realm) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(800)
      if (realm === 'super') {
        // تب مدیر کل در صفحه ورود
        const tab = page.locator('text=مدیر کل').first()
        await tab.click().catch(() => {})
        await page.waitForTimeout(400)
      }
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
        if (!page.url().includes('/login')) return true
        await sleep(500)
      }
    } catch {
      await sleep(2000)
    }
  }
  return false
}

const browser = await chromium.launch()
const page = await browser.newPage()

try {
  console.log('▶ ورود مدیر کل (API — کوکی در context مرورگر)')
  const loggedIn = await page.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'superadmin', password: 'Admin@1234', realm: 'superadmin' },
  }).then((r) => r.ok())
  if (!loggedIn) { bad('ورود مدیر کل ناموفق') } else { ok('ورود مدیر کل') }

  console.log('▶ تب گالری')
  await page.goto(`${BASE}/admin/media`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(12000)
  await page.locator('table').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
  const galleryTable = page.locator('table').first()
  if (await galleryTable.isVisible()) { ok('جدول گالری رندر شد') } else { bad('جدول گالری') }
  const bodyText = await page.textContent('body')
  if (bodyText.includes('کل پلتفرم')) { ok('خلاصه کل پلتفرم نمایش داده می‌شود') } else { bad('خلاصه پلتفرم') }
  // ستون‌های جدول
  for (const col of ['دانلود', 'تاریخ ایجاد', 'حجم', 'مدرسه']) {
    if (bodyText.includes(col)) { ok(`ستون «${col}» هست`) } else { bad(`ستون «${col}» نیست`) }
  }
  // فیلترها
  const filterCount = await page.locator('select, [role="combobox"]').count()
  if (filterCount >= 4) { ok(`فیلترهای انتخابی: ${filterCount}`) } else { bad(`فیلترها (${filterCount})`)}

  console.log('▶ تب تنظیمات')
  await page.locator('[role="tab"]', { hasText: 'تنظیمات' }).first().click()
  await page.waitForTimeout(4000)
  const settingsText = await page.textContent('body')
  if (settingsText.includes('فرمت‌های مجاز آپلود')) { ok('بخش فرمت‌ها هست') } else { bad('بخش فرمت‌ها') }
  if (settingsText.includes('سهمیه آپلود کل هر مدرسه')) { ok('بخش سهمیه مدارس هست') } else { bad('بخش سهمیه') }
  const switches = await page.locator('[role="switch"]').count()
  if (switches >= 4) { ok(`سوییچ‌های فرمت: ${switches}`) } else { bad(`سوییچ‌ها (${switches})`) }
  // سهمیه ۰ = نامحدود نشان داده شود
  if (settingsText.includes('۰ = نامحدود') || settingsText.includes('0 = نامحدود') || settingsText.includes('نامحدود')) {
    ok('راهنمای «۰ = نامحدود» هست')
  } else { bad('راهنمای نامحدود') }

  console.log('▶ ذخیره تنظیمات (بدون تغییر) — رفتار سالم')
  await page.locator('button', { hasText: 'ذخیره تنظیمات' }).first().click()
  await page.waitForTimeout(2500)
  const toast = await page.textContent('body')
  if (toast.includes('ذخیره شد') || toast.includes('اعمال می‌شود')) { ok('ذخیره موفق با توست تأیید') } else { bad('توست ذخیره') }

  console.log('▶ گارد: کاربر مدرسه‌ای به پنل رسانه راه ندارد')
  const p2 = await browser.newPage()
  await p2.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'beheshti.t1', password: 'Pass@123', realm: 'app' },
  })
  await p2.goto(`${BASE}/admin/media`, { waitUntil: 'domcontentloaded' })
  await p2.waitForTimeout(3000)
  if (!p2.url().includes('/admin/media')) { ok('معلم ریدایرکت شد (به پیام‌رسان)') } else { bad('معلم وارد پنل شد') }
  await p2.close()
} catch (e) {
  bad(`خطای تست: ${e.message?.slice(0, 120)}`)
} finally {
  await browser.close()
}

console.log(`\nنتیجه: ${PASS} موفق، ${FAIL} ناموفق`)
process.exit(FAIL ? 1 : 0)
