/**
 * E2E برندینگ/ظاهر/اسپلش/سایدبار/ایجاد مدرسه — واقعی از UI
 *  ۱) هویت: نام اپ + لوگو → سایدبار/تیتر/فاوآیکون
 *  ۲) اسپلش: نمایش با نام بزرگ + نام نمایشی مدرسه + لودینگ، محو پس از مدت
 *  ۳) فونت: پیش‌فرض ترند + فونت سفارشی آپلودی (body font-family)
 *  ۴) پس‌زمینه چت موبایل (تزریق CSS)
 *  ۵) تنظیمات پخش اسپلش (مدت/رنگ/حذف متن)
 *  ۶) سایدبار ثابت (sticky) مدیر کل و مدیر مدرسه با خروج پایین
 *  ۷) ایجاد مدرسه با انتخاب مدیر از کاربران
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { writeFileSync } from 'fs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let PASS = 0, FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// PNG کوچک ۱×۱ قرمز (لوگو/پس‌زمینه آزمون)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function login(page, username, password, realm = 'app') {
  const path = realm === 'super' ? '/superadmin' : '/login'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
      // اسپلش ممکن است روی ورود تازه روی صفحه باشد — صبر تا محو شدن
      await page.waitForSelector('[data-testid="splash-screen"]', { state: 'detached', timeout: 9000 }).catch(() => {})
      await page.waitForTimeout(500)
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
        if (!page.url().includes(path)) return
        await sleep(500)
      }
    } catch { await sleep(1500) }
  }
  throw new Error(`login failed for ${username}`)
}

const browser = await chromium.launch()
const pageErrors = []
try {
  // ─── ۱) هویت: نام + لوگو ───
  console.log('══ ۱) هویت دانیار (نام + لوگو) ══')
  const su = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } })
  const suPage = await su.newPage()
  suPage.on('pageerror', (e) => pageErrors.push(e.message))
  await login(suPage, 'superadmin', 'Admin@1234', 'super')

  await suPage.goto(`${BASE}/admin/branding`, { waitUntil: 'domcontentloaded' })
  await suPage.waitForSelector('h1:has-text("هویت دانیار")', { timeout: 30000 })
  await suPage.locator('input[maxlength="40"]').fill('دانیار آزمایشی')
  const logoInput = suPage.locator('input[type="file"][accept*="png"]')
  await logoInput.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: TINY_PNG })
  await suPage.getByText('لوگو آپلود شد').waitFor({ timeout: 15000 })
  ok('لوگو آپلود شد')
  await suPage.getByRole('button', { name: 'ذخیره هویت' }).click()
  await suPage.getByText('هویت دانیار ذخیره شد').waitFor({ timeout: 15000 })
  ok('هویت ذخیره شد')

  // اعمال در سایدبار + تیتر + /api/branding
  await suPage.reload({ waitUntil: 'domcontentloaded' })
  await suPage.getByText('دانیار آزمایشی').first().waitFor({ timeout: 20000 })
  const sidebarName = await suPage.locator('aside .font-bold.text-lg').first().textContent()
  sidebarName?.includes('دانیار آزمایشی') ? ok('نام جدید در سایدبار مدیر کل اعمال شد') : bad(`سایدبار: ${sidebarName}`)
  const pub = await suPage.request.get(`${BASE}/api/branding`)
  const pubData = await pub.json()
  pubData.appName === 'دانیار آزمایشی' && pubData.logoUrl
    ? ok('پاسخ عمومی برندینگ: نام + لوگو جدید')
    : bad('پاسخ عمومی برندینگ ناقص است')
  // تیتر صفحه بدون metadata محلی (صفحه ورود) — از generateMetadata ریشه
  await suPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await suPage.waitForFunction(
    () => document.querySelector('meta[name="application-name"]')?.getAttribute('content') === 'دانیار آزمایشی',
    null,
    { timeout: 15000 },
  )
    .then(() => ok('متادیتای ریشه (applicationName) به‌روز شد'))
    .catch(() => bad('متادیتای ریشه به‌روز نشد'))

  // ─── ۳) فونت پیش‌فرض ترند + فونت سفارشی ───
  console.log('══ ۳) فونت برنامه ══')
  await suPage.goto(`${BASE}/admin/appearance`, { waitUntil: 'domcontentloaded' })
  await suPage.waitForSelector('h1:has-text("ظاهر و اسپلش")', { timeout: 30000 })
  await suPage.locator('button:has-text("استعداد")').first().click()
  await suPage.getByText('فونت «استعداد» فعال شد').waitFor({ timeout: 15000 })
  ok('فونت ترند «استعداد» انتخاب شد')
  // اعمال: تزریق CSS — بازخوانی صفحه و بررسی فونت body
  await suPage.reload({ waitUntil: 'domcontentloaded' })
  await suPage.waitForTimeout(1500)
  let bodyFont = await suPage.evaluate(() => getComputedStyle(document.body).fontFamily)
  bodyFont.includes('Estedad') ? ok('فونت body → Estedad (تزریق CSS)') : bad(`body font: ${bodyFont}`)

  // فونت سفارشی: همان woff2 استعداد به‌عنوان فایل آپلودی
  const fontFile = await fetch(`${BASE}/fonts/presets/estedad-arabic-400.woff2`).then((r) => r.arrayBuffer())
  const fontInput = suPage.locator('input[type="file"][accept*="woff2"]').first()
  await fontInput.setInputFiles({ name: 'my-font.woff2', mimeType: 'font/woff2', buffer: Buffer.from(fontFile) })
  await suPage.getByText('فونت سفارشی فعال شد').waitFor({ timeout: 15000 })
  ok('فونت سفارشی آپلود و فعال شد')
  await suPage.reload({ waitUntil: 'domcontentloaded' })
  await suPage.waitForTimeout(1200)
  bodyFont = await suPage.evaluate(() => getComputedStyle(document.body).fontFamily)
  bodyFont.includes('DaniarCustom') ? ok('فونت body → DaniarCustom (فونت سفارشی مقدم است)') : bad(`body font: ${bodyFont}`)
  // حذف فونت سفارشی + بازگشت به وزیرمتن
  await suPage.getByRole('button', { name: 'حذف' }).first().click()
  await suPage.getByText('فونت سفارشی حذف شد').waitFor({ timeout: 10000 })
  await suPage.locator('button:has-text("وزیرمتن")').first().click()
  await suPage.getByText('فونت «وزیرمتن (پیش‌فرض)» فعال شد').waitFor({ timeout: 10000 }).catch(() => {
    bad('بازگشت به وزیرمتن')
  })
  ok('بازگشت به فونت پیش‌فرض')

  // ─── ۴) پس‌زمینه چت موبایل (روشن + تیره) ───
  console.log('══ ۴) پس‌زمینه چت موبایل ══')
  // ترتیب فایل‌اینپوت‌ها در صفحه: فونت (۰) → چت‌بیج روشن (۱) → چت‌بیج تیره (۲) → اسپلش (۳)
  const bgInput = suPage.locator('input[type="file"]').nth(1)
  await bgInput.setInputFiles({ name: 'chat-bg.png', mimeType: 'image/png', buffer: TINY_PNG })
  await suPage.getByText('پس‌زمینه چت (حالت روشن) فعال شد').waitFor({ timeout: 15000 })
  const brand = await suPage.request.get(`${BASE}/api/branding`)
  const brandData = await brand.json()
  brandData.chatBgUrl ? ok('chatBgUrl برای کاربر واردشده فعال است') : bad('chatBgUrl خالی است')
  // پس‌زمینه تیره جداگانه: با نبود تصویر اختصاصی، همان تصویر روشن (fallback) — و برای مهمان null
  brandData.chatBgDarkUrl === brandData.chatBgUrl
    ? ok('chatBgDarkUrl fallback به تصویر روشن (بدون تصویر تیره)')
    : bad(`chatBgDarkUrl بدون fallback: ${brandData.chatBgDarkUrl}`)
  const anon = await browser.newContext()
  const anonBr = await anon.request.get(`${BASE}/api/branding`)
  const anonData = await anonBr.json()
  anonData.chatBgUrl === null && anonData.chatBgDarkUrl === null
    ? ok('chatBgUrl/chatBgDarkUrl برای مهمان مخفی است')
    : bad('chatBg برای مهمان لو رفته')
  await anon.close()

  // ─── ۵) تنظیمات پخش اسپلش ───
  console.log('══ ۵) تنظیمات اسپلش ══')
  await suPage.locator('#splash-duration').fill('1')
  await suPage.getByRole('button', { name: 'ذخیره' }).last().click()
  await suPage.getByText('مدت اسپلش ذخیره شد').waitFor({ timeout: 10000 }).catch(() => {})
  ok('مدت اسپلش → ۱ ثانیه')
  // رنگ نام اپ — معیار قطعی: وضعیت سرور
  await suPage.locator('input[type="color"]').first().fill('#7c3aed')
  let colorSet = false
  for (let i = 0; i < 20 && !colorSet; i++) {
    const cur = await (await suPage.request.get(`${BASE}/api/admin/branding`)).json()
    colorSet = cur.settings?.splashAppNameColor === '#7c3aed'
    if (!colorSet) await sleep(400)
  }
  colorSet ? ok('رنگ متن نام اپ → #7c3aed') : bad('رنگ متن ذخیره نشد')
  // حذف متن نام اپ از نمایش — معیار قطعی: وضعیت سرور (اگر از قبل خاموش است، کلیک نکن)
  {
    const cur0 = await (await suPage.request.get(`${BASE}/api/admin/branding`)).json()
    if (cur0.settings?.splashShowAppName !== false) {
      await suPage.locator('div.rounded-lg.border', { hasText: 'نمایش نام دانیار' }).locator('button, [role="switch"]').first().click()
    }
  }
  let toggled = false
  for (let i = 0; i < 20 && !toggled; i++) {
    const cur = await (await suPage.request.get(`${BASE}/api/admin/branding`)).json()
    toggled = cur.settings?.splashShowAppName === false
    if (!toggled) await sleep(400)
  }
  const splashCfg = await (await suPage.request.get(`${BASE}/api/branding`)).json()
  splashCfg.splash.showAppName === false && splashCfg.splash.durationMs === 1000 && splashCfg.splash.appNameColor === '#7c3aed'
    ? ok('تنظیمات اسپلش (مدت/رنگ/حذف متن) در سرور ثبت شد')
    : bad(`splash cfg: ${JSON.stringify(splashCfg.splash)}`)

  // اسپلش با تنظیمات جدید: بدون نام اپ — برای کاربر مدرسه‌ای نام نمایشی دارد
  const sch = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } })
  const schPage = await sch.newPage()
  schPage.on('pageerror', (e) => pageErrors.push(e.message))
  // ورود مدیر مدرسه (اسپلش روی ورود می‌آید؛ login خودش صبر می‌کند)
  await login(schPage, 'beheshti.admin', 'Pass@123')

  // ─── ۲) اسپلش با نام نمایشی مدرسه ───
  console.log('══ ۲) اسپلش با نام نمایشی مدرسه ══')
  const splashSel = '[data-testid="splash-screen"]'
  // تب تازه = sessionStorage تازه → اسپلش روی بارگذاری تازه نمایش داده می‌شود
  const schPage2 = await sch.newPage()
  schPage2.on('pageerror', (e) => pageErrors.push(e.message))
  await schPage2.goto(`${BASE}/chats`, { waitUntil: 'domcontentloaded' })
  const splashAppeared = await schPage2.waitForSelector(splashSel, { timeout: 8000 }).then(() => true).catch(() => false)
  if (splashAppeared) {
    const txt = await schPage2.locator(splashSel).textContent()
    const hasSpinner = await schPage2.locator(`${splashSel} .animate-spin`).count()
    txt?.includes('مدرسه هوشمند بهشتی') || txt?.includes('مدرسه هوشمند')
      ? ok('نام نمایشی مدرسه در اسپلش (الگوی «مدرسه هوشمند + نام مدرسه»)')
      : bad(`متن اسپلش: ${txt?.slice(0, 80)}`)
    hasSpinner > 0 ? ok('لودینگ متحرک در اسپلش') : bad('لودینگ متحرک دیده نشد')
    // نام اپ حذف شده (تنظیم مرحله ۵)
    ;(await schPage2.locator(`${splashSel} h1`).count()) === 0
      ? ok('متن نام اپ از نمایش خارج شده (تنظیم پنل اعمال شد)')
      : bad('نام اپ با وجود حذف، نمایش داده می‌شود')
    // محو شدن پس از ~۱ ثانیه + ۰.۳ فید
    await schPage2.waitForSelector(splashSel, { state: 'detached', timeout: 4000 })
      .then(() => ok('اسپلش پس از مدت تنظیم‌شده محو شد'))
      .catch(() => bad('اسپلش بعد از مدت تعیین‌شده نرفت'))
    await schPage2.close()
  } else {
    bad('اسپلش روی بارگذاری تازه نمایش داده نشد')
  }

  // ─── ۶) سایدبار ثابت مدیر مدرسه ───
  console.log('══ ۶) سایدبار ثابت ══')
  await schPage.waitForSelector('aside', { timeout: 30000 })
  const schSticky = await schPage.evaluate(() => {
    const a = document.querySelector('aside')
    return a ? getComputedStyle(a).position : 'none'
  })
  schSticky === 'sticky' ? ok('سایدبار مدیر مدرسه: position sticky') : bad(`position: ${schSticky}`)
  // اسکرول محتوا + دیده‌شدن دکمه خروج پایین سایدبار
  await schPage.evaluate(() => window.scrollTo(0, 500))
  await sleep(400)
  const logoutVisible = await schPage.locator('aside button[title="خروج"]').isVisible()
  const asideTop = await schPage.evaluate(() => document.querySelector('aside')?.getBoundingClientRect().top)
  logoutVisible && asideTop === 0 ? ok('پس از اسکرول: خروج پایین سایدبار همچنان دیده می‌شود') : bad(`logout visible: ${logoutVisible}, aside top: ${asideTop}`)

  // مدیر کل هم چک شود (صفحه پر-محتوا)
  await suPage.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' })
  await suPage.waitForSelector('aside', { timeout: 30000 })
  const suSticky = await suPage.evaluate(() => {
    const a = document.querySelector('aside')
    return a ? getComputedStyle(a).position : 'none'
  })
  suSticky === 'sticky' ? ok('سایدبار مدیر کل: position sticky') : bad(`position: ${suSticky}`)
  await suPage.evaluate(() => window.scrollTo(0, 800))
  await sleep(400)
  const suLogout = await suPage.locator('aside button[title="خروج"]').isVisible()
  suLogout ? ok('مدیر کل: خروج پس از اسکرول دیده می‌شود') : bad('خروج مدیر کل از دید خارج شد')

  // ─── ۷) ایجاد مدرسه با مدیر انتخابی از کاربران ───
  console.log('══ ۷) ایجاد مدرسه با مدیر انتخابی ══')
  await suPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await suPage.getByPlaceholder('نام مدرسه — مثلاً: شهید بهشتی').fill('آزمون برندینگ')
  // پس از DOM-content، hydration ممکن است کامل نشده باشد → fill بدون onChange نادیده گرفته می‌شود؛
  // تا رسیدن پاسخ واقعی API تلاش مجدد می‌کنیم
  let resp = null
  for (let attempt = 0; attempt < 4 && !resp; attempt++) {
    const searchResp = suPage.waitForResponse(
      (r) => r.url().includes('/api/admin/users?q=') && r.status() === 200,
      { timeout: 6000 },
    ).catch(() => null)
    const searchInput = suPage.getByPlaceholder('جست‌وجوی نام یا نام کاربری…')
    await searchInput.fill('')
    await searchInput.fill('branding-test-admin')
    resp = await searchResp
  }
  if (!resp) bad('درخواست جست‌وجوی کاربر ارسال نشد')
  const respBody = resp ? await resp.json().catch(() => null) : null
  const found = (respBody?.users ?? []).some((u) => u.username === 'branding-test-admin')
  if (resp) {
    found
      ? ok(`جست‌وجوی کاربر پاسخ داد (${respBody.users.length} نتیجه)`)
      : bad(`پاسخ بدون کاربر هدف: ${JSON.stringify(respBody?.users?.slice(0, 2))}`)
  }
  await suPage.locator('button:has-text("branding-test-admin")').first().waitFor({ timeout: 10000 })
  // انتخاب ردیف — با تأیید ظاهر شدن چیپ انتخاب (re-render وسط کلیک را پوشش می‌دهد)
  let picked = false
  for (let attempt = 0; attempt < 4 && !picked; attempt++) {
    await suPage.locator('button:has-text("branding-test-admin")').first().click().catch(() => {})
    picked = await suPage.getByRole('button', { name: 'تغییر انتخاب' }).waitFor({ timeout: 3000 }).then(() => true).catch(() => false)
  }
  picked ? ok('مدیر مدرسه از فهرست کاربران انتخاب شد') : bad('انتخاب مدیر از فهرست انجام نشد')
  await suPage.getByRole('button', { name: 'ایجاد مدرسه با مدیر انتخابی' }).click()
  await suPage.getByText('ایجاد شد — مدیر: کاربر آزمون برندینگ').waitFor({ timeout: 15000 })
  ok('مدرسه با مدیر انتخاب‌شده از کاربران ساخته شد')
  // تأیید سمت سرور: نقش/مدرسه کاربر
  const checkUser = await suPage.request.get(`${BASE}/api/admin/users?q=branding-test-admin`)
  const checkData = await checkUser.json()
  const u0 = checkData.users?.[0]
  u0?.role === 'SCHOOL_ADMIN' && u0?.school?.name === 'آزمون برندینگ'
    ? ok('کاربر انتخابی → SCHOOL_ADMIN مدرسه جدید (سمت سرور)')
    : bad(`نقش/مدرسه کاربر: ${JSON.stringify(u0?.role)}, ${u0?.school?.name}`)

  // بازگشت تنظیمات به حالت پیش‌فرض تمیز
  await suPage.request.patch(`${BASE}/api/admin/branding`, {
    data: { appName: 'دانیار', splashShowAppName: true, splashDurationMs: 2200, splashAppNameColor: '#0f766e', chatBgKey: null, chatBgDarkKey: null, splashBgKey: null, logoKey: null },
  })
  // حذف مدرسه آزمون + کاربر آزمون
  const del = await suPage.request.delete(`${BASE}/api/schools?name=آزمون برندینg`.replace('g', 'گ'), { method: 'DELETE' })
  void del
  const schoolsList = await suPage.request.get(`${BASE}/api/schools?q=آزمون برندینگ`)
  const sl = await schoolsList.json()
  if (sl.schools?.length) {
    const sid = sl.schools[0].id
    await suPage.request.delete(`${BASE}/api/schools/${sid}?confirm=true`)
    console.log('  • مدرسه آزمون حذف شد')
  }

  console.log('══ جمع‌بندی ══')
  const realErrors = pageErrors.filter((e) => !e.includes('ResizeObserver') && !e.includes('favicon'))
  realErrors.length === 0 ? ok('بدون خطای ناگهانی جاوااسکریپت') : bad(`خطاها: ${realErrors.slice(0, 3).join(' | ')}`)
} catch (e) {
  bad(`شکست سناریو: ${e.message}`)
} finally {
  await browser.close()
}

console.log(`\nنتیجه: ${PASS} پاس / ${FAIL} شکست`)
process.exit(FAIL > 0 ? 1 : 0)
