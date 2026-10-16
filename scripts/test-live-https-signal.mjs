/**
 * E2E سیگنالینگ LiveKit روی HTTPS — بازسازی دقیق محیط کاربرِ پیش‌نمایش
 *
 * سناریو واقعی کاربر: صفحه https://preview-….space-z.ai (لبه TLS خاتمه می‌دهد، HTTP ساده
 * به درگاه می‌رسد، درگاه X-Forwarded-Proto را «http» بازنویسی می‌کند) → سرور URL سیگنال
 * را با ws:// می‌سازد → مرورگر روی صفحه HTTPS اتصال ناامن را مسدود می‌کند →
 * «could not establish signal connection: room connection has timed out (signal)»
 *
 * شبیه‌سازی: لبه TLS محلی (scripts/tls-edge-shim.cjs روی :8443) → درگاه :81 → برنامه.
 * نام میزبان کانونی درگاه با --host-resolver-rules به 127.0.0.1 نگاشت می‌شود.
 *
 * معیارهای سبز:
 *  ۱) مبدأ صفحه https است
 *  ۲) WebSocket سیگنالینگ با wss:// باز می‌شود (رویداد websocket صفحه)
 *  ۳) معلم در اتاق + اعلام شروع فقط پس از انتشار واقعی رسانه
 *  ۴) دانش‌آموز ویدیوی زنده معلم را از SFU می‌گیرد (MediaStream واقعی)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const HOST = 'c-6acd8a54-14810412-ddbc1d8c1deb'
const BASE = process.env.TEST_BASE ?? `https://${HOST}:8443`
const CLASSROOM = 'cmv1aryqw000alokrajw9ermw' // هفتم۱
const NOTIFY_GROUP = 'cmv1aryqy000elokrx43nz39n' // ریاضی هفتم۱
const TEACHER = { u: 'beheshti.t1', p: 'Pass@123' }
const STUDENT = { u: 'beheshti.s1', p: 'Pass@123' }

let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** فراخوانی API از درون صفحه — تا همان قوانین resolver/کوکی مرورگر اعمال شود */
async function apiPost(page, path, data) {
  return await page.evaluate(
    async ({ p, d }) => {
      const r = await fetch(p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(d),
      })
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) }
    },
    { p: path, d: data },
  )
}

async function apiGet(page, path) {
  return await page.evaluate(async (p) => {
    const r = await fetch(p)
    return r.ok ? r.json().catch(() => null) : null
  }, path)
}

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
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
    '--ignore-certificate-errors',
  ],
})

const pageErrors = []

try {
  console.log('══ ۱) ورود معلم و ساخت جلسه تازه ══')
  const tCtx = await browser.newContext({ baseURL: BASE, ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } })
  const tPage = await tCtx.newPage()
  tPage.on('pageerror', (e) => pageErrors.push(`[T] ${e.message}`))
  await login(tPage, TEACHER.u, TEACHER.p)
  ok(`ورود معلم — مبدأ صفحه: ${new URL(tPage.url()).protocol}`)
  if (new URL(tPage.url()).protocol === 'https:') ok('صفحه واقعاً روی HTTPS است (محیط کاربر بازسازی شد)')
  else bad('صفحه روی HTTPS نیست — شبیه‌سازی ناقص')

  const createOnce = () => apiPost(tPage, '/api/live-sessions', { classroomId: CLASSROOM, notifyGroupId: NOTIFY_GROUP, title: 'آزمون سیگنال HTTPS' })
  let createRes = await createOnce()
  let created = createRes.data
  if (created?.reused) {
    await apiPost(tPage, `/api/live-sessions/${created.id}/end`, {})
    await sleep(1000)
    createRes = await createOnce()
    created = createRes.data
  }
  const sessionId = created?.session?.id ?? created?.id
  if (!createRes.ok || !sessionId || created?.reused) throw new Error(`create session failed: ${JSON.stringify(created)}`)
  ok(`جلسه تازه ساخته شد: ${sessionId}`)

  console.log('══ ۲) ورود معلم به اتاق روی HTTPS — اتصال سیگنالینگ ══')
  const rtcWsUrls = []
  tPage.on('websocket', (ws) => {
    if (ws.url().includes('/rtc')) rtcWsUrls.push(ws.url())
  })
  await tPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })

  // انتظار برای در-اتاق شدن (سوکت) و سپس نتیجه رسانه
  let sawErrorBanner = ''
  try {
    await tPage.waitForSelector('[data-tile-self]', { timeout: 45000 })
    ok('معلم داخل اتاق (in-room) — زنجیره سوکت سالم')
  } catch {
    bad('معلم داخل اتاق نشد')
  }
  for (let i = 0; i < 50; i++) {
    try {
      const t = await tPage.locator('div.bg-amber-500\\/10').first().textContent({ timeout: 500 })
      if (t) { sawErrorBanner = t.trim(); break }
    } catch {}
    if (rtcWsUrls.length) break
    await sleep(300)
  }

  console.log('══ ۳) نتیجه سیگنالینگ رسانه ══')
  if (rtcWsUrls.length) {
    ok(`WebSocket سیگنالینگ باز شد: ${rtcWsUrls[0].replace(/access_token=[^&]+/, 'access_token=…')}`)
    if (rtcWsUrls[0].startsWith('wss://')) ok('اسکیم سیگنالینگ wss است (هم‌تراز با صفحه HTTPS)')
    else bad(`اسکیم سیگنالینگ wss نیست: ${rtcWsUrls[0].split('?')[0]}`)
  } else {
    bad('هیچ WebSocket سیگنالینگی به /rtc باز نشد (اتصال رسانه مسدود/تایم‌اوت)')
    if (sawErrorBanner) {
      console.log(`  ↳ بنر خطای UI: ${sawErrorBanner.slice(0, 220)}`)
      if (sawErrorBanner.includes('اتصال رسانه برقرار نشد')) ok('ارور گزارش‌شده کاربر در UI بازتولید شد')
    } else {
      console.log('  ↳ بنر خطا هم دیده نشد')
    }
  }

  console.log('══ ۴) اعلام شروع فقط پس از انتشار واقعی — معیار قطعی سرور ══')
  let announced = false
  try {
    await tPage.getByText('اعلان شروع کلاس برای دانش‌آموزان ارسال شد').waitFor({ timeout: 8000 })
    announced = true
    ok('اعلام شروع — بنر UI دیده شد')
  } catch {
    // بنر ممکن است زودتر محو شده باشد — معیار قطعی: announcedAt در سرور
  }
  if (!announced) {
    for (let i = 0; i < 10; i++) {
      const st = await apiGet(tPage, `/api/live-sessions/${sessionId}`)
      if (st?.announcedAt) { announced = true; break }
      await sleep(1500)
    }
    announced ? ok('اعلام شروع در سرور ثبت شد (announcedAt — انتشار رسانه در SFU واقعی بود)')
              : bad('اعلام شروع ثبت نشد (انتشار رسانه رخ نداد)')
  }

  if (announced) {
    console.log('══ ۵) دانش‌آموز وارد می‌شود و ویدیوی زنده می‌گیرد ══')
    const sCtx = await browser.newContext({ baseURL: BASE, ignoreHTTPSErrors: true, viewport: { width: 1360, height: 900 } })
    const sPage = await sCtx.newPage()
    sPage.on('pageerror', (e) => pageErrors.push(`[S] ${e.message}`))
    await login(sPage, STUDENT.u, STUDENT.p)
    await sPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
    try {
      await sPage.waitForSelector('[data-tile-self]', { timeout: 45000 })
      ok('دانش‌آموز داخل اتاق')
    } catch {
      bad('دانش‌آموز داخل اتاق نشد')
    }
    // ویدیوی زنده معلم: کاشی ویدیویی با MediaStream زنده
    let liveVideo = false
    for (let i = 0; i < 40; i++) {
      const got = await sPage.evaluate(() => {
        const vs = Array.from(document.querySelectorAll('video'))
        for (const v of vs) {
          const st = v.srcObject
          if (st && st.getVideoTracks().some((t) => t.readyState === 'live')) return true
        }
        return false
      }).catch(() => false)
      if (got) { liveVideo = true; break }
      await sleep(500)
    }
    liveVideo ? ok('دانش‌آموز ویدیوی زنده معلم را از SFU دریافت کرد (MediaStream واقعی)')
              : bad('ویدیوی زنده به دانش‌آموز نرسید')
    await sCtx.close()
  }

  console.log('══ ۶) پایان جلسه ══')
  try {
    const endBtn = tPage.getByRole('button', { name: /پایان کلاس|پایان جلسه/ }).first()
    await endBtn.click({ timeout: 5000 })
    const confirm = tPage.getByRole('button', { name: /پایان|تأیید|بله/ }).last()
    await confirm.click({ timeout: 5000 })
    await sleep(1500)
    ok('جلسه پایان یافت')
  } catch {
    await apiPost(tPage, `/api/live-sessions/${sessionId}/end`, {})
    ok('جلسه با API پایان یافت (دکمه UI یافت نشد)')
  }

  const realErrors = pageErrors.filter((e) => !e.includes('ResizeObserver'))
  realErrors.length === 0 ? ok('بدون خطای JS صفحه') : bad(`خطاهای صفحه: ${realErrors.slice(0, 3).join(' | ')}`)
} catch (e) {
  bad(`خطای اجرای آزمون: ${e.message}`)
} finally {
  await browser.close()
}

console.log(`\n══ نتیجه: ${PASS} سبز / ${FAIL} قرمز ══`)
process.exit(FAIL === 0 ? 0 : 1)
