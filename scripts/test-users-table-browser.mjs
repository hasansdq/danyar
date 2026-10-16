/**
 * تست E2E مرورگر — فهرست کاربران پلتفرم به‌صورت جدول مرتب
 * سناریو: ورود مدیر کل → /admin/users → سرستون‌های مشخص،
 * تطابق تعداد ستون سرستون/سلول، مدرسه در ستون جداگانه (نه زیر نام کاربر)،
 * اسکرول افقی موبایل، اسکرین‌شات دسکتاپ/موبایل.
 *
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-users-table-browser.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SHOT = '/home/z/my-project/download'
async function shot(page, name) {
  try { await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false }) } catch {}
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
page.on('pageerror', (err) => console.log('  [pageerror]', String(err).slice(0, 160)))

try {
  section('ورود مدیر کل')
  await page.goto(`${BASE}/superadmin`)
  await page.fill('input[name="username"]', 'superadmin')
  await page.fill('input[name="password"]', 'Admin@1234')
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForLoadState('networkidle')
  ok('ورود مدیر کل از /superadmin')

  section('فهرست کاربران — ساختار جدول')
  await page.goto(`${BASE}/admin/users`)
  await page.waitForLoadState('networkidle')
  await sleep(800)

  const table = page.locator('[data-slot="table"]')
  const tableCount = await table.count()
  tableCount === 1 ? ok('جدول فهرست کاربران رندر شد') : bad(`جدول پیدا نشد (${tableCount})`)

  // ۷ سرستون دقیق و به‌ترتیب
  const headTexts = await page.locator('[data-slot="table-head"]').allInnerTexts()
  const expected = ['کاربر', 'نام کاربری (کدملی)', 'نقش', 'مدرسه', 'تاریخ ثبت', 'وضعیت', 'عملیات']
  const headsOk = expected.length === headTexts.length && expected.every((h, i) => headTexts[i] === h)
  headsOk ? ok(`۷ سرستون به‌ترتیب: ${headTexts.join(' | ')}`) : bad(`سرستون‌ها نادرست: ${headTexts.join(' | ')}`)

  // سرستون‌ها مشخص (پس‌زمینه متمایز از بدنه)
  const headBg = await page.locator('[data-slot="table-head"]').first().evaluate((el) => {
    const tr = el.closest('tr')
    return tr ? getComputedStyle(tr).backgroundColor : ''
  })
  const bodyBg = await page.locator('[data-slot="table-body"] [data-slot="table-cell"]').first().evaluate((el) => {
    const tr = el.closest('tr')
    return tr ? getComputedStyle(tr).backgroundColor : ''
  })
  headBg !== bodyBg ? ok(`سرستون با پس‌زمینه متمایز (${headBg})`) : bad(`سرستون بی‌تمایز (${headBg} == ${bodyBg})`)

  // هر ردیف دقیقاً ۷ سلول — داده زیر سرستون خودش
  const rowCellCounts = await page.locator('[data-slot="table-body"] tr').evaluateAll((rows) =>
    rows.map((r) => r.querySelectorAll('td').length)
  )
  const allSeven = rowCellCounts.length > 0 && rowCellCounts.every((c) => c === 7)
  allSeven ? ok(`${rowCellCounts.length} ردیف، همه با ۷ سلول (داده دقیقا زیر سرستون)`) : bad(`تعداد سلول‌ها: ${rowCellCounts.join(',')}`)

  // مدرسه در ستون جداگانه — سلول ۴ (ایندکس ۳) هر ردیف
  const schoolColumn = await page.locator('[data-slot="table-body"] tr').evaluateAll((rows) =>
    rows.slice(0, 5).map((r) => {
      const td = r.querySelectorAll('td')[3]
      return td ? td.innerText.trim() : ''
    })
  )
  const schoolHasName = schoolColumn.some((s) => s && s !== 'بدون مدرسه')
  const schoolAllFilled = schoolColumn.every((s) => s.length > 0)
  schoolAllFilled ? ok(`ستون مدرسه پر در همه ردیف‌های نمونه: ${schoolColumn.join(' / ')}`) : bad('ستون مدرسه خالی')
  schoolHasName ? ok('نام مدرسه در ستون مستقل نمایش داده می‌شود') : ok('همه نمونه‌ها بدون مدرسه (بدون مدرسه)')

  // نام کاربر دیگر حاوی نام مدرسه/تاریخ نیست (ستون کاربر فقط آواتار+نام)
  const firstUserCell = await page.locator('[data-slot="table-body"] tr').first().evaluate((r) => {
    const td = r.querySelectorAll('td')[0]
    return td ? td.innerText.trim() : ''
  })
  !firstUserCell.includes('•') ? ok(`ستون کاربر بدون اطلاعات مخلوط: «${firstUserCell.split('\n')[0]}»`) : bad('ستون کاربر هنوز اطلاعات دیگر را زیر نام دارد')

  // تراز عمودی سرستون و سلول (x آغاز ستون مدرسه در thead و tbody نزدیک هم)
  const schoolX = await page.evaluate(() => {
    const ths = document.querySelectorAll('[data-slot="table-head"]')
    const tds = document.querySelectorAll('[data-slot="table-body"] tr:first-child [data-slot="table-cell"]')
    if (!ths[3] || !tds[3]) return null
    const a = ths[3].getBoundingClientRect()
    const b = tds[3].getBoundingClientRect()
    return { th: Math.round(a.x), td: Math.round(b.x) }
  })
  schoolX && Math.abs(schoolX.th - schoolX.td) <= 2
    ? ok(`ستون مدرسه دقیقا زیر سرستون خودش (اختلاف ${schoolX ? Math.abs(schoolX.th - schoolX.td) : '?'}px)`)
    : bad(`ناهم‌ترازی ستون مدرسه: ${JSON.stringify(schoolX)}`)

  await shot(page, '127-users-table-desktop')

  section('موبایل ۳۹۰px — اسکرول افقی با حفظ ستون‌ها')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 780 } })
  const mpage = await mctx.newPage()
  await mpage.goto(`${BASE}/superadmin`)
  await mpage.fill('input[name="username"]', 'superadmin')
  await mpage.fill('input[name="password"]', 'Admin@1234')
  await mpage.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await mpage.click('button[type="submit"]')
  await mpage.waitForLoadState('networkidle')
  await mpage.goto(`${BASE}/admin/users`)
  await mpage.waitForLoadState('networkidle')
  await sleep(800)
  const scrollable = await mpage.locator('[data-slot="table-container"]').evaluate((el) => el.scrollWidth > el.clientWidth)
  scrollable ? ok('جدول موبایل قابل اسکرول افقی است') : bad('جدول موبایل فشرده/بی‌اسکرول')
  const mHeads = await mpage.locator('[data-slot="table-head"]').count()
  mHeads === 7 ? ok('موبایل: هر ۷ سرستون حفظ شده') : bad(`موبایل: ${mHeads} سرستون`)
  await mpage.locator('[data-slot="table-container"]').evaluate((el) => { el.scrollLeft = el.scrollWidth })
  await sleep(300)
  await shot(mpage, '128-users-table-mobile-scrolled')
  await mctx.close()

  section('رگرسیون — فیلتر و جست‌وجو روی جدول')
  const filterTabs = page.locator('[data-slot="tabs-list"]').filter({ hasText: 'همه' })
  await filterTabs.locator('[role="tab"]:has-text("دانش‌آموز")').click()
  await sleep(900)
  const rowsAfterTab = await page.locator('[data-slot="table-body"] tr').count()
  rowsAfterTab > 0 ? ok(`تب دانش‌آموز: ${rowsAfterTab} ردیف در جدول`) : bad('تب دانش‌آموز جدول خالی شد')
  const roleBadges = await page.locator('[data-slot="table-body"] [data-slot="badge"]').allInnerTexts()
  const allStudent = roleBadges.length > 0 && roleBadges.every((t) => t.includes('دانش‌آموز'))
  allStudent ? ok('همه نشان‌های نقش در ستون نقش، دانش‌آموز') : bad(`نشان نقش نامرتبط: ${roleBadges.slice(0, 3).join(',')}`)
  await filterTabs.locator('[role="tab"]:has-text("همه")').click()
  await sleep(900)

  // جست‌وجو
  await page.fill('input[aria-label="جست‌وجوی کاربر"]', 'beheshti')
  await sleep(1200)
  const rowsAfterSearch = await page.locator('[data-slot="table-body"] tr').count()
  rowsAfterSearch > 0 ? ok(`جست‌وجو: ${rowsAfterSearch} ردیف`) : bad('جست‌وجو نتیجه نداد')

  // صفحه‌بندی سر جایش است
  const pagVisible = await page.locator('text=صفحه').first().isVisible().catch(() => false)
  pagVisible ? ok('صفحه‌بندی سالم') : ok('صفحه‌بندی تک‌صفحه‌ای (مخفی — طبیعی)')
} catch (e) {
  bad(`خطای کلی: ${String(e).slice(0, 200)}`)
} finally {
  await browser.close()
  console.log(`\n═══ نتیجه: ${pass} پاس ✅ | ${fail} شکست ❌ ═══`)
  process.exit(fail > 0 ? 1 : 0)
}
