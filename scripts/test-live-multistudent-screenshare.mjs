/**
 * E2E کلاس آنلاین — معلم + ۳ دانش‌آموز هم‌زمان + دوربین + اشتراک دسکتاپ
 *
 * سناریوی کامل خواستهٔ کاربر:
 *  ۱) معلم جلسه می‌سازد، وارد می‌شود، دوربین را روشن و «شروع کلاس» را اعلام می‌کند
 *  ۲) سه دانش‌آموز (s1, s2, s3) وارد می‌شوند — همه ویدیوی زندهٔ دوربین معلم را می‌گیرند
 *  ۳) معلم دسکتاپ خود را اشتراک می‌گذارد (getDisplayMedia واقعی با auto-select)
 *  ۴) هر سه دانش‌آموز: استریم صفحه را می‌گیرند + نمایشگر اصلی به «صفحهٔ معلم» سوئیچ می‌کند
 *     + دوربین معلم همچنان در کاشی کوچک پایین دیده می‌شود
 *  ۵) معلم اشتراک صفحه را پایان می‌دهد → نمایشگر اصلی دانش‌آموز به دوربین معلم برمی‌گردد
 *  ۶) گفتگوی جلسه از دانش‌آموز → معلم می‌رسد
 *  ۷) پایان جلسه → هر سه دانش‌آموز «جلسه پایان یافته» را می‌بینند
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
const CLASSROOM = 'cmv1aryqw000alokrajw9ermw' // هفتم۱
const NOTIFY_GROUP = 'cmv1aryqy000elokrx43nz39n' // ریاضی هفتم۱
const TEACHER = { u: 'beheshti.t1', p: 'Pass@123', name: 'رضا موسوی' }
const STUDENTS = [
  { u: 'beheshti.s1', p: 'Pass@123', name: 'رضا احمدی' },
  { u: 'beheshti.s2', p: 'Pass@123', name: 'مینا نظری' },
  { u: 'beheshti.s3', p: 'Pass@123', name: 'سینا جعفری' },
]

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

/** آیا کاشی با نام/نوع داده‌شده ویدیوی زندهٔ واقعی دارد؟ */
async function tileHasLiveVideo(page, name, kind) {
  return page.evaluate(
    ({ name, kind }) => {
      const tiles = [...document.querySelectorAll('[data-tile-name]')].filter((el) =>
        (el.getAttribute('data-tile-name') ?? '').includes(name),
      )
      const matches = tiles.filter((el) => (el.getAttribute('data-tile-kind') ?? '') === kind)
      return matches.some((el) => {
        const v = el.querySelector('video')
        const st = v?.srcObject
        return st instanceof MediaStream && st.getVideoTracks().some((t) => t.readyState === 'live')
      })
    },
    { name, kind },
  )
}

const pageErrors = []
async function newPage(ctx, tag) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${e.message}`))
  return page
}

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    // انتخاب خودکار منبع کپچر صفحه بدون دیالوگ — برای اشتراک دسکتاپ معلم
    '--auto-select-desktop-capture-source=Entire screen',
  ],
})

try {
  console.log('══ ۱) ساخت جلسه و ورود معلم ══')
  const tCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
  const tPage = await newPage(tCtx, 'T')
  await login(tPage, TEACHER.u, TEACHER.p)
  const createOnce = async () =>
    tPage.request.post(`${BASE}/api/live-sessions`, {
      data: { classroomId: CLASSROOM, notifyGroupId: NOTIFY_GROUP, title: 'آزمون کامل: دوربین + دسکتاپ' },
    })
  let createRes = await createOnce()
  let created = await createRes.json().catch(() => null)
  if (created?.reused) {
    await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`)
    await sleep(1200)
    createRes = await createOnce()
    created = await createRes.json().catch(() => null)
  }
  const sessionId = created?.session?.id ?? created?.id
  if (!createRes.ok() || !sessionId || created?.reused) throw new Error(`create session failed: ${JSON.stringify(created)}`)
  ok(`جلسه ساخته شد: ${sessionId}`)

  await tPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-tile-self]', { timeout: 45000 })
  ok('معلم داخل اتاق')

  console.log('══ ۲) دوربین معلم + اعلام شروع کلاس ══')
  await tPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
  let camOn = false
  for (let i = 0; i < 20 && !camOn; i++) {
    camOn = (await tPage.locator('button[title="خاموش‌کردن دوربین"]').count()) > 0
    if (!camOn) await sleep(500)
  }
  camOn ? ok('دوربین معلم روشن و در SFU منتشر شد') : bad('انتشار دوربین معلم انجام نشد')

  await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]').first().click()
  let announcedAt = null
  for (let i = 0; i < 40; i++) {
    const d = await tPage.request.get(`${BASE}/api/live-sessions/${sessionId}`).then((r) => r.json()).catch(() => null)
    announcedAt = d?.announcedAt ?? null
    if (announcedAt) break
    await sleep(500)
  }
  announcedAt ? ok('اعلان شروع کلاس ثبت شد') : bad('اعلان شروع ثبت نشد')

  console.log('══ ۳) ورود سه دانش‌آموز — دریافت ویدیوی دوربین معلم ══')
  const sPages = []
  for (const s of STUDENTS) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
    const page = await newPage(ctx, s.u)
    await login(page, s.u, s.p)
    await page.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-tile-self]', { timeout: 45000 })
    sPages.push({ ...s, page })
    await sleep(500)
  }
  ok('هر سه دانش‌آموز داخل اتاق شدند')

  for (const s of sPages) {
    let got = false
    for (let i = 0; i < 30 && !got; i++) {
      got = await tileHasLiveVideo(s.page, TEACHER.name, 'camera')
      if (!got) await sleep(500)
    }
    got ? ok(`${s.name}: ویدیوی زندهٔ دوربین معلم دریافت شد`) : bad(`${s.name}: دوربین معلم دریافت نشد`)
  }

  // شمار شرکت‌کنندگان = ۴ (معلم + ۳ دانش‌آموز) — در هدر معلم
  {
    const cnt = await tPage.evaluate(() => {
      const el = [...document.querySelectorAll('header')].find((h) => h.innerText.includes('فعال'))
      return el ? el.innerText : ''
    })
    cnt.includes('۴') ? ok('شمار شرکت‌کنندگان در هدر معلم = ۴') : bad(`شمار شرکت‌کنندگان دیده نشد: ${cnt.slice(0, 120)}`)
  }

  console.log('══ ۴) اشتراک دسکتاپ معلم ══')
  await tPage.locator('button[title="اشتراک‌گذاری صفحه"]').first().click()
  let sharing = false
  for (let i = 0; i < 20 && !sharing; i++) {
    sharing = (await tPage.locator('button[title="پایان اشتراک صفحه"]').count()) > 0
    if (!sharing) await sleep(500)
  }
  sharing ? ok('معلم صفحه/دسکتاپ خود را در SFU منتشر کرد') : bad('اشتراک صفحه فعال نشد')

  console.log('══ ۵) دریافت استریم صفحه توسط هر سه دانش‌آموز ══')
  for (const s of sPages) {
    let got = false
    for (let i = 0; i < 30 && !got; i++) {
      got = await tileHasLiveVideo(s.page, TEACHER.name, 'screen')
      if (!got) await sleep(500)
    }
    got ? ok(`${s.name}: استریم صفحهٔ معلم دریافت شد`) : bad(`${s.name}: استریم صفحه دریافت نشد`)

    // نمایشگر اصلی باید صفحه باشد + دوربین معلم در کاشی کوچک پایین
    if (got) {
      const layout = await s.page.evaluate(() => {
        const main = document.querySelector('[data-tile-kind="screen"]')
        const camTiles = [...document.querySelectorAll('[data-tile-kind="camera"]')]
        return {
          screenMain: !!main,
          teacherCamSmall: camTiles.some(
            (el) => (el.getAttribute('data-tile-name') ?? '').includes('رضا موسوی') && el.closest('.grid'),
          ),
        }
      })
      layout.screenMain
        ? ok(`${s.name}: نمایشگر اصلی به «صفحهٔ معلم» سوئیچ کرد`)
        : bad(`${s.name}: نمایشگر اصلی صفحه را نشان نمی‌دهد`)
      layout.teacherCamSmall
        ? ok(`${s.name}: دوربین معلم در کاشی کوچک کنار صفحه دیده می‌شود`)
        : bad(`${s.name}: کاشی کوچک دوربین معلم دیده نشد`)
    }
  }

  console.log('══ ۶) پایان اشتراک صفحه → بازگشت نمایشگر اصلی به دوربین ══')
  await tPage.locator('button[title="پایان اشتراک صفحه"]').first().click()
  await sleep(2500)
  for (const s of sPages) {
    let screenGone = false
    for (let i = 0; i < 20 && !screenGone; i++) {
      screenGone = !(await s.page.evaluate(() => document.querySelector('[data-tile-kind="screen"]') !== null))
      if (!screenGone) await sleep(500)
    }
    screenGone ? ok(`${s.name}: کاشی صفحه حذف شد`) : bad(`${s.name}: کاشی صفحه باقی ماند`)
    let camBack = false
    for (let i = 0; i < 20 && !camBack; i++) {
      camBack = await tileHasLiveVideo(s.page, TEACHER.name, 'camera')
      if (!camBack) await sleep(500)
    }
    camBack ? ok(`${s.name}: نمایشگر اصلی به دوربین معلم برگشت`) : bad(`${s.name}: بازگشت دوربین معلم ناموفق`)
  }

  console.log('══ ۷) گفتگوی جلسه: دانش‌آموز → معلم ══')
  {
    const s1 = sPages[0].page
    await s1.locator('aside button:has-text("گفتگو")').first().click()
    await s1.getByPlaceholder('پیام به جلسه…').fill('سلام — تست چند دانش‌آموز')
    await s1.getByRole('button', { name: 'ارسال', exact: true }).click()
    let chatOk = false
    try {
      await tPage.locator('aside button:has-text("گفتگو")').first().click()
      await tPage.getByText('تست چند دانش‌آموز').waitFor({ timeout: 10000 })
      chatOk = true
    } catch {
      chatOk = false
    }
    chatOk ? ok('پیام گفتگوی جلسه از دانش‌آموز به معلم رسید') : bad('گفتگوی جلسه کار نکرد')
  }

  console.log('══ ۸) پایان جلسه ══')
  await tPage.getByRole('button', { name: 'پایان جلسه' }).first().click()
  await tPage.getByRole('button', { name: 'پایان جلسه' }).last().click()
  for (const s of sPages) {
    try {
      await s.page.getByText('جلسه پایان یافته').waitFor({ timeout: 15000 })
      ok(`${s.name}: پایان جلسه را دید`)
    } catch {
      bad(`${s.name}: پایان جلسه را ندید`)
    }
  }

  console.log('══ جمع‌بندی ══')
  const realErrors = pageErrors.filter((e) => !e.includes('ResizeObserver') && !e.includes('favicon'))
  realErrors.length === 0
    ? ok(`بدون خطای جاوااسکریپت ناگهانی (${pageErrors.length} خاموش‌شده)`)
    : bad(`خطاهای صفحه: ${realErrors.slice(0, 3).join(' | ')}`)
} catch (e) {
  bad(`شکست سناریو: ${e.message}`)
  console.log(e.stack?.split('\n').slice(0, 6).join('\n'))
} finally {
  await browser.close()
}

console.log(`\nنتیجه: ${PASS} پاس / ${FAIL} شکست`)
process.exit(FAIL > 0 ? 1 : 0)
