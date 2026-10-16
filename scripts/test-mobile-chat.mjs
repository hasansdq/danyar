/**
 * E2E موبایل — چت‌ها:
 *  ۱) هدر چت و مسیج‌کامپوزر هنگام اسکرول پیام‌ها ثابت می‌مانند (viewport موبایل)
 *  ۲) انتخابگر ایموجی: انتخاب چندتایی بدون بستن + بستن با لمس بیرون پنل
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-mobile-chat.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE || 'http://localhost:81'
const SHOT = '/home/z/my-project/download'
let pass = 0
let fail = 0
const results = []
const check = (name, ok, extra = '') => {
  results.push(`  ${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  ok ? pass++ : fail++
}

const browser = await chromium.launch()
// شبیه‌سازی موبایل واقعی — لمس + viewport کوچک
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'fa-IR',
})
const page = await ctx.newPage()
page.setDefaultTimeout(30000)
// پوشش خطای dev در Next فقط در حالت توسعه است و مانع لمس می‌شود — در تست مخفی می‌کنیم
await page.addInitScript(() => {
  const style = document.createElement('style')
  style.textContent = 'nextjs-portal{display:none!important;pointer-events:none!important}'
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
  if (document.head) document.head.appendChild(style)
})

try {
  // ─── ورود ───
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#username', { timeout: 60000 })
  // پروب hydration: تیک ربات تا پاسخ دادن (پس از آن fill‌ها توسط React پاک نمی‌شوند)
  const robotBtn = page.locator('button[role="checkbox"][aria-label="من ربات نیستم"]')
  for (let i = 0; i < 15; i++) {
    await robotBtn.click().catch(() => {})
    if ((await robotBtn.getAttribute('aria-checked')) === 'true') break
    await page.waitForTimeout(400)
  }
  await page.fill('#username', 'beheshti.admin')
  await page.fill('#password', 'Pass@123')
  // اگر رندر مجدد تیک را پاک کرد دوباره بزن
  for (let i = 0; i < 5; i++) {
    if ((await robotBtn.getAttribute('aria-checked')) === 'true') break
    await robotBtn.click().catch(() => {})
    await page.waitForTimeout(300)
  }
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })

  // ─── ورود به یک گفتگوی گروهی ───
  // شناسه یک گفتگوی گروهی از API
  const groupId = await page.evaluate(async () => {
    const r = await fetch('/api/chats', { cache: 'no-store' })
    const d = await r.json()
    const g = (d.conversations ?? []).find((c) => c.type === 'GROUP')
    return g?.id ?? null
  })
  if (!groupId) throw new Error('گفتگوی گروهی یافت نشد')
  await page.goto(BASE + '/chats/group/' + groupId, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('header h1', { timeout: 30000 })
  // صبر برای بارگذاری پیام‌ها و اتصال سوکت
  await page.waitForTimeout(3000)

  // هدر گفتگو — header خودِ چت (هدر دسکتاپ اپ‌شل در موبایل display:none است)
  const header = page.locator('header:has(h1)').first()
  const composer = page.locator('textarea[aria-label="متن پیام"]')
  await composer.waitFor({ timeout: 30000 })

  const boxOf = async (loc) => {
    const b = await loc.boundingBox()
    return b ? { x: Math.round(b.x), y: Math.round(b.y), h: Math.round(b.height) } : null
  }

  const headerBefore = await boxOf(header)
  const composerBefore = await boxOf(composer)
  check('هدر بالای viewport است', headerBefore && headerBefore.y >= 0 && headerBefore.y < 80, JSON.stringify(headerBefore))

  // ─── ۱) اسکرول پیام‌ها — هدر و کامپوزر نباید جابجا شوند ───
  const scroller = page.locator('div.flex-1.overflow-y-auto').first()
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight // تا پایین
  })
  await page.waitForTimeout(500)
  const headerMid = await boxOf(header)
  const composerMid = await boxOf(composer)
  await scroller.evaluate((el) => {
    el.scrollTop = 0 // تا بالا
  })
  await page.waitForTimeout(500)
  const headerAfter = await boxOf(header)
  const composerAfter = await boxOf(composer)
  const winY = await page.evaluate(() => window.scrollY)
  const docScrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  )

  check('هدر پس از اسکرول ثابت است', JSON.stringify(headerBefore) === JSON.stringify(headerAfter), `${JSON.stringify(headerBefore)} → ${JSON.stringify(headerAfter)}`)
  check('کامپوزر پس از اسکرول ثابت است', JSON.stringify(composerBefore) === JSON.stringify(composerAfter), `${JSON.stringify(composerBefore)} → ${JSON.stringify(composerAfter)}`)
  check('کامپوزر داخل viewport دیده می‌شود', composerAfter && composerAfter.y + composerAfter.h <= 845, `y=${composerAfter?.y} h=${composerAfter?.h}`)
  check('بدنه صفحه اسکرول نمی‌شود (winY=0)', winY === 0, `scrollY=${winY}`)
  check('سند کلی قابل اسکرول نیست', docScrollable <= 0, `overflow=${docScrollable}px`)

  await page.screenshot({ path: SHOT + '/mobile-chat-fixed.png' })

  // ─── ۲) ایموجی: انتخاب چندتایی + بستن با لمس بیرون ───
  const smileBtn = page.locator('button[aria-label="افزودن ایموجی"]')
  await smileBtn.tap()
  const panelTitle = page.locator('text=ایموجی‌ها').first()
  await panelTitle.waitFor({ timeout: 10000 })
  check('پنل ایموجی باز شد', await panelTitle.isVisible())

  const emojiBtns = page.locator('button[aria-label^="ایموجی"]')
  const e1 = (await emojiBtns.nth(0).textContent())?.trim()
  const e2 = (await emojiBtns.nth(3).textContent())?.trim()
  const e3 = (await emojiBtns.nth(7).textContent())?.trim()
  // dispatchEvent مستقل از پایداری المان (کامپوزر با هر درج رندر مجدد می‌شود)
  const pickEmoji = async (i) => {
    await emojiBtns.nth(i).dispatchEvent('click')
    await page.waitForTimeout(200)
  }
  await pickEmoji(0)
  await pickEmoji(3)
  await pickEmoji(7)

  const txt = await composer.inputValue()
  check('هر سه ایموجی بدون بستن پنل درج شدند', txt.includes(e1) && txt.includes(e2) && txt.includes(e3), `"${txt}"`)
  check('پنل پس از سه انتخاب همچنان باز است', await panelTitle.isVisible().catch(() => false))

  await page.screenshot({ path: SHOT + '/mobile-emoji-multi.png' })

  // لمس بیرون پنل → بستن
  await header.tap()
  await page.waitForTimeout(600)
  const panelGone = !(await panelTitle.isVisible().catch(() => false))
  check('پنل با لمس بیرون بسته شد', panelGone)

  // دکمه بستن هم کار می‌کند
  await smileBtn.tap()
  await panelTitle.waitFor({ timeout: 5000 })
  await page.locator('button[aria-label="بستن ایموجی‌ها"]').tap()
  await page.waitForTimeout(500)
  check('پنل با دکمه بستن بسته شد', !(await panelTitle.isVisible().catch(() => false)))

  await page.screenshot({ path: SHOT + '/mobile-emoji-closed.png' })
} catch (e) {
  fail++
  results.push(`  ❌ خطای غیرمنتظره: ${e.message}`)
  await page.screenshot({ path: SHOT + '/mobile-chat-error.png' }).catch(() => {})
} finally {
  await browser.close()
}

console.log('\n═══ نتیجه تست موبایل چت ═══')
console.log(results.join('\n'))
console.log(`\n  ${pass} موفق / ${fail} ناموفق`)
process.exit(fail > 0 ? 1 : 0)
