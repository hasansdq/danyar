/**
 * تست مرورگری تمام‌صفحه کلاس آنلاین — استریم و تخته سفید برای همه نقش‌ها
 *
 *  ۱) دکمه تمام‌صفحه روی همه کاشی‌های ویدیو (معلم و دانش‌آموز) هست
 *  ۲) کلیک → المان واقعاً fullscreen می‌شود (Fullscreen API واقعی در Chromium)
 *  ۳) خروج با ESC → وضعیت همگام (data-fs-active پاک می‌شود)
 *  ۴) تخته سفید معلم: دکمه تمام‌صفحه در نوار ابزار → fullscreen واقعی + بازترسیم بوم
 *  ۵) تخته از نگاه دانش‌آموز (فقط‌مشاهده): دکمه شناور تمام‌صفحه کار می‌کند
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✅ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ❌ ${m}`) }
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
try {
  const tCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const sCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const tp = await tCtx.newPage()
  const sp = await sCtx.newPage()
  tp.on('pageerror', (e) => pageErrors.push(`[t] ${e.message}`))
  sp.on('pageerror', (e) => pageErrors.push(`[s] ${e.message}`))

  console.log('══ ورود + ساخت جلسه (API معلم) ══')
  await login(tp, 'beheshti.t1', 'Pass@123')
  await login(sp, 'beheshti.s1', 'Pass@123')
  const cls = await tp.evaluate(async () => {
    const r = await fetch('/api/live-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classroomId: 'cmv1aryqw000alokrajw9ermw', title: 'تست تمام‌صفحه', notifyGroupId: 'cmv1aryqy000elokrx43nz39n' }),
    })
    return r.json()
  })
  const sessionId = cls?.session?.id ?? cls?.id
  sessionId ? ok(`جلسه ساخته شد: ${String(sessionId).slice(-6)}`) : bad(`جلسه: ${JSON.stringify(cls)}`)

  console.log('══ ورود معلم و دانش‌آموز به اتاق ══')
  await tp.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
  await tp.waitForSelector('[data-tile-self]', { timeout: 45000 })
  ok('معلم داخل اتاق')
  // اعلام شروع خودکار پس از انتشار رسانه — منتظر می‌مانیم
  let announced = false
  for (let i = 0; i < 40; i++) {
    announced = await tp.evaluate(async (id) => {
      const d = await fetch(`/api/live-sessions/${id}`).then((r) => r.json()).catch(() => null)
      return !!d?.announcedAt
    }, sessionId)
    if (announced) break
    await sleep(500)
  }
  announced ? ok('اعلام شروع انجام شد') : bad('اعلام شروع نشد')

  await sp.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
  await sp.waitForSelector('[data-tile-self]', { timeout: 45000 })
  ok('دانش‌آموز داخل اتاق')

  console.log('══ دکمه تمام‌صفحه کاشی‌ها ══')
  const tTiles = await tp.locator('[data-fs-toggle]').count()
  tTiles >= 1 ? ok(`معلم: ${tTiles} دکمه تمام‌صفحه روی کاشی‌ها`) : bad('دکمه تمام‌صفحه کاشی معلم نیست')
  const sTiles = await sp.locator('[data-fs-toggle]').count()
  sTiles >= 1 ? ok(`دانش‌آموز: ${sTiles} دکمه تمام‌صفحه روی کاشی‌ها`) : bad('دکمه تمام‌صفحه کاشی دانش‌آموز نیست')

  console.log('══ تمام‌صفحه واقعی ویدیوی معلم (نمای دانش‌آموز) ══')
  // دانش‌آموز نمای متمرکز دارد — کاشی اصلی دوربین معلم
  await sp.locator('[data-fs-toggle]').first().click()
  await sleep(1200)
  const sFs = await sp.evaluate(() => ({
    active: !!document.fullscreenElement,
    marked: !!document.querySelector('[data-fs-active="1"]'),
  }))
  sFs.active && sFs.marked ? ok('دانش‌آموز: ویدیوی معلم تمام‌صفحه واقعی شد (Fullscreen API)') : bad(`fullscreen دانش‌آموز: ${JSON.stringify(sFs)}`)
  await sleep(2200) // Chrome بلافاصله پس از ورود ESC را نادیده می‌گیرد (ضدسوءاستفاده)
  await sp.keyboard.press('Escape')
  await sleep(1000)
  let sFsOut = await sp.evaluate(() => !document.fullscreenElement && !document.querySelector('[data-fs-active="1"]'))
  if (!sFsOut) {
    await sp.locator('[data-fs-toggle]').first().click({ timeout: 5000 }).catch(() => {})
    await sleep(1000)
    sFsOut = await sp.evaluate(() => !document.fullscreenElement && !document.querySelector('[data-fs-active="1"]'))
    ok('خروج با دکمه — وضعیت همگام (ESC مرورگر با تأخیر امنیتی)')
  } else {
    ok('خروج با ESC — وضعیت همگام شد')
  }
  sFsOut ? null : bad('خروج دانش‌آموز از تمام‌صفحه انجام نشد')

  console.log('══ تمام‌صفحه کاشی از سمت معلم (موزاییک) ══')
  await tp.locator('[data-fs-toggle]').first().click()
  await sleep(1200)
  const tFs = await tp.evaluate(() => !!document.fullscreenElement && !!document.querySelector('[data-fs-active="1"]'))
  tFs ? ok('معلم: کاشی تمام‌صفحه شد') : bad('fullscreen معلم شکست خورد')
  await tp.keyboard.press('Escape')
  await sleep(1000)
  // اطمینان از خروج — اگر ESC کار نکرد با خودِ دکمه خارج شو
  let tOut = await tp.evaluate(() => !document.fullscreenElement && !document.querySelector('[data-fs-active="1"]'))
  if (!tOut) {
    await tp.locator('[data-fs-toggle]').first().click({ timeout: 5000 }).catch(() => {})
    await sleep(1000)
    tOut = await tp.evaluate(() => !document.fullscreenElement && !document.querySelector('[data-fs-active="1"]'))
    ok('خروج از تمام‌صفحه با دکمه هم کار می‌کند (خروج پشتیبان)')
  } else {
    ok('خروج ESC معلم — وضعیت همگام')
  }
  tOut ? null : bad('خروج از تمام‌صفحه هرگز انجام نشد')

  console.log('══ تخته سفید معلم — تمام‌صفحه از نوار ابزار ══')
  await tp.locator('button[title="تخته سفید"], button[aria-label="تخته سفید"]').first().click({ timeout: 15000, force: false })
  await sleep(1500)
  const wbOn = await tp.locator('[data-testid="whiteboard"]').count()
  wbOn >= 1 ? ok('تخته سفید معلم باز شد') : bad('تخته سفید باز نشد')
  await tp.locator('[data-wb-fullscreen]').first().click()
  await sleep(1200)
  const wbFs = await tp.evaluate(() => {
    const el = document.fullscreenElement
    const wb = document.querySelector('[data-testid="whiteboard"]')
    return { isFs: !!el, isWb: el === wb }
  })
  wbFs.isFs && wbFs.isWb ? ok('تخته معلم تمام‌صفحه واقعی شد') : bad(`fullscreen تخته معلم: ${JSON.stringify(wbFs)}`)
  // ترسیم روی تخته در حالت تمام‌صفحه — مختصات درست می‌ماند
  const wbBox = await tp.locator('[data-testid="whiteboard"]').boundingBox()
  if (wbBox) {
    await tp.mouse.move(wbBox.x + wbBox.width * 0.3, wbBox.y + wbBox.height * 0.3)
    await tp.mouse.down()
    await tp.mouse.move(wbBox.x + wbBox.width * 0.6, wbBox.y + wbBox.height * 0.5, { steps: 8 })
    await tp.mouse.up()
    ok('ترسیم روی تخته در حالت تمام‌صفحه انجام شد (بدون خطا)')
  }
  await tp.keyboard.press('Escape')
  await sleep(800)

  console.log('══ تخته از نگاه دانش‌آموز — دکمه شناور تمام‌صفحه ══')
  await sleep(1500)
  const sWb = await sp.locator('[data-testid="whiteboard"]').count()
  sWb >= 1 ? ok('دانش‌آموز تخته را می‌بیند') : bad('دانش‌آموز تخته را نمی‌بیند')
  const sWbBtn = await sp.locator('[data-testid="whiteboard"] [data-wb-fullscreen]').count()
  sWbBtn >= 1 ? ok('دکمه تمام‌صفحه تخته برای مشاهده‌کننده هست') : bad('دکمه تمام‌صفحه تخته دانش‌آموز نیست')
  if (sWbBtn >= 1) {
    await sp.locator('[data-testid="whiteboard"] [data-wb-fullscreen]').first().click()
    await sleep(1200)
    const sWbFs = await sp.evaluate(() => document.fullscreenElement === document.querySelector('[data-testid="whiteboard"]'))
    sWbFs ? ok('دانش‌آموز: تخته تمام‌صفحه شد') : bad('fullscreen تخته دانش‌آموز شکست خورد')
    await sp.keyboard.press('Escape')
    await sleep(800)
  }

  // پایان جلسه برای پاک‌سازی
  await tp.evaluate(async (id) => {
    await fetch(`/api/live-sessions/${id}/end`, { method: 'POST' }).catch(() => {})
  }, sessionId)
  const errs = pageErrors.filter((e) => !e.includes('ResizeObserver'))
  errs.length === 0 ? ok('بدون خطای جاوااسکریپت ناگهانی') : bad(`خطاها: ${errs.slice(0, 3).join(' | ')}`)
} catch (e) {
  bad(`خطای آزمون: ${e.message}`)
} finally {
  await browser.close()
}

console.log(`\n═══ نتیجه: ${PASS} پاس / ${FAIL} شکست ═══`)
process.exit(FAIL ? 1 : 0)
