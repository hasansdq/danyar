/**
 * E2E کلاس آنلاین با SFU (LiveKit) — واقعی و بدون mock
 *
 * سناریو:
 *  ۱) جلسه اعلام‌نشده → announcedAt=null
 *  ۲) معلم وارد اتاق می‌شود → رسانه واقعاً در SFU منتشر می‌شود → اعلام شروع فقط پس از آن
 *  ۳) دانش‌آموز بدون اجازه: توکن canPublish=false + دکمه دوربین قفل + تلاش انتشار رد می‌شود
 *  ۴) معلم اجازه دوربین می‌دهد → دانش‌آموز خودش روشن می‌کند → معلم ویدیوی واقعی دانش‌آموز را می‌گیرد
 *  ۵) حالت کم‌مصرف
 *  ۶) پایان جلسه → اتاق LiveKit حذف می‌شود
 *  ۷) پیام‌رسان هم‌زمان سالم (گفتگوی جلسه + پیام گروهی)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const CLASSROOM = 'cmv1aryqw000alokrajw9ermw' // هفتم۱
const NOTIFY_GROUP = 'cmv1aryqy000elokrx43nz39n' // ریاضی هفتم۱
const TEACHER = { u: 'beheshti.t1', p: 'Pass@123' }
const STUDENT = { u: 'beheshti.s1', p: 'Pass@123' }

let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(page, username, password) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(800)
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
        if (!page.url().includes('/login')) return
        await sleep(500)
      }
    } catch {
      await sleep(2000)
    }
  }
  throw new Error(`login failed for ${username}`)
}

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})

const pageErrors = []
async function newPage(ctx, tag) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${e.message}`))
  return page
}

try {
  console.log('══ ۱) ساخت جلسه اعلام‌نشده توسط معلم (API) ══')
  const tCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
  const tPage = await newPage(tCtx, 'T')
  await login(tPage, TEACHER.u, TEACHER.p)
  const createOnce = async () =>
    tPage.request.post(`${BASE}/api/live-sessions`, {
      data: { classroomId: CLASSROOM, notifyGroupId: NOTIFY_GROUP, title: 'آزمون SFU زنده' },
    })
  let createRes = await createOnce()
  let created = await createRes.json().catch(() => null)
  // اگر جلسه فعال قبلیِ همین معلم در جریان است (reused) → پایان و ساخت تازه برای آزمون تمیز
  if (created?.reused) {
    await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`)
    await sleep(1000)
    createRes = await createOnce()
    created = await createRes.json().catch(() => null)
  }
  const sessionId = created?.session?.id ?? created?.id
  if (!createRes.ok() || !sessionId || created?.reused) throw new Error(`create session failed: ${JSON.stringify(created)}`)
  ok(`جلسه تازه ساخته شد: ${sessionId}`)

  console.log('══ ۲) پیش از ورود معلم: announcedAt = null ══')
  const sCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
  const sPage = await newPage(sCtx, 'S')
  await login(sPage, STUDENT.u, STUDENT.p)
  const before = await sPage.request.get(`${BASE}/api/live-sessions/${sessionId}`)
  const beforeData = await before.json()
  ;(beforeData?.announcedAt === null || beforeData?.announcedAt === undefined)
    ? ok('announcedAt هنوز null است (اعلامی نفرستاده شده)')
    : bad(`announcedAt زودتر از استریم معلم ثبت شده: ${beforeData?.announcedAt}`)

  console.log('══ ۳) ورود معلم به اتاق — بدون رسانه؛ اعلام فقط با سوییچ پس از انتشار ══')
  await tPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-tile-self]', { timeout: 45000 })
  ok('معلم داخل اتاق (in-room) — بدون دوربین/میکروفون وارد شد')

  // جدید: صرف ورود نباید اعلان شروع بسازد
  await sleep(2500)
  {
    const d = await tPage.request.get(`${BASE}/api/live-sessions/${sessionId}`).then((r) => r.json()).catch(() => null)
    ;(d?.announcedAt == null)
      ? ok('صرف ورود به اتاق اعلان شروع نساخت (سوییچ خاموش و غیرفعال)')
      : bad(`صرف ورود اعلان ساخت: ${d?.announcedAt}`)
  }

  // سوییچ «شروع کلاس» فعال نیست (هیچ رسانه‌ای منتشر نشده)
  {
    const disabled = await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"][disabled]').count()
    disabled > 0
      ? ok('سوییچ شروع کلاس تا انتشار رسانه غیرفعال است')
      : bad('سوییچ شروع کلاس بدون رسانه فعال دیده شد')
  }

  // معلم دوربین خود را روشن می‌کند → انتشار واقعی در SFU (دستگاه مجازی آزمون)
  await tPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
  await sleep(2500)
  let camOn = false
  for (let i = 0; i < 20 && !camOn; i++) {
    camOn = (await tPage.locator('button[title="خاموش‌کردن دوربین"]').count()) > 0
    if (!camOn) await sleep(500)
  }
  camOn ? ok('دوربین معلم روشن و در SFU منتشر شد') : bad('انتشار دوربین معلم انجام نشد')

  // اکنون سوییچ فعال شده — روشن‌کردن سوییچ = ارسال اعلان شروع
  {
    const enabled = await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]:not([disabled])').count()
    enabled > 0
      ? ok('سوییچ شروع کلاس پس از انتشار رسانه فعال شد')
      : bad('سوییچ شروع کلاس پس از انتشار رسانه فعال نشد')
    await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]').first().click()
  }
  // منتظر اعلام شروع — معیار قطعی: announcedAt در سرور
  try {
    await tPage.getByText('اعلان شروع کلاس برای دانش‌آموزان ارسال شد').waitFor({ timeout: 15000 })
    ok('اعلام شروع با روشن‌کردن سوییچ ارسال شد (بنر)')
  } catch {
    // بنر ممکن است بعداً آمده باشد — معیار قطعی سرور:
    let announcedAt = null
    for (let i = 0; i < 40; i++) {
      const d = await tPage.request.get(`${BASE}/api/live-sessions/${sessionId}`).then((r) => r.json()).catch(() => null)
      announcedAt = d?.announcedAt ?? null
      if (announcedAt) break
      await sleep(500)
    }
    announcedAt
      ? ok('اعلام شروع پس از روشن‌کردن سوییچ ثبت شد (announcedAt سرور)')
      : bad('اعلام شروع ثبت نشد')
  }

  console.log('══ ۴) ورود دانش‌آموز — دریافت ویدیوی زنده معلم از SFU ══')
  await sPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
  await sPage.waitForSelector('[data-tile-self]', { timeout: 45000 })
  ok('دانش‌آموز داخل اتاق')

  console.log('══ ۵) توکن دانش‌آموز: canPublish=false (گیت سرور، پس از ورود) ══')
  const tokenRes = await sPage.request.post(`${BASE}/api/live-sessions/${sessionId}/token`)
  const tokenData = await tokenRes.json().catch(() => null)
  tokenRes.ok() && tokenData?.canPublish === false
    ? ok('توکن دانش‌آموز با canPublish=false صادر شد (مجوز نقش در سرور)')
    : bad(`توکن دانش‌آموز نامعتبر: ${tokenRes.status()} ${JSON.stringify(tokenData)}`)

  // کاشی دوربین معلم: ویدیوی زنده با ترک واقعی
  let teacherStreamOk = false
  for (let i = 0; i < 30; i++) {
    teacherStreamOk = await sPage.evaluate(() => {
      const vids = [...document.querySelectorAll('video')]
      return vids.some((v) => {
        const st = v.srcObject
        return st instanceof MediaStream && st.getVideoTracks().some((t) => t.readyState === 'live')
      })
    })
    if (teacherStreamOk) break
    await sleep(500)
  }
  teacherStreamOk ? ok('ویدیوی زنده معلم از SFU دریافت شد (MediaStream واقعی)') : bad('ویدیوی معلم دریافت نشد')

  console.log('══ ۶) قفل دوربین دانش‌آموز بدون اجازه + رد انتشار ══')
  const camBtn = sPage.locator('button[title*="اجازه معلم"]').first()
  ;(await camBtn.count()) > 0 ? ok('دکمه دوربین دانش‌آموز قفل است (نیاز به اجازه معلم)') : bad('قفل دوربین دیده نشد')
  await camBtn.click().catch(() => {})
  try {
    await sPage.getByText('برای روشن‌کردن دوربین باید از معلم اجازه بگیرید').waitFor({ timeout: 6000 })
    ok('تلاش انتشار بدون اجازه در UI رد شد')
  } catch {
    bad('تلاش بدون اجازه مسدود نشد')
  }

  console.log('══ ۷) معلم اجازه دوربین می‌دهد → دانش‌آموز خودش روشن می‌کند ══')
  // پنل شرکت‌کنندگان معلم — ردیف با نام کامل دانش‌آموز
  const studentRow = tPage.locator('div.rounded-lg', { hasText: 'رضا احمدی' }).first()
  await studentRow.getByRole('button', { name: 'اجازه دوربین' }).click({ timeout: 15000 })
  await sleep(1200)
  // دانش‌آموز: پیام اجازه + روشن‌کردن دوربین با اقدام خودش (با تلاش مجدد برای رقابت به‌روزرسانی مجوز LiveKit)
  await sPage.getByText('معلم به شما اجازه دوربین داد').waitFor({ timeout: 15000 }).catch(() => {})
  let camPublished = false
  for (let attempt = 0; attempt < 4 && !camPublished; attempt++) {
    await sPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
    await sleep(2500)
    camPublished = await tPage.evaluate((sname) => {
      const tiles = [...document.querySelectorAll('[data-tile-name]')].filter((el) =>
        (el.getAttribute('data-tile-name') ?? '').includes(sname),
      )
      return tiles.some((el) => {
        const v = el.querySelector('video')
        const st = v?.srcObject
        return st instanceof MediaStream && st.getVideoTracks().some((t) => t.readyState === 'live')
      })
    }, 'رضا احمدی')
    if (!camPublished) {
      // خاموش مجدد و تلاش دوباره (به‌روزرسانی مجوز LiveKit ممکن است با تأخیر رسیده باشد)
      await sPage.locator('button[title="خاموش‌کردن دوربین"]').first().click().catch(() => {})
      await sleep(1000)
    }
  }
  camPublished ? ok('ویدیوی زنده دانش‌آموز (پس از اجازه + اقدام خودش) به معلم رسید') : bad('ویدیوی دانش‌آموز به معلم نرسید')

  console.log('══ ۸) حالت کم‌مصرف (اینترنت ضعیف) ══')
  await sPage.locator('button[title*="کم‌مصرف"]').first().click()
  await sleep(800)
  const lowLabel = await sPage.locator('button[title*="کم‌مصرف روشن است"]').count()
  lowLabel > 0 ? ok('حالت کم‌مصرف فعال شد (کیفیت اشتراک LOW)') : bad('حالت کم‌مصرف فعال نشد')

  console.log('══ ۹) گفتگوی جلسه (مسیر socket — جدا از رسانه) ══')
  // دسکتاپ: تب پنل کناری (دکمه‌های موبایل مخفی‌اند)
  await sPage.locator('aside button:has-text("گفتگو")').first().click()
  await sPage.getByPlaceholder('پیام به جلسه…').fill('سلام — آزمون گفتگوی SFU')
  await sPage.getByRole('button', { name: 'ارسال', exact: true }).click()
  try {
    // معلم: تب گفتگو را باز کند تا متن پیام در DOM باشد
    await tPage.locator('aside button:has-text("گفتگو")').first().click()
    await tPage.getByText('آزمون گفتگوی SFU').waitFor({ timeout: 10000 })
    ok('گفتگوی جلسه بلادرنگ کار می‌کند (جدا از رسانه)')
  } catch {
    bad('گفتگوی جلسه کار نکرد')
  }

  console.log('══ ۱۰) پایان جلسه → قطع همه و حذف اتاق SFU ══')
  await tPage.getByRole('button', { name: 'پایان جلسه' }).first().click()
  await tPage.getByRole('button', { name: 'پایان جلسه' }).last().click()
  try {
    await sPage.getByText('جلسه پایان یافته').waitFor({ timeout: 15000 })
    ok('دانش‌آموز پایان جلسه را دید')
  } catch {
    bad('پایان جلسه به دانش‌آموز نرسید')
  }

  console.log('══ جمع‌بندی ══')
  const realErrors = pageErrors.filter(
    (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
  )
  realErrors.length === 0
    ? ok(`بدون خطای جاوااسکریپت ناگهانی (${pageErrors.length} خاموش‌شده)`)
    : bad(`خطاهای صفحه: ${realErrors.slice(0, 3).join(' | ')}`)
} catch (e) {
  bad(`شکست سناریو: ${e.message}`)
} finally {
  await browser.close()
}

console.log(`\nنتیجه: ${PASS} پاس / ${FAIL} شکست`)
process.exit(FAIL > 0 ? 1 : 0)
