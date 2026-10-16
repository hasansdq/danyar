/**
 * تست E2E — دو اصلاح کاربر:
 *  ۱) جست‌وجوی سرچ‌بار گفتگوها فقط در «نام» گفتگوها/گروه‌ها — نه محتوای پیام‌ها
 *  ۲) چت در پیش‌نمایش زنده: اتصال سوکت (نشان «متصل») + ارسال واقعی پیام
 *
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-search-and-preview.mjs
 *       TEST_BASE=https://preview-chat-… node scripts/test-search-and-preview.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const USER = process.env.TEST_USER ?? 'beheshti.s1'
const PASS = 'Pass@123'
const MARKER = `پروب‌جست‌وجو-${Date.now()}`

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOT = '/home/z/my-project/download'
const TAG = BASE.includes('preview') ? 'preview' : 'local'
async function shot(page, name) {
  try { await page.screenshot({ path: `${SHOT}/${name}-${TAG}.png`, fullPage: false }) } catch {}
}

/* API کوکی‌دار برای آماده‌سازی داده واقعی */
async function apiLogin() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS, realm: 'app' }),
  })
  return (res.headers.get('set-cookie') ?? '').split(';')[0]
}
async function apiGet(cookie, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie } })
  return res.json().catch(() => ({}))
}
async function apiPost(cookie, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

async function fillHydrated(locator, value) {
  for (let i = 0; i < 12; i++) {
    await locator.click()
    await locator.fill('')
    await locator.fill(value)
    if ((await locator.inputValue()) === value) return
    await sleep(700)
  }
  throw new Error('fill never stuck')
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('response', (r) => {
  if (r.request().method() === 'POST' && r.url().includes('/messages'))
    console.log(`  [NET] POST ${r.url().replace(BASE, '')} → ${r.status()}`)
})
page.on('requestfailed', (r) => {
  if (r.url().includes('/messages'))
    console.log(`  [NET-FAIL] ${r.request().method()} ${r.url().replace(BASE, '')} → ${r.failure()?.errorText}`)
})

try {
  /* آماده‌سازی: پیام با محتوای یکتا در گروه ریاضی (برای اثبات اینکه جست‌وجو آن را نمی‌بیند) */
  section('آماده‌سازی: پیام یکتا در گروه درسی (محتوای جست‌وجوناشدنی)')
  const cookie = await apiLogin()
  const chats = await apiGet(cookie, '/api/chats')
  const math = (chats.conversations ?? []).find((c) => c.title?.includes('ریاضی'))
  if (!math) throw new Error('گروه ریاضی برای کاربر یافت نشد')
  const sent = await apiPost(cookie, `/api/chats/group/${math.id}/messages`, {
    body: `${MARKER} کسرهای تجربی`,
    clientId: `probe-${Date.now()}`,
  })
  sent.status === 201 ? ok('پیام مرجع در گروه ارسال شد') : bad(`ارسال پیام مرجع: ${sent.status}`)

  /* ورود UI */
  section(`ورود ${USER} از ${BASE}`)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await fillHydrated(page.locator('#username'), USER)
  await fillHydrated(page.locator('#password'), PASS)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 25000 })
  await page.waitForSelector('[aria-label="جست‌وجو"]', { timeout: 20000 })
  ok('ورود و بارگذاری صفحه گفتگوها')

  /* ۱) نشان اتصال: متصل */
  section('وضعیت اتصال پیام‌رسان')
  let connected = false
  for (let i = 0; i < 20 && !connected; i++) {
    const txt = await page.locator('span', { hasText: /^(متصل|درحال اتصال|قطع اتصال)/ }).allTextContents().catch(() => [])
    connected = txt.some((t) => t.includes('متصل') && !t.includes('درحال'))
    if (!connected) await sleep(1000)
  }
  connected ? ok('نشان اتصال به «متصل» رسید') : bad('نشان اتصال «متصل» نشد')
  const connectTexts = await page
    .locator('span', { hasText: /^(متصل|درحال اتصال|قطع اتصال)/ })
    .allTextContents()
    .catch(() => [])
  !connectTexts.some((t) => t.includes('قطع'))
    ? ok('هیچ نشان «قطع اتصال» نمایش داده نمی‌شود')
    : bad(`نشان قطع دیده شد: ${JSON.stringify(connectTexts)}`)

  /* ۲) جست‌وجوی محتوای پیام → هیچ نتیجه‌ای */
  section('جست‌وجوی محتوای پیام → نتیجه‌ای یافت نشد')
  const search = page.getByLabel('جست‌وجو')
  await fillHydrated(search, MARKER)
  await sleep(1200) // debounce 350ms + شبکه
  const msgHeader = await page.getByText('پیام‌ها', { exact: true }).count()
  msgHeader === 0
    ? ok('بخش «پیام‌ها» در نتایج وجود ندارد')
    : bad('بخش «پیام‌ها» هنوز در نتایج است')
  const noResult = await page.getByText('نتیجه‌ای یافت نشد').count()
  noResult > 0
    ? ok('جست‌وجوی متن درون پیام → «نتیجه‌ای یافت نشد»')
    : bad('محتوای پیام جست‌وجو شد؟')
  await shot(page, '148-search-no-content')

  /* ۳) جست‌وجوی نام گفتگو → فقط گفتگوها */
  section('جست‌وجوی نام گفتگو → فقط گفتگوها')
  await fillHydrated(search, 'ریاضی')
  await sleep(1200)
  const convHeader = await page.getByText('گفتگوها', { exact: true }).count()
  convHeader > 0 ? ok('سربرگ «گفتگوها» در نتایج هست') : bad('سربرگ گفتگوها نیست')
  const results = await page.locator('button', { hasText: 'ریاضی' }).count()
  results > 0 ? ok(`نتایج نام گفتگو: ${results} مورد`) : bad('جست‌وجوی نام گفتگو نتیجه‌ای نداشت')
  const msgHeader2 = await page.getByText('پیام‌ها', { exact: true }).count()
  msgHeader2 === 0 ? ok('باز هم هیچ بخش «پیام‌ها» وجود ندارد') : bad('بخش پیام‌ها برگشته')
  await shot(page, '149-search-by-name')

  /* ۴) پاک‌سازی جست‌وجو و ارسال واقعی پیام از UI */
  section('چت واقعی: باز کردن گفتگو و ارسال پیام از UI')
  await fillHydrated(search, '')
  await sleep(400)
  await page.locator('ul.divide-y > li button', { hasText: 'ریاضی' }).first().click()
  await page.waitForURL((u) => /\/chats\/(group|dm)\//.test(u.pathname), { timeout: 15000 })
  ok('گفتگو باز شد: ' + new URL(page.url()).pathname)
  const composer = page.locator('textarea').first()
  await composer.waitFor({ state: 'visible', timeout: 10000 })
  // صبر برای پایداری layout (بارگذاری پیام‌ها و اسکرول) تا کلیک/کلید به هدف بخورد
  await sleep(2000)
  const UI_MSG = `سلام از ${TAG} — ${Date.now()}`
  await fillHydrated(composer, UI_MSG)
  const sendResp = page
    .waitForResponse(
      (r) => r.url().includes('/messages') && r.request().method() === 'POST' && r.status() === 201,
      { timeout: 15000 },
    )
    .catch(() => null)
  // ارسال با Enter (مسیر رسمی کامپوزر: onKeyDown → doSend) — مستقل از موقعیت دکمه
  await composer.press('Enter')
  const resp = await sendResp
  // مرجع نهایی: خود API — پیام با متن ما باید در گفتگو ثبت شده باشد
  let apiConfirmed = false
  for (let i = 0; i < 10 && !apiConfirmed; i++) {
    await sleep(800)
    const msgs = await apiGet(cookie, page.url().replace(BASE, '').replace(/^\/chats\//, '/api/chats/') + '/messages?limit=10')
    apiConfirmed = (msgs.messages ?? []).some((m) => m.body === UI_MSG)
  }
  if (resp && apiConfirmed) ok('پیام از UI ارسال شد (POST 201 + تأیید API)')
  else if (apiConfirmed) ok('پیام از UI ارسال شد (تأیید API؛ رویداد پاسخ درخواست ثبت نشد)')
  else bad('پیام ارسال و ثبت نشد')
  await shot(page, '150-chat-works')

  /* سلامت */
  pageErrors.length === 0
    ? ok('صفر خطای pageerror')
    : bad(`${pageErrors.length} خطا: ${pageErrors.slice(0, 2).join(' | ')}`)
} catch (err) {
  bad(`استثنای کلی: ${err.message}`)
  try { await shot(page, '150-error') } catch {}
} finally {
  await browser.close()
}

console.log(`\n═══ [${TAG}] نتیجه: ${pass} ✅ / ${fail} ❌ ═══`)
process.exit(fail > 0 ? 1 : 0)
