/**
 * E2E — چهار قابلیت جدید گفتگوی گروهی (درخواست کاربر):
 *  ۱) هدر گروه قابل کلیک → اعضا → کلیک روی نام عضو → چت خصوصی
 *     (دانش‌آموز فقط با اجازه «محدودیت گروه‌ها» می‌تواند با هم‌کلاسی‌ها گفتگو کند)
 *  ۲) تنظیمات گروه توسط مدیر/معلم: قفل گروه برای دانش‌آموزان (آیکون قفل در هدر)،
 *     تغییر نام، تغییر تصویر پروفایل گروه
 *  ۳) جست‌وجوی درون گروهی با آیکون ذره‌بین در هدر
 *  ۴) نوار پیام سنجاق‌شده با عنوان تکلیف/نمونه‌سؤال/اطلاعیه + برداشتن سنجاق با ضربدر
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-group-chat-features.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE || 'http://localhost:81'
const SHOT = '/home/z/my-project/download'
const GID = process.env.TEST_GID || 'cmv1aryqy000elokrx43nz39n' // ریاضی هفتم۱
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

async function api(page, path, opts = {}) {
  return page.evaluate(
    async ({ path, opts }) => {
      const res = await fetch(path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      })
      let data = null
      try {
        data = await res.json()
      } catch {}
      return { status: res.status, data }
    },
    { path, opts },
  )
}

async function login(page, username, password) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#username', { timeout: 60000 })
  // فرم قبل از hydration مقدار را پاک می‌کند — پس از تیک ربات، مقدارها دوباره پر می‌شود
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.fill('#username', username)
    await page.fill('#password', password)
    const robotBtn = page.locator('button[role="checkbox"][aria-label="من ربات نیستم"]')
    for (let i = 0; i < 12; i++) {
      await robotBtn.click().catch(() => {})
      if ((await robotBtn.getAttribute('aria-checked')) === 'true') break
      await page.waitForTimeout(400)
    }
    const checked = (await robotBtn.getAttribute('aria-checked')) === 'true'
    const u = await page.inputValue('#username')
    if (checked && u === username) break
    await page.waitForTimeout(600)
  }
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
}

const browser = await chromium.launch()
const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const adminPage = await adminCtx.newPage()
adminPage.setDefaultTimeout(30000)
// پورتال توسعه nextjs لمس/کلیک را نمی‌دزدد
await adminPage.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {})

const GROUP_NAME_ORIG = 'ریاضی هفتم۱'

try {
  // ═══ بخش ۰ — ورود مدیر و وضعیت اولیه ═══
  step('ورود مدیر مدرسه (beheshti.admin)')
  await login(adminPage, 'beheshti.admin', 'Pass@123')
  check('ورود مدیر موفق', !adminPage.url().includes('/login'))

  const conv0 = await api(adminPage, `/api/chats/group/${GID}/messages`)
  check('گروه آزمون در دسترس است', conv0.status === 200, conv0.data?.conversation?.title ?? '')
  const originalPolicy = conv0.data.conversation.policy
  step(`سیاست اولیه گروه: ${originalPolicy}`)

  // بازگردانی وضعیت پاک از اجراهای قبلی: نام گروه
  if (conv0.data.conversation.title !== GROUP_NAME_ORIG) {
    await api(adminPage, `/api/groups/${GID}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: GROUP_NAME_ORIG }),
    })
    step('نام گروه به حالت اول بازگردانده شد')
  }
  // اطمینان از وضعیت پاک: سیاست ALL و بدون تصویر
  if (originalPolicy !== 'ALL') {
    await api(adminPage, `/api/groups/${GID}`, {
      method: 'PATCH',
      body: JSON.stringify({ messagePolicy: 'ALL' }),
    })
  }

  // یک پیام متنی ساده از دانش‌آموز برای سنجاق UI — اگر نبود، مدیر می‌فرستد
  const msgs0 = await api(adminPage, `/api/chats/group/${GID}/messages?limit=50`)
  const messages0 = msgs0.data.messages ?? []
  const annMsg = messages0.find((m) => m.type === 'ANNOUNCEMENT' && !m.deletedAt)
  const asgMsg = messages0.find((m) => m.type === 'ASSIGNMENT' && !m.deletedAt)
  check('پیام اطلاعیه برای آزمون سنجاق موجود است', !!annMsg)
  check('پیام تکلیف برای آزمون سنجاق موجود است', !!asgMsg)

  // ═══ بخش ۱ — هدر گروه قابل کلیک → اعضا (مدیر) ═══
  step('باز کردن صفحه گروه و دیالوگ اعضا')
  await adminPage.goto(`${BASE}/chats/group/${GID}`, { waitUntil: 'domcontentloaded' })
  await adminPage.waitForSelector('[data-testid="group-header"]', { timeout: 30000 })
  await adminPage.waitForTimeout(1200)

  await adminPage.click('[data-testid="group-header"]')
  const dlg = adminPage.locator('[role="dialog"]')
  await dlg.waitFor({ state: 'visible', timeout: 15000 })
  await dlg.locator('text=دانش‌آموزان').first().waitFor({ timeout: 15000 })
  const dlgText = await dlg.innerText()
  check('دیالوگ اعضا با نام گروه باز شد', dlgText.includes(GROUP_NAME_ORIG))
  check('بخش معلمان با رضا موسوی', dlgText.includes('رضا موسوی'))
  check('بخش دانش‌آموزان — ۴ عضو', dlgText.includes('دانش‌آموزان — ۴'), '')
  check('دکمه تنظیمات گروه در دیالوگ (مدیر)', dlgText.includes('تنظیمات گروه'))
  await adminPage.screenshot({ path: `${SHOT}/group-members-admin.png` })

  // کلیک روی نام معلم → گفتگوی خصوصی
  const t1Id = 'cmv1aryqu0004lokr2m5tu9sk'
  await dlg.locator('button').filter({ hasText: 'رضا موسوی' }).first().click()
  await adminPage.waitForURL((u) => u.pathname === `/chats/dm/${t1Id}`, { timeout: 20000 })
  check('کلیک روی معلم → گفتگوی خصوصی', adminPage.url().includes(`/chats/dm/${t1Id}`))

  // ═══ بخش ۲ — تنظیمات گروه: نام، تصویر، قفل ═══
  step('تنظیمات گروه — تغییر نام')
  await adminPage.goto(`${BASE}/chats/group/${GID}`, { waitUntil: 'domcontentloaded' })
  await adminPage.waitForSelector('[data-testid="group-settings"]', { timeout: 30000 })
  await adminPage.waitForTimeout(1000)
  await adminPage.click('[data-testid="group-settings"]')
  const setDlg = adminPage.locator('[role="dialog"]')
  await setDlg.waitFor({ state: 'visible', timeout: 15000 })
  await setDlg.locator('#group-name-input').waitFor({ timeout: 10000 })

  const tmpName = `ریاضی هفتم۱ ⭐ ${Date.now() % 10000}`
  await setDlg.locator('#group-name-input').fill(tmpName)
  await setDlg.locator('button[aria-label="ذخیره نام گروه"]').click()
  await adminPage.waitForTimeout(1200)
  const h1Text = await adminPage.locator('h1').first().innerText()
  check('نام گروه در هدر به‌روزرسانی شد', h1Text.includes(tmpName), h1Text)

  step('تنظیمات گروه — تصویر پروفایل')
  // ساخت تصویر PNG کوچک (۱×۱ قرمز)
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const fs = await import('fs')
  fs.writeFileSync('/tmp/group-avatar.png', Buffer.from(pngBase64, 'base64'))
  await setDlg.locator('input[type="file"]').setInputFiles('/tmp/group-avatar.png')
  await adminPage.waitForTimeout(1800)
  let headerImg = adminPage.locator('header img')
  const imgCount = await headerImg.count()
  check('تصویر گروه در هدر نمایش داده شد', imgCount > 0, 'header img')
  await adminPage.screenshot({ path: `${SHOT}/group-settings.png` })

  if (imgCount > 0) {
    await setDlg.locator('button:has-text("حذف تصویر")').click()
    await adminPage.waitForTimeout(1500)
    headerImg = adminPage.locator('header img')
    check('حذف تصویر گروه', (await headerImg.count()) === 0)
  }

  // بستن دیالوگ تنظیمات قبل از آزمون قفل (اوورلی دیالوگ کلیک را می‌دزدد)
  await adminPage.keyboard.press('Escape')
  await setDlg.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  await adminPage.waitForTimeout(500)

  step('قفل گروه برای دانش‌آموزان (آیکون قفل هدر)')
  const lockBtn = adminPage.locator('[data-testid="group-lock-toggle"]')
  await lockBtn.click()
  await adminPage.waitForTimeout(1200)
  const lockIcon = await adminPage
    .locator('[data-testid="group-header"] svg.lucide-lock')
    .count()
  check('آیکون قفل در هدر ظاهر شد', lockIcon > 0)
  const convLocked = await api(adminPage, `/api/chats/group/${GID}/messages`)
  check('سیاست گروه STAFF شد (سرور)', convLocked.data?.conversation?.policy === 'STAFF')

  // باز کردن قفل با همان دکمه
  await lockBtn.click()
  await adminPage.waitForTimeout(1200)
  const convUnlocked = await api(adminPage, `/api/chats/group/${GID}/messages`)
  check('برداشتن قفل با کلیک دوباره', convUnlocked.data?.conversation?.policy === 'ALL')

  // بازگرداندن نام
  await adminPage.click('[data-testid="group-settings"]')
  await setDlg.locator('#group-name-input').waitFor({ timeout: 10000 })
  await setDlg.locator('#group-name-input').fill(GROUP_NAME_ORIG)
  await setDlg.locator('button[aria-label="ذخیره نام گروه"]').click()
  await adminPage.waitForTimeout(1000)
  await adminPage.keyboard.press('Escape')
  await adminPage.waitForTimeout(400)

  // ═══ بخش ۳ — جست‌وجوی درون گروهی ═══
  step('جست‌وجوی درون گروهی (ذره‌بین هدر)')
  await adminPage.click('[data-testid="group-search-toggle"]')
  const searchPanel = adminPage.locator('[data-testid="group-search-panel"]')
  await searchPanel.waitFor({ state: 'visible', timeout: 10000 })
  await adminPage.fill('[data-testid="group-search-input"]', 'کسرها')
  await adminPage.locator('[data-testid="group-search-hit"]').first().waitFor({ timeout: 15000 })
  const hitCount = await adminPage.locator('[data-testid="group-search-hit"]').count()
  check('نتایج جست‌وجوی درون گروهی نمایش داده شد', hitCount > 0, `${hitCount} نتیجه`)
  await adminPage.screenshot({ path: `${SHOT}/group-search.png` })

  // کلیک روی نتیجه → پنل بسته می‌شود و به پیام پرش می‌شود
  await adminPage.locator('[data-testid="group-search-hit"]').first().click()
  await adminPage.waitForTimeout(1500)
  check('پنل جست‌وجو پس از انتخاب بسته شد', (await searchPanel.count()) === 0)

  // ═══ بخش ۴ — نوار سنجاق با عنوان تکلیف/اطلاعیه ═══
  step('سنجاق پیام تکلیف — نمایش عنوان')
  await api(adminPage, `/api/messages/${asgMsg.id}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned: true }),
  })
  await api(adminPage, `/api/messages/${annMsg.id}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned: true }),
  })
  await adminPage.reload({ waitUntil: 'domcontentloaded' })
  await adminPage.waitForTimeout(1500)
  const pinBar = adminPage.locator('text=پیام سنجاق‌شده').first()
  await pinBar.waitFor({ state: 'visible', timeout: 15000 })
  const barText1 = await adminPage
    .locator('div.border-amber-500\\/30')
    .first()
    .innerText()
    .catch(() => '')
  check('نوار سنجاق نمایش داده شد', barText1.includes('پیام سنجاق‌شده'))
  // جدیدترین سنجاق اول نمایش داده می‌شود (اطلاعیه بعد از تکلیف سنجاق شده)
  check('عنوان اطلاعیه در نوار سنجاق (اطلاعیه: …)', barText1.includes('اطلاعیه:'), barText1.slice(0, 90))
  await adminPage.screenshot({ path: `${SHOT}/group-pinned-title.png` })

  // سنجاق بعدی → تکلیف با عنوان واقعی از دیتابیس
  await adminPage.locator('button[aria-label="سنجاق بعدی"]').click()
  await adminPage.waitForTimeout(500)
  const barText2 = await adminPage
    .locator('div.border-amber-500\\/30')
    .first()
    .innerText()
    .catch(() => '')
  check('سنجاق بعدی → تکلیف با عنوان', barText2.includes('تکلیف:'), barText2.slice(0, 90))

  // برداشتن سنجاق پیام فعلی (تکلیف) با ضربدر
  await adminPage.locator('button[aria-label="برداشتن سنجاق"]').click()
  await adminPage.waitForTimeout(1200)
  const barAfter1 = await adminPage
    .locator('div.border-amber-500\\/30')
    .first()
    .innerText()
    .catch(() => '')
  check('برداشتن سنجاق تکلیف با ضربدر', !barAfter1.includes('تکلیف:'), barAfter1.slice(0, 90))

  // پاک‌سازی سنجاق اطلاعیه (از طریق API)
  await api(adminPage, `/api/messages/${annMsg.id}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned: false }),
  })

  // ═══ بخش ۵ — معلم: تنظیمات گروه و قفل ═══
  const tCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const tPage = await tCtx.newPage()
  tPage.setDefaultTimeout(30000)
  step('ورود معلم (beheshti.t1) — تنظیمات گروه')
  await login(tPage, 'beheshti.t1', 'Pass@123')
  await tPage.goto(`${BASE}/chats/group/${GID}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-testid="group-settings"]', { timeout: 30000 })
  await tPage.waitForTimeout(1000)
  check('معلم دکمه تنظیمات دارد', (await tPage.locator('[data-testid="group-settings"]').count()) > 0)
  check('معلم دکمه قفل دارد', (await tPage.locator('[data-testid="group-lock-toggle"]').count()) > 0)

  // قفل گروه توسط معلم
  await tPage.locator('[data-testid="group-lock-toggle"]').click()
  await tPage.waitForTimeout(1200)
  const convT = await api(tPage, `/api/chats/group/${GID}/messages`)
  check('معلم گروه را قفل کرد (سرور)', convT.data?.conversation?.policy === 'STAFF')
  // باز کردن قفل توسط معلم
  await tPage.locator('[data-testid="group-lock-toggle"]').click()
  await tPage.waitForTimeout(1200)
  const convT2 = await api(tPage, `/api/chats/group/${GID}/messages`)
  check('معلم قفل را برداشت (سرور)', convT2.data?.conversation?.policy === 'ALL')

  // جست‌وجو برای معلم هم کار می‌کند
  await tPage.click('[data-testid="group-search-toggle"]')
  await tPage.fill('[data-testid="group-search-input"]', 'کسرها')
  await tPage.locator('[data-testid="group-search-hit"]').first().waitFor({ timeout: 15000 })
  check('جست‌وجوی درون گروهی برای معلم', true)

  // هدر → اعضا → دکمه تنظیمات
  await tPage.click('[data-testid="group-header"]')
  const tDlg = tPage.locator('[role="dialog"]')
  await tDlg.waitFor({ state: 'visible', timeout: 15000 })
  await tDlg.locator('text=دانش‌آموزان').first().waitFor({ timeout: 15000 })
  await tDlg.locator('button:has-text("تنظیمات گروه")').click()
  await tPage.waitForTimeout(800)
  check('دکمه تنظیمات در دیالوگ اعضا (معلم)', (await tPage.locator('#group-name-input').count()) > 0)
  await tPage.screenshot({ path: `${SHOT}/group-teacher-settings.png` })
  await tCtx.close()

  // ═══ بخش ۶ — دانش‌آموز: محدودیت چت خصوصی + قفل گروه ═══
  const sCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const sPage = await sCtx.newPage()
  sPage.setDefaultTimeout(30000)
  step('ورود دانش‌آموز (beheshti.s1) — محدودیت گروه‌ها')
  await login(sPage, 'beheshti.s1', 'Pass@123')
  await sPage.goto(`${BASE}/chats/group/${GID}`, { waitUntil: 'domcontentloaded' })
  await sPage.waitForSelector('[data-testid="group-header"]', { timeout: 30000 })
  await sPage.waitForTimeout(1200)

  // دانش‌آموز دکمه تنظیمات/قفل ندارد
  check('دانش‌آموز دکمه تنظیمات ندارد', (await sPage.locator('[data-testid="group-settings"]').count()) === 0)
  check('دانش‌آموز دکمه قفل ندارد', (await sPage.locator('[data-testid="group-lock-toggle"]').count()) === 0)

  await sPage.click('[data-testid="group-header"]')
  const sDlg = sPage.locator('[role="dialog"]')
  await sDlg.waitFor({ state: 'visible', timeout: 15000 })
  await sDlg.locator('text=دانش‌آموزان').first().waitFor({ timeout: 15000 })
  const sDlgText = await sDlg.innerText()
  check('یادداشت محدودیت برای دانش‌آموز', sDlgText.includes('گفتگوی خصوصی بین دانش‌آموزان توسط مدیر مدرسه فعال نشده'))
  const s2Btn = sDlg.locator('button').filter({ hasText: 'مینا نظری' })
  check('هم‌کلاسی با محدودیت فعال غیرقابل کلیک است', (await s2Btn.count()) === 0)
  await sPage.screenshot({ path: `${SHOT}/student-members-restricted.png` })

  // معلم گروه برای دانش‌آموز قابل کلیک است
  await sDlg.locator('button').filter({ hasText: 'رضا موسوی' }).first().click()
  await sPage.waitForURL((u) => u.pathname === `/chats/dm/${t1Id}`, { timeout: 20000 })
  check('کلیک روی معلم → گفتگوی خصوصی (دانش‌آموز)', sPage.url().includes(`/chats/dm/${t1Id}`))

  // مدیر «محدودیت گروه‌ها» را فعال می‌کند → هم‌کلاسی‌ها قابل کلیک
  step('فعال‌سازی محدودیت گروه‌ها توسط مدیر → هم‌کلاسی قابل کلیک')
  const adminApiCtx = adminPage // نشست مدیر هنوز زنده است
  const dmOn = await api(adminApiCtx, '/api/classes', {
    method: 'PATCH',
    body: JSON.stringify({ allowStudentDm: true }),
  })
  check('کلید سراسری allowStudentDm فعال شد', dmOn.status === 200)

  await sPage.goto(`${BASE}/chats/group/${GID}`, { waitUntil: 'domcontentloaded' })
  await sPage.waitForSelector('[data-testid="group-header"]', { timeout: 30000 })
  await sPage.waitForTimeout(1200)
  await sPage.click('[data-testid="group-header"]')
  const sDlg2 = sPage.locator('[role="dialog"]')
  await sDlg2.waitFor({ state: 'visible', timeout: 15000 })
  await sDlg2.locator('text=دانش‌آموزان').first().waitFor({ timeout: 15000 })
  const s2Btn2 = sDlg2.locator('button').filter({ hasText: 'مینا نظری' })
  check('هم‌کلاسی پس از فعال‌سازی قابل کلیک است', (await s2Btn2.count()) > 0)
  await sPage.screenshot({ path: `${SHOT}/student-members-allowed.png` })
  await s2Btn2.first().click()
  await sPage.waitForURL((u) => u.pathname.startsWith('/chats/dm/'), { timeout: 20000 })
  check('کلیک روی هم‌کلاسی → گفتگوی خصوصی', sPage.url().includes('/chats/dm/'))

  // قفل گروه برای دانش‌آموز — نوار «ارسال مجاز نیست» + آیکون قفل
  step('قفل گروه برای دانش‌آموز')
  await api(adminApiCtx, `/api/groups/${GID}`, {
    method: 'PATCH',
    body: JSON.stringify({ messagePolicy: 'STAFF' }),
  })
  await sPage.goto(`${BASE}/chats/group/${GID}`, { waitUntil: 'domcontentloaded' })
  await sPage.waitForSelector('[data-testid="group-header"]', { timeout: 30000 })
  await sPage.waitForTimeout(1500)
  const blockedText = sPage.locator('text=ارسال پیام در این گروه برای دانش‌آموزان مجاز نیست')
  check('کامپوزر دانش‌آموز در گروه قفل بلاک شد', (await blockedText.count()) > 0)
  const stuLockIcon = await sPage
    .locator('[data-testid="group-header"] svg.lucide-lock')
    .count()
  check('آیکون قفل برای دانش‌آموز هم در هدر دیده می‌شود', stuLockIcon > 0)
  await sPage.screenshot({ path: `${SHOT}/student-locked-group.png` })

  // بازگردانی وضعیت
  await api(adminApiCtx, `/api/groups/${GID}`, {
    method: 'PATCH',
    body: JSON.stringify({ messagePolicy: 'ALL' }),
  })
  await api(adminApiCtx, '/api/classes', {
    method: 'PATCH',
    body: JSON.stringify({ allowStudentDm: false }),
  })
  const finConv = await api(adminApiCtx, `/api/chats/group/${GID}/messages`)
  check('بازگردانی سیاست گروه به ALL', finConv.data?.conversation?.policy === 'ALL')
  sCtx.close()
} catch (err) {
  fail++
  results.push(`  ❌ خطای غیرمنتظره: ${err.message}`)
  console.error(err)
} finally {
  console.log('\n══════════ نتایج آزمون ══════════')
  for (const r of results) console.log(r)
  console.log(`\nمجموع: ${pass} سبز / ${fail} قرمز`)
  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
}
