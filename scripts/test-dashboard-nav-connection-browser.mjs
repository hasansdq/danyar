/**
 * تست E2E مرورگر — داشبورد نقش‌ها، منوها و وضعیت اتصال پیام‌رسان (درخواست کاربر):
 *  ۱) دانش‌آموز و معلم: داشبورد حذف (/dashboard → /)، بدون «داشبورد» و «تنظیمات» در منوی
 *     موبایل و سایدبار دسکتاپ، آیکون چرخ‌دنده تنظیمات در هدر موبایل و دسکتاپ
 *  ۲) مدیر مدرسه: /dashboard → /modir/classes، آمار مدرسه (کلاس‌ها/گروه‌ها/معلمان/دانش‌آموزان)
 *     + دکمه کاربران در «مدیریت مدرسه»
 *  ۳) وضعیت اتصال سه‌حالته واقعی زیر کادر جستجو: متصل → قطع/درحال اتصال با قطع واقعی سرویس
 *     سوکت → «متصل» دوباره با تلاش مجدد خودکار (بدون رفرش و بدون دکمه)؛ «تلاش مجدد» وجود ندارد
 *  ۴) موبایل ۳۹۰px و تم تاریک
 *
 * اجرا: node scripts/test-dashboard-nav-connection-browser.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { execSync, spawn } from 'child_process'

const BASE = process.env.TEST_BASE ?? 'http://localhost:3000'
const SOCKET_DIR = '/home/z/my-project/mini-services/socket-server'
let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SHOT = '/home/z/my-project/download'
async function shot(page, name) {
  try { await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false }) } catch {}
}

function socketPid() {
  try {
    const out = execSync("ss -tlnp | grep ':3003 '").toString()
    const m = out.match(/pid=(\d+)/)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

async function socketServiceUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://localhost:3003/socket.io/?EIO=4&transport=polling')
      if (res.ok) return true
    } catch { /* down */ }
    await sleep(500)
  }
  return false
}

function startSocketServer() {
  const child = spawn('bun', ['run', 'index.ts'], {
    cwd: SOCKET_DIR,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (err) => pageErrors.push(String(err)))

async function loginViaUI(_sharedCtx, username, viewport = { width: 1280, height: 800 }) {
  // هر نقش در context مجزا — کاربر واردشده از /login هدایت می‌شود
  const ctxLocal = await browser.newContext({ viewport })
  const p = await ctxLocal.newPage()
  p.on('pageerror', (err) => pageErrors.push(String(err)))
  await p.goto(`${BASE}/login`)
  await p.fill('#username', username)
  await p.fill('#password', 'Pass@123')
  await p.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await p.click('button[type="submit"]')
  await p.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 })
  return p
}

async function checkDesktopNav(p, { role }) {
  const sidebar = p.locator('aside')
  const hasDashboard = await sidebar.getByText('داشبورد', { exact: true }).count()
  hasDashboard === 0 ? ok('سایدبار دسکتاپ: «داشبورد» حذف شد') : bad('«داشبورد» هنوز در سایدبار دسکتاپ است')
  const hasSettings = await sidebar.getByText('تنظیمات', { exact: true }).count()
  hasSettings === 0 ? ok('سایدبار دسکتاپ: «تنظیمات» از منو حذف شد') : bad('«تنظیمات» هنوز در سایدبار است')
  if (role === 'STUDENT') {
    // «تکالیف» و «حضور و غیاب» از منوها حذف شدند — ادغام در «تقویم آموزشی»
    ;(await sidebar.getByText('تکالیف من').count()) === 0 ? ok('آیتم «تکالیف من» از سایدبار حذف شد (ادغام در تقویم)') : bad('«تکالیف من» هنوز در سایدبار است!')
    ;(await sidebar.getByText('حضور و غیاب من').count()) === 0 ? ok('آیتم «حضور و غیاب من» از سایدبار حذف شد (ادغام در تقویم)') : bad('«حضور و غیاب من» هنوز در سایدبار است!')
    ;(await sidebar.getByText('تقویم آموزشی').count()) > 0 ? ok('آیتم «تقویم آموزشی» (دانش‌آموز) هست') : bad('«تقویم آموزشی» در سایدبار نیست!')
  }
  if (role === 'TEACHER') {
    ;(await sidebar.locator('a', { hasText: 'تکالیف' }).count()) === 0 ? ok('آیتم «تکالیف» (معلم) از سایدبار حذف شد (ادغام در تقویم)') : bad('«تکالیف» هنوز در سایدبار است!')
    ;(await sidebar.getByText('تقویم آموزشی').count()) > 0 ? ok('آیتم «تقویم آموزشی» (معلم) هست') : bad('«تقویم آموزشی» در سایدبار نیست!')
  }
  // آیکون چرخ‌دنده در هدر دسکتاپ (فقط هدر visible در viewport دسکتاپ)
  const gearDesktop = p.locator('header:visible').locator('a[title="تنظیمات"]')
  ;(await gearDesktop.count()) > 0 ? ok('آیکون چرخ‌دنده تنظیمات در هدر دسکتاپ هست') : bad('چرخ‌دنده در هدر دسکتاپ نیست')
}

async function checkMobileNav(p, { role }) {
  const header = p.locator('header').first()
  const gearMobile = header.locator('a[title="تنظیمات"]')
  await gearMobile.first().waitFor({ state: 'visible', timeout: 8000 })
  ok('آیکون چرخ‌دنده تنظیمات در هدر موبایل هست (واقعاً visible)')
  const bottomNav = p.locator('nav[aria-label="ناوبری موبایل"]')
  await bottomNav.waitFor({ state: 'visible', timeout: 8000 })
  const navText = await bottomNav.textContent()
  !navText.includes('داشبورد') ? ok('منوی موبایل: «داشبورد» حذف شد') : bad('«داشبورد» هنوز در منوی موبایل است')
  !navText.includes('تنظیمات') ? ok('منوی موبایل: «تنظیمات» حذف شد') : bad('«تنظیمات» هنوز در منوی موبایل است')
  if (role === 'STUDENT') navText.includes('تکالیف من') ? bad('«تکالیف من» هنوز در منوی موبایل است!') : ok('منوی موبایل دانش‌آموز: «تکالیف من» حذف شد (ادغام در تقویم)')
}

try {
  // ── ۱) دانش‌آموز ──
  section('دانش‌آموز: حذف داشبورد + چرخ‌دنده هدر')
  const ps = await loginViaUI(ctx, 'beheshti.s1')
  await ps.waitForTimeout(800)
  const landed = new URL(ps.url()).pathname
  landed === '/' ? ok('دانش‌آموز پس از ورود به فهرست گفتگوها می‌رود') : bad(`مقصد ورود دانش‌آموز: ${landed}`)
  await ps.goto(`${BASE}/dashboard`)
  await ps.waitForURL((u) => u.pathname === '/', { timeout: 10000 }).catch(() => null)
  new URL(ps.url()).pathname === '/'
    ? ok('دانش‌آموز: /dashboard به گفتگوها هدایت می‌شود')
    : bad('/dashboard برای دانش‌آموز هدایت نشد: ' + ps.url())
  await checkDesktopNav(ps, { role: 'STUDENT' })
  await shot(ps, '120-student-desktop')

  // ── ۲) معلم ──
  section('معلم: حذف داشبورد + چرخ‌دنده هدر')
  const pt = await loginViaUI(ctx, 'beheshti.t1')
  await pt.waitForTimeout(800)
  await pt.goto(`${BASE}/dashboard`)
  await pt.waitForURL((u) => u.pathname === '/', { timeout: 10000 }).catch(() => null)
  new URL(pt.url()).pathname === '/'
    ? ok('معلم: /dashboard به گفتگوها هدایت می‌شود')
    : bad('/dashboard برای معلم هدایت نشد: ' + pt.url())
  await checkDesktopNav(pt, { role: 'TEACHER' })
  await shot(pt, '121-teacher-desktop')

  // ── ۳) مدیر مدرسه: داشبورد ادغام‌شده در مدیریت مدرسه ──
  section('مدیر مدرسه: ادغام داشبورد در مدیریت مدرسه + آمار')
  const pm = await loginViaUI(ctx, 'beheshti.admin')
  await pm.waitForTimeout(800)
  await pm.goto(`${BASE}/dashboard`)
  await pm.waitForURL((u) => u.pathname.startsWith('/modir/classes'), { timeout: 10000 }).catch(() => null)
  new URL(pm.url()).pathname.startsWith('/modir/classes')
    ? ok('مدیر مدرسه: /dashboard به مدیریت مدرسه هدایت می‌شود')
    : bad('/dashboard برای مدیر مدرسه هدایت نشد: ' + pm.url())
  const h1 = await pm.locator('h1').first().textContent()
  h1?.includes('مدیریت مدرسه') ? ok('عنوان صفحه «مدیریت مدرسه» است') : bad('عنوان صفحه: ' + h1)
  // آمار مدرسه — ۴ کارت با اعداد
  await pm.locator('span.text-2xl').first().waitFor({ state: 'visible', timeout: 10000 })
  const statsText = await pm.locator('div.grid.grid-cols-2').first().textContent()
  const statLabels = ['کلاس‌ها', 'گروه‌های درسی', 'معلمان', 'دانش‌آموزان']
  let statOk = true
  for (const l of statLabels) if (!statsText.includes(l)) statOk = false
  statOk ? ok('آمار مدرسه نمایش داده شد: ' + statLabels.join('، ')) : bad('آمار ناقص: ' + statsText.slice(0, 120))
  const statNumbers = await pm.locator('span.text-2xl').allTextContents()
  const allNumeric = statNumbers.length >= 4 && statNumbers.every((t) => /[۰-۹0-9]/.test(t))
  allNumeric ? ok(`اعداد آمار واقعی‌اند: ${statNumbers.join('، ')}`) : bad('اعداد آمار نامعتبر: ' + statNumbers.join('، '))
  // دکمه کاربران
  const usersBtn = pm.locator('a[href="/modir/users"]').first()
  ;(await usersBtn.count()) > 0 ? ok('دکمه «کاربران» در مدیریت مدرسه هست') : bad('دکمه کاربران نیست')
  await usersBtn.click()
  await pm.waitForURL('**/modir/users', { timeout: 10000 })
  ok('دکمه کاربران به /modir/users می‌رود')
  await pm.goBack()
  await pm.waitForURL('**/modir/classes', { timeout: 10000 })
  await checkDesktopNav(pm, { role: 'SCHOOL_ADMIN' })
  const sidebarModir = pm.locator('aside')
  ;(await sidebarModir.getByText('مدیریت مدرسه').count()) > 0
    ? ok('سایدبار مدیر مدرسه: «مدیریت مدرسه» هست')
    : bad('آیتم «مدیریت مدرسه» در سایدبار نیست')
  await shot(pm, '122-modir-merged-dashboard')

  // ── ۴) منوی موبایل هر سه نقش (۳۹۰px) ──
  section('موبایل ۳۹۰px: منو بدون داشبورد/تنظیمات + چرخ‌دنده هدر')
  const pmS = await loginViaUI(null, 'beheshti.s1', { width: 390, height: 844 })
  await pmS.waitForTimeout(600)
  await checkMobileNav(pmS, { role: 'STUDENT' })
  // کلیک چرخ‌دنده → تنظیمات
  await pmS.locator('header').first().locator('a[title="تنظیمات"]').click()
  await pmS.waitForURL('**/settings', { timeout: 10000 })
  ok('کلیک چرخ‌دنده موبایل به /settings می‌رود')
  await shot(pmS, '123-mobile-settings-gear')
  // حالت تاریک موبایل — فهرست گفتگوها با نشان اتصال
  await pmS.evaluate(() => { localStorage.setItem('daniar-theme', 'dark'); localStorage.setItem('theme', 'dark') })
  await pmS.goto(`${BASE}/`)
  await pmS.waitForTimeout(1200)
  await shot(pmS, '124-mobile-dark-chats')

  // ── ۵) وضعیت اتصال سه‌حالته — تست واقعی با قطع/وصل سرویس سوکت ──
  section('وضعیت اتصال: «متصل» با سرویس سالم')
  // صفحه باز دانش‌آموز (دسکتاپ) — زیر کادر جستجو
  const badge = ps.locator('[role="status"][aria-label="اتصال برقرار است"]').first()
  await badge.waitFor({ state: 'visible', timeout: 20000 })
  const badgeText1 = await badge.textContent()
  badgeText1?.includes('متصل') && !badgeText1.includes('تلاش مجدد')
    ? ok('نشان زیر جستجو: «متصل» (بدون عبارت تلاش مجدد)')
    : bad('متن نشان: ' + badgeText1)

  section('قطع واقعی سرویس سوکت → «قطع اتصال»/«درحال اتصال» بدون دکمه')
  const pid = socketPid()
  if (!pid) {
    bad('پیداسازی فرآیند سرویس سوکت روی :3003 ناموفق')
  } else {
    execSync(`kill ${pid}`)
    await sleep(500)
    // بدون رفرش: سوکت قطع می‌شود → نشان باید تغییر کند (قطع یا درحال اتصال)
    const sawDown = await ps
      .waitForSelector(
        '[role="status"][aria-label="اتصال قطع است"], [role="status"][aria-label="در حال اتصال"]',
        { timeout: 30000 },
      )
      .then(() => true)
      .catch(() => false)
    sawDown ? ok('پس از قطع سرویس، نشان به «قطع اتصال»/«درحال اتصال» تغییر کرد') : bad('نشان پس از قطع سرویس تغییر نکرد')
    const downText = await ps.locator('div.p-3.border-b [role="status"]').first().textContent().catch(() => null)
    downText && !downText.includes('تلاش مجدد')
      ? ok('در حالت قطع، عبارت «تلاش مجدد» وجود ندارد: ' + downText.trim())
      : bad('متن حالت قطع: ' + downText)
    // بارگذاری تازه با سرویس ازکارافتاده: باید قطع/درحال اتصال بماند (وضعیت دروغ «متصل» نمایش داده نمی‌شود)
    await ps.reload()
    await sleep(2000)
    const freshDown = await ps
      .waitForSelector(
        '[role="status"][aria-label="اتصال قطع است"], [role="status"][aria-label="در حال اتصال"]',
        { timeout: 30000 },
      )
      .then(() => true)
      .catch(() => false)
    freshDown ? ok('بارگذاری تازه با سرویس قطع: وضعیت واقعی (قطع/درحال اتصال) نمایش داده می‌شود') : bad('بارگذاری تازه: نشان وضعیت قطع نیست')
    await shot(ps, '125-connection-disconnected')

    section('راه‌اندازی دوباره سرویس → تلاش مجدد خودکار → «متصل» بدون رفرش')
    startSocketServer()
    const up = await socketServiceUp()
    up ? ok('سرویس سوکت دوباره بالا آمد') : bad('سرویس سوکت پس از راه‌اندازی بالا نیامد')
    const reconnected = await ps
      .waitForSelector('[role="status"][aria-label="اتصال برقرار است"]', { timeout: 45000 })
      .then(() => true)
      .catch(() => false)
    reconnected
      ? ok('تلاش مجدد خودکار انجام شد — نشان بدون رفرش صفحه به «متصل» برگشت')
      : bad('پس از بالا آمدن سرویس، اتصال خودکار برقرار نشد')
    await shot(ps, '126-connection-reconnected')

    // چت باز معلم: نشان «متصل» فقط زیر کادر جستجوی فهرست است (در سربرگ گفتگو وقتی وصلیم چیزی نیست)
    const connectedCount = await pt.locator('[role="status"][aria-label="اتصال برقرار است"]').count()
    connectedCount === 1
      ? ok('دقیقاً یک نشان «متصل» (زیر کادر جستجو) — بدون نشان اضافه در سربرگ‌ها')
      : bad(`تعداد نشان «متصل»: ${connectedCount} (انتظار: ۱)`)
  }

  // ── جمع‌بندی ──
  section('خطاهای صفحه')
  pageErrors.length === 0 ? ok('بدون pageerror') : bad('pageerror: ' + pageErrors.slice(0, 3).join(' | '))
} finally {
  // اطمینان: سرویس سوکت برای ادامه کار باید بالا بماند
  if (!(await socketServiceUp())) {
    startSocketServer()
    await socketServiceUp()
  }
  await browser.close()
  console.log(`\n════════════════════════`)
  console.log(`نتیجه: ${pass} موفق، ${fail} ناموفق`)
  if (fail > 0) process.exit(1)
}
