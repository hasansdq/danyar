// تست مرورگری UI: نمای متمرکز دانش‌آموز (بدون موزاییک) + قفل دوربین + ترسیم زنده روی تخته سفید
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})

async function makeUser(username, password) {
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    permissions: ['camera', 'microphone'],
  })
  const page = await ctx.newPage()
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#username', { timeout: 30000 })
    await page.waitForTimeout(1200) // اطمینان از hydrate شدن فرم React
    await page.fill('#username', username)
    await page.fill('#password', password)
    await page.click('[role="checkbox"][aria-label="من ربات نیستم"]')
    await Promise.all([
      page.waitForURL((u) => !String(u).includes('/login'), { timeout: 20000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ])
    if (!page.url().includes('/login')) break
    console.log(`  ↻ تلاش مجدد ورود ${username} (سابمیت native قبل از hydrate)`)
  }
  if (page.url().includes('/login')) throw new Error(`ورود ${username} ناموفق: ${page.url()}`)
  return { ctx, page }
}

// ساخت جلسه تست با API معلم
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'beheshti.t1', password: 'Pass@123', realm: 'app' }),
})
const tCookie = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const createRes = await fetch(`${BASE}/api/live-sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: tCookie },
  body: JSON.stringify({ classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryr1000ilokroeeafkaj', title: 'تست UI تخته و نمای دانش‌آموز' }),
})
const created = await createRes.json()
if (!createRes.ok) throw new Error('ساخت جلسه ناموفق: ' + JSON.stringify(created))
const sessionId = created.id
console.log('جلسه UI:', sessionId)

// سه مرورگر: معلم + دو دانش‌آموز
const teacher = await makeUser('beheshti.t1', 'Pass@123')
const s1 = await makeUser('beheshti.s1', 'Pass@123')
const s2 = await makeUser('beheshti.s2', 'Pass@123')

await teacher.page.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
await s1.page.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
await s2.page.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
await teacher.page.waitForTimeout(12000)
await s1.page.waitForTimeout(6000)
await s2.page.waitForTimeout(6000)

// ۱) موزاییک: صفحه معلم کاشی هر دو دانش‌آموز را دارد
const teacherTiles = await teacher.page.evaluate(() => [...document.querySelectorAll('[data-tile-name]')].map((t) => t.getAttribute('data-tile-name')))
check('معلم موزاییک دارد (کاشی دانش‌آموز ۱)', teacherTiles.some((n) => n?.includes('رضا احمدی')), JSON.stringify(teacherTiles))
check('معلم موزاییک دارد (کاشی دانش‌آموز ۲)', teacherTiles.some((n) => n && !n.includes('شما') && !n.includes('رضا احمدی') && !n.includes('موسوی')), JSON.stringify(teacherTiles))

// ۲) نمای دانش‌آموز: کاشی دانش‌آموز دیگر دیده نمی‌شود
const s1Tiles = await s1.page.evaluate(() => [...document.querySelectorAll('[data-tile-name]')].map((t) => t.getAttribute('data-tile-name')))
const s2Name = teacherTiles.find((n) => n && !n.includes('شما') && !n.includes('رضا احمدی') && !n.includes('موسوی')) ?? ''
check('دانش‌آموز کاشی معلم را می‌بیند', s1Tiles.some((n) => n?.includes('موسوی')), JSON.stringify(s1Tiles))
check('دانش‌آموز کاشی خودش را دارد', s1Tiles.some((n) => n?.includes('شما')), JSON.stringify(s1Tiles))
check('دانش‌آموز کاشی دانش‌آموز دیگر را نمی‌بیند (بدون موزاییک)', s2Name === '' || !s1Tiles.some((n) => n === s2Name), `${s2Name} در ${JSON.stringify(s1Tiles)}`)

// ۳) قفل دوربین دانش‌آموز: کلیک → تُست خطا و دوربین روشن نمی‌شود
const camBtn = s1.page.locator('button[aria-label*="دوربین"]').first()
await camBtn.click()
await s1.page.waitForTimeout(1500)
const toastText = await s1.page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent ?? '').join(' | '))
check('تُست نیاز به اجازه معلم نمایش داده شد', toastText.includes('اجازه'), toastText)
const camStillOff = await s1.page.evaluate(() => !document.querySelector('[data-tile-self="1"] [aria-label="روشن‌کردن دوربین"]') ?? true)
// بررسی واقعی: نشان قفل روی دکمه دوربین
const lockBadge = await s1.page.evaluate(() => {
  const btn = [...document.querySelectorAll('footer button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('اجازه معلم'))
  return !!btn && !!btn.querySelector('span span')
})
check('نشان قفل روی دکمه دوربین دانش‌آموز', lockBadge)

// ۴) فعال‌کردن تخته سفید توسط معلم
const wbBtn = teacher.page.locator('button[title="تخته سفید"]').first()
await wbBtn.click()
await teacher.page.waitForTimeout(2500)
const teacherBoard = await teacher.page.evaluate(() => !!document.querySelector('[data-testid="whiteboard"]'))
check('تخته سفید روی صفحه معلم ظاهر شد', teacherBoard)
await s1.page.waitForTimeout(3000)
const s1Board = await s1.page.evaluate(() => !!document.querySelector('[data-testid="whiteboard"]'))
check('تخته سفید روی صفحه دانش‌آموز ظاهر شد', s1Board)
const s1BoardReadonly = await s1.page.evaluate(() => {
  const b = document.querySelector('[data-testid="whiteboard"]')
  return b ? !!b.textContent?.includes('مشاهده') && !b.querySelector('[data-wb-tool]') : false
})
check('تخته برای دانش‌آموز فقط‌مشاهده است (بدون نوار ابزار)', s1BoardReadonly)

// ۵) ترسیم واقعی معلم → پیکسل روی بوم دانش‌آموز
const tCanvas = teacher.page.locator('[data-testid="whiteboard"] canvas').nth(1)
const box = await tCanvas.boundingBox()
if (!box) throw new Error('بوم معلم پیدا نشد')
await teacher.page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3)
await teacher.page.mouse.down()
for (let i = 1; i <= 12; i++) {
  await teacher.page.mouse.move(box.x + box.width * (0.2 + i * 0.04), box.y + box.height * (0.3 + i * 0.03))
  await teacher.page.waitForTimeout(40)
}
await teacher.page.mouse.up()
await teacher.page.waitForTimeout(2000)

const teacherPixels = await teacher.page.evaluate(() => {
  const c = document.querySelectorAll('[data-testid="whiteboard"] canvas')[0]
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let non = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) non++
  return non
})
check('ترسیم معلم روی بوم خودش ثبت شد', teacherPixels > 100, `nonWhite=${teacherPixels}`)

const s1Pixels = await s1.page.evaluate(() => {
  const c = document.querySelectorAll('[data-testid="whiteboard"] canvas')[0]
  if (!c) return -1
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let non = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) non++
  return non
})
check('ترسیم معلم بلادرنگ روی بوم دانش‌آموز ظاهر شد', s1Pixels > 100, `nonWhite=${s1Pixels}`)

// ۶) بستن تخته توسط معلم → از صفحه دانش‌آموز حذف می‌شود
await teacher.page.locator('button[title="بستن تخته سفید"]').first().click()
await s1.page.waitForTimeout(2500)
const s1BoardGone = await s1.page.evaluate(() => !document.querySelector('[data-testid="whiteboard"]'))
check('بستن تخته → از صفحه دانش‌آموز حذف شد', s1BoardGone)

// اسکرین‌شات‌ها
await teacher.page.screenshot({ path: '/home/z/my-project/download/test-wb-teacher.png' })
await s1.page.screenshot({ path: '/home/z/my-project/download/test-wb-student.png' })

// پاک‌سازی: پایان جلسه
await fetch(`${BASE}/api/live-sessions/${sessionId}/end`, { method: 'POST', headers: { cookie: tCookie } })

await browser.close()
console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`)
process.exit(fail > 0 ? 1 : 0)
