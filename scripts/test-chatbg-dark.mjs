/**
 * E2E پس‌زمینه چت موبایل جداگانه برای حالت روشن/تیره — واقعی از UI
 *  ۱) پنل ظاهر: دو بخش مجزای «پس‌زمینه حالت روشن» و «پس‌زمینه حالت تیره»
 *  ۲) آپلود تصویر روشن و تصویر تیره متفاوت از UI
 *  ۳) سوییچ تم زنده: تغییر تم سیستم (prefers-color-scheme) با چت باز →
 *     تعویض خودکار پس‌زمینه بدون رفرش (مسیر واقعی next-themes system)
 *  ۴) موبایل: سوییچ تم با دکمه واقعی از هدر → چت با تصویر همان حالت
 *  ۵) سازگاری: حذف تصویر تیره → حالت تیره به تصویر روشن برمی‌گردد
 *  ۶) پاک‌سازی کامل
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { writeFileSync } from 'fs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let PASS = 0, FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// دو PNG کوچک ۱×۱ با رنگ متفاوت (آبی روشن / سرمه‌ای تیره)
const LIGHT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqsvPFwAEwAGjSWDiAAAAAElFTkSuQmCC',
  'base64',
)
const DARK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNko2X/PwAEgAGKSUVvAAAAAElFTkSuQmCC',
  'base64',
)

async function login(page, username, password, realm = 'app') {
  const path = realm === 'super' ? '/superadmin' : '/login'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
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

/** باز کردن اولین گفتگو از فهرست (آیتم‌ها button داخل ul هستند) */
async function openFirstChat(page) {
  await page.waitForSelector('ul.divide-y li button', { timeout: 25000 })
  await page.locator('ul.divide-y li button').first().click()
  await page.waitForSelector('.chat-messages-bg', { timeout: 20000 })
}

const browser = await chromium.launch()
const pageErrors = []
try {
  // ─── ۱) پنل ظاهر: دو بخش مجزا ───
  console.log('══ ۱) پنل ظاهر — دو بخش مجزای روشن/تیره ══')
  const su = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 }, colorScheme: 'light' })
  const suPage = await su.newPage()
  suPage.on('pageerror', (e) => pageErrors.push(e.message))
  await login(suPage, 'superadmin', 'Admin@1234', 'super')
  await suPage.goto(`${BASE}/admin/appearance`, { waitUntil: 'domcontentloaded' })
  await suPage.waitForSelector('h1:has-text("ظاهر و اسپلش")', { timeout: 30000 })

  ;(await suPage.getByText('پس‌زمینه حالت روشن', { exact: true }).count()) === 1
    ? ok('بخش «پس‌زمینه حالت روشن» در پنل دیده می‌شود')
    : bad('بخش حالت روشن دیده نشد')
  ;(await suPage.getByText('پس‌زمینه حالت تیره', { exact: true }).count()) === 1
    ? ok('بخش «پس‌زمینه حالت تیره» در پنل دیده می‌شود')
    : bad('بخش حالت تیره دیده نشد')
  ;(await suPage.getByRole('button', { name: 'آپلود تصویر روشن' }).count()) === 1
    ? ok('دکمه «آپلود تصویر روشن» مجزا وجود دارد')
    : bad('دکمه آپلود روشن یافت نشد')
  ;(await suPage.getByRole('button', { name: 'آپلود تصویر تیره' }).count()) === 1
    ? ok('دکمه «آپلود تصویر تیره» مجزا وجود دارد')
    : bad('دکمه آپلود تیره یافت نشد')
  await suPage.getByText('با سوییچ تم کاربر، پس‌زمینه چت هم').waitFor({ timeout: 5000 })
    .then(() => ok('توضیح تعویض خودکار با تم نمایش داده می‌شود'))
    .catch(() => bad('توضیح تعویض خودکار نمایش داده نشد'))

  // ─── ۲) آپلود دو تصویر متفاوت از UI ───
  console.log('══ ۲) آپلود دو تصویر متفاوت ══')
  const lightInput = suPage.locator('input[type="file"]').nth(1) // فونت (۰) → چت روشن (۱) → چت تیره (۲) → اسپلش (۳)
  await lightInput.setInputFiles({ name: 'bg-light.png', mimeType: 'image/png', buffer: LIGHT_PNG })
  await suPage.getByText('پس‌زمینه چت (حالت روشن) فعال شد').waitFor({ timeout: 15000 })
  ok('تصویر روشن آپلود و فعال شد')
  const darkInput = suPage.locator('input[type="file"]').nth(2)
  await darkInput.setInputFiles({ name: 'bg-dark.png', mimeType: 'image/png', buffer: DARK_PNG })
  await suPage.getByText('پس‌زمینه چت (حالت تیره) فعال شد').waitFor({ timeout: 15000 })
  ok('تصویر تیره آپلود و فعال شد')

  // پیش‌نمایش‌ها: تصویر روشن در قاب سفید + تصویر تیره در قاب تیره
  const lightImg = suPage.locator('img[alt="پس‌زمینه چت — حالت روشن"]')
  const darkImg = suPage.locator('img[alt="پس‌زمینه چت — حالت تیره"]')
  ;(await lightImg.count()) === 1 ? ok('پیش‌نمایش تصویر روشن رندر شد') : bad('پیش‌نمایش روشن یافت نشد')
  ;(await darkImg.count()) === 1 ? ok('پیش‌نمایش تصویر تیره رندر شد') : bad('پیش‌نمایش تیره یافت نشد')

  // وضعیت سرور: دو کلید متفاوت
  const st = await (await suPage.request.get(`${BASE}/api/admin/branding`)).json()
  const keyL = st.settings?.chatBgKey ?? ''
  const keyD = st.settings?.chatBgDarkKey ?? ''
  keyL && keyD && keyL !== keyD
    ? ok('سرور: دو کلید متفاوت برای روشن/تیره ثبت شد')
    : bad(`کلیدها: L=${keyL} D=${keyD}`)

  // payload عمومی (احرازشده): دو URL
  const pub = await (await suPage.request.get(`${BASE}/api/branding`)).json()
  pub.chatBgUrl?.includes('chatbg-') && pub.chatBgDarkUrl?.includes('chatbgdark-')
    ? ok('payload عمومی: chatBgUrl و chatBgDarkUrl جدا')
    : bad(`payload: ${pub.chatBgUrl} / ${pub.chatBgDarkUrl}`)
  const urlL = pub.chatBgUrl
  const urlD = pub.chatBgDarkUrl

  // فایل‌ها واقعاً سرو می‌شوند (باگ قبلی انکود اسلش)
  const stL = await (await suPage.request.get(`${BASE}${urlL}`)).status()
  const stD = await (await suPage.request.get(`${BASE}${urlD}`)).status()
  stL === 200 && stD === 200 ? ok('هر دو تصویر از مسیر asset واقعاً سرو می‌شوند (۲۰۰)') : bad(`asset status: ${stL}/${stD}`)
  await su.close()

  // ─── ۳) سوییچ تم زنده در چت باز (موبایل ۳۹۰px — تم سیستم) ───
  console.log('══ ۳) تعویض خودکار زنده با تم سیستم (چت باز، بدون رفرش) ══')
  const t = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
    isMobile: true,
    hasTouch: true,
  })
  const tp = await t.newPage()
  tp.on('pageerror', (e) => pageErrors.push(e.message))
  await login(tp, 'beheshti.t1', 'Pass@123')
  // تم سیستم (پیش‌فرض next-themes) — با تغییر prefers-color-scheme زنده سوییچ می‌شود
  await tp.evaluate(() => localStorage.removeItem('theme'))
  await tp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await openFirstChat(tp)
  const bgOf = () => tp.evaluate(() => getComputedStyle(document.querySelector('.chat-messages-bg')).backgroundImage)
  const htmlDark = () => tp.evaluate(() => document.documentElement.classList.contains('dark'))

  let bg = await bgOf()
  bg.includes('chatbg-') && !bg.includes('chatbgdark-') && !(await htmlDark())
    ? ok('تم سیستم روشن: پس‌زمینه چت = تصویر روشن')
    : bad(`bg روشن: ${bg.slice(0, 80)} dark=${await htmlDark()}`)

  // تغییر تم سیستم (CDP setEmulatedMedia) → next-themes زنده کلاس dark را می‌گذارد → CSS خودکار عوض می‌شود
  const cdp = await tp.context().newCDPSession(tp)
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  for (let i = 0; i < 20 && !(await htmlDark()); i++) await sleep(200)
  bg = await bgOf()
  ;(await htmlDark()) && bg.includes('chatbgdark-')
    ? ok('تم سیستم تیره → پس‌زمینه خودکار به تصویر تیره عوض شد (زنده، بدون رفرش)')
    : bad(`bg تیره: ${bg.slice(0, 80)} dark=${await htmlDark()}`)

  // بازگشت به روشن — باز هم زنده
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  for (let i = 0; i < 20 && (await htmlDark()); i++) await sleep(200)
  bg = await bgOf()
  ;!(await htmlDark()) && bg.includes('chatbg-') && !bg.includes('chatbgdark-')
    ? ok('تم سیستم روشن → پس‌زمینه خودکار به تصویر روشن برگشت')
    : bad(`bg روشن۲: ${bg.slice(0, 80)} dark=${await htmlDark()}`)
  await t.close()

  // ─── ۴) موبایل: سوییچ تم با دکمه واقعی از هدر ───
  console.log('══ ۴) موبایل — سوییچ تم با دکمه واقعی ══')
  const m = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true })
  const mp = await m.newPage()
  mp.on('pageerror', (e) => pageErrors.push(e.message))
  await login(mp, 'beheshti.t1', 'Pass@123')
  await mp.evaluate(() => localStorage.setItem('theme', 'light'))
  await mp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await mp.waitForTimeout(1200)
  await openFirstChat(mp)
  let mbg = await mp.evaluate(() => getComputedStyle(document.querySelector('.chat-messages-bg')).backgroundImage)
  mbg.includes('chatbg-') && !mbg.includes('chatbgdark-')
    ? ok('موبایل روشن: چت با تصویر روشن')
    : bad(`موبایل bg روشن: ${mbg.slice(0, 80)}`)
  const chatUrl = mp.url()
  // بازگشت → سوییچ تم از هدر خانه (دکمه واقعی next-themes) → ورود دوباره به همان چت
  await mp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await mp.waitForTimeout(900)
  await mp.locator('button[aria-label="تغییر حالت روشن و تاریک"]').first().click()
  await sleep(700)
  ;(await mp.evaluate(() => document.documentElement.classList.contains('dark')))
    ? ok('دکمه سوییچ تم: حالت تیره فعال شد')
    : bad('کلاس dark پس از کلیک فعال نشد')
  await mp.goto(chatUrl, { waitUntil: 'domcontentloaded' })
  await mp.waitForSelector('.chat-messages-bg', { timeout: 20000 })
  mbg = await mp.evaluate(() => getComputedStyle(document.querySelector('.chat-messages-bg')).backgroundImage)
  mbg.includes('chatbgdark-')
    ? ok('پس از سوییچ تم، چت با تصویر تیره باز شد')
    : bad(`موبایل bg تیره: ${mbg.slice(0, 80)}`)
  await m.close()

  // ─── ۵) سازگاری: حذف تصویر تیره → fallback به تصویر روشن ───
  console.log('══ ۵) سازگاری fallback ══')
  const su2 = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } })
  const su2Page = await su2.newPage()
  su2Page.on('pageerror', (e) => pageErrors.push(e.message))
  await login(su2Page, 'superadmin', 'Admin@1234', 'super')
  await su2Page.goto(`${BASE}/admin/appearance`, { waitUntil: 'domcontentloaded' })
  await su2Page.waitForSelector('h1:has-text("ظاهر و اسپلش")', { timeout: 30000 })
  // حذف تصویر تیره (دکمه حذف داخل بخش تیره)
  const darkSection = su2Page.locator('div.rounded-lg.border', { hasText: 'پس‌زمینه حالت تیره' })
  await darkSection.getByRole('button', { name: 'حذف', exact: true }).click()
  await su2Page.getByText('پس‌زمینه حالت تیره حذف شد').waitFor({ timeout: 10000 })
  ok('تصویر تیره حذف شد')
  // پیام fallback در قاب تیره
  await su2Page.getByText('همان تصویر روشن با لایه تیره استفاده می‌شود').waitFor({ timeout: 5000 })
    .then(() => ok('قاب تیره پیام fallback را نشان می‌دهد'))
    .catch(() => bad('پیام fallback نمایش داده نشد'))
  // در چتِ تیره: همان تصویر روشن (بدون chatbgdark)
  const st2 = await (await su2Page.request.get(`${BASE}/api/branding`)).json()
  st2.chatBgDarkUrl === st2.chatBgUrl && st2.chatBgUrl?.includes('chatbg-')
    ? ok('payload: با حذف تصویر تیره، chatBgDarkUrl = chatBgUrl (fallback)')
    : bad(`fallback payload: ${st2.chatBgDarkUrl} vs ${st2.chatBgUrl}`)

  const t2 = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true })
  const t2p = await t2.newPage()
  t2p.on('pageerror', (e) => pageErrors.push(e.message))
  await login(t2p, 'beheshti.t1', 'Pass@123')
  await t2p.evaluate(() => localStorage.setItem('theme', 'dark'))
  await t2p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await t2p.waitForTimeout(1000)
  await openFirstChat(t2p)
  const bgFallback = await t2p.evaluate(() => getComputedStyle(document.querySelector('.chat-messages-bg')).backgroundImage)
  bgFallback.includes('chatbg-') && !bgFallback.includes('chatbgdark-')
    ? ok('حالت تیره بدون تصویر اختصاصی: همان تصویر روشن با لایه تیره (سازگار با قبل)')
    : bad(`bg fallback: ${bgFallback.slice(0, 80)}`)
  await t2.close()

  // ─── ۶) پاک‌سازی کامل ───
  console.log('══ ۶) پاک‌سازی ══')
  await su2Page.locator('div.rounded-lg.border', { hasText: 'پس‌زمینه حالت روشن' }).getByRole('button', { name: 'حذف', exact: true }).click()
  await su2Page.getByText('پس‌زمینه حالت روشن حذف شد').waitFor({ timeout: 10000 })
  const st3 = await (await su2Page.request.get(`${BASE}/api/admin/branding`)).json()
  !st3.settings?.chatBgKey && !st3.settings?.chatBgDarkKey
    ? ok('پاک‌سازی: هر دو پس‌زمینه حذف شدند')
    : bad(`پاک‌سازی ناقص: ${st3.settings?.chatBgKey} / ${st3.settings?.chatBgDarkKey}`)
  await su2.close()

  pageErrors.length === 0 ? ok('صفر خطای JS صفحه') : bad(`${pageErrors.length} خطای JS: ${pageErrors[0]}`)
} finally {
  await browser.close()
}

console.log(`\n=== نتیجه: ${PASS} پاس / ${FAIL} شکست ===`)
writeFileSync('/tmp/chatbg-dark-test.json', JSON.stringify({ pass: PASS, fail: FAIL }))
process.exit(FAIL > 0 ? 1 : 0)
