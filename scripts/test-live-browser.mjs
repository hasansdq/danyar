/**
 * تست E2E واقعی مرورگر کلاس آنلاین — با رسانه واقعی WebRTC
 * دستگاه ساختگی کروم (--use-fake-device-for-media-stream) رسانه واقعی تولید می‌کند و
 * کل خط لوله WebRTC (capture → encode → transport → decode → render) واقعاً اجرا می‌شود.
 *
 * سناریوی «اعلام شروع کلاس»:
 *  ۱) معلم از UI سوییچ «شروع کلاس» را روشن می‌کند → دیالوگ → ورود به اتاق
 *  ۲) پس از آماده‌شدن استریم معلم، اعلان شروع خودکار ارسال می‌شود (توست + بنر)
 *  ۳) دانش‌آموز که هنگام شروع، برنامه را تازه باز کرده (آفلاین در لحظه شروع)
 *     روی صفحه دیگری (داشبورد) پاپ‌آپ «کلاس شما شروع شد!» را می‌گیرد و با
 *     دکمه «ورود به کلاس» وارد جلسه می‌شود
 *  ۴) انتقال واقعی تصویر دو طرفه + اشتراک صفحه، دست بلند/اجازه صحبت/سکوت معلم، چت جلسه
 *  ۵) پایان جلسه → قطع همه + پاپ‌آپ/دعوت به «کلاس پایان یافته» تغییر می‌کند
 *  ۶) سوییچ معلم پس از تازه‌سازی صفحه روشن می‌ماند (وضعیت واقعی سرور)
 *  ۷) «بعداً» پاپ‌آپ را می‌بندد؛ جلسه همچنان در بخش کلاس آنلاین قابل دسترسی است
 *  ۸) پایان جلسه هنگام نمایش پاپ‌آپ → دکمه ورود غیرفعال + «کلاس پایان یافته است»
 *  ۹) جلوگیری از ورود غیرمجاز از رابط کاربری
 *
 * اجرا: node scripts/test-live-browser.mjs   (پیش‌نیاز: سرویس‌ها روی 3000/3003/81)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = 'http://localhost:81' // گیت‌وی — سوکت فقط از همین مسیر با XTransformPort می‌گذرد
const API = 'http://localhost:3000'

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SHOT = '/home/z/my-project/download'
async function shot(page, name) {
  try { await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false }) } catch {}
}

// ─── ابزارهای API (سمت node) ───
async function apiLogin(username, password = 'Pass@123') {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, realm: 'app' }),
  })
  return 'daniar_session=' + /daniar_session=([^;]+)/.exec(r.headers.get('set-cookie'))[1]
}
async function api(cookie, path, opts = {}) {
  const r = await fetch(`${API}${path}`, { ...opts, headers: { cookie, ...(opts.headers ?? {}) } })
  return { status: r.status, data: await r.json().catch(() => null) }
}

// ─── ابزارهای رسانه داخل صفحه ───
async function mediaStats(page) {
  return page.evaluate(() => {
    const vids = [...document.querySelectorAll('video')]
    return vids.map((v) => {
      const tile = v.closest('[data-tile-self]') ?? v.parentElement
      const tracks = v.srcObject instanceof MediaStream ? v.srcObject.getVideoTracks() : []
      const t = tracks[0]
      return {
        hasStream: !!v.srcObject,
        w: t ? (t.getSettings().width ?? 0) : 0,
        live: t ? t.readyState === 'live' : false,
        isSelf: tile?.getAttribute('data-tile-self') === '1',
        kind: tile?.getAttribute('data-tile-kind') ?? 'camera',
      }
    })
  })
}
/** منتظر ویدئوی «دوری» (نه خودی) با فریم واقعی */
async function waitForRemoteVideo(page, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const stats = await mediaStats(page)
    const remote = stats.find((s) => !s.isSelf && s.kind === 'camera' && s.hasStream && s.w > 0 && s.live)
    if (remote) return remote
    await sleep(400)
  }
  return null
}
async function toastTexts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent ?? ''),
  )
}

// ─── آماده‌سازی: پایان جلسات باقی‌مانده + کوکی‌ها ───
section('آماده‌سازی: پایان جلسات باقی‌مانده')
const t1Cookie = await apiLogin('beheshti.t1')
const lr = await api(t1Cookie, '/api/live-sessions')
for (const c of lr.data?.classrooms ?? []) {
  if (c.activeSession) await api(t1Cookie, `/api/live-sessions/${c.activeSession.id}/end`, { method: 'POST' })
}
ok('هیچ جلسه فعالی باقی نماند')
const CLS7 = lr.data.classrooms.find((c) => c.name === 'هفتم۱').id
const GMATH7 = lr.data.classrooms.find((c) => c.name === 'هفتم۱').groups.find((g) => g.name === 'ریاضی هفتم۱').id

// ─── مرورگر ───
const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--auto-accept-this-tab-capture',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const ctxT = await browser.newContext({ viewport: { width: 1366, height: 850 } })
const ctxS = await browser.newContext({ viewport: { width: 1280, height: 800 } })

async function loginViaUI(ctx, username) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('#username', username)
  await page.fill('#password', 'Pass@123')
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 })
  return page
}

try {
  // ── ۱) معلم: سوییچ «شروع کلاس» → دیالوگ → اتاق ──
  section('معلم: سوییچ «شروع کلاس» و دیالوگ پیکربندی')
  const pt = await loginViaUI(ctxT, 'beheshti.t1')
  await pt.locator('a[href="/live"]').first().click()
  await pt.waitForURL('**/live')
  await pt.waitForTimeout(1500)
  const card7 = pt.locator('div.rounded-xl.border', { hasText: 'هفتم۱' }).first()
  const switchEl = card7.locator('[role="switch"][aria-label="سوییچ شروع کلاس هفتم۱"]')
  const switchVisible = await switchEl.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
  switchVisible ? ok('سوییچ «شروع کلاس» روی کارت کلاس «هفتم۱» دیده می‌شود') : bad('سوییچ شروع کلاس یافت نشد')
  ;(await switchEl.getAttribute('data-state')) === 'unchecked'
    ? ok('وضعیت اولیه سوییچ خاموش است (وضعیت واقعی سرور)')
    : bad('سوییچ اولیه روشن بود!')
  await shot(pt, '40-live-teacher-switch')

  await switchEl.click()
  await pt.waitForTimeout(700)
  const dlg = pt.locator('[role="dialog"]')
  await dlg.waitFor({ state: 'visible', timeout: 5000 })
  await dlg.locator('#live-title').fill('کلاس آنلاین ریاضی — از سوییچ شروع کلاس')
  await dlg.locator('[role="combobox"]').click()
  await pt.locator('[role="option"]', { hasText: 'ریاضی هفتم۱' }).click()
  await pt.waitForTimeout(300)
  await dlg.locator('button', { hasText: 'شروع کلاس و ورود به اتاق' }).click()
  await pt.waitForURL('**/live/**', { timeout: 20000 })
  const SID1 = new URL(pt.url()).pathname.split('/').pop()
  SID1 && SID1 !== 'live' ? ok(`سوییچ روشن شد، جلسه ساخته و معلم وارد اتاق شد (${SID1})`) : bad('ورود به اتاق ناموفق')

  // ── ۲) اعلام شروع پس از آماده‌شدن استریم معلم ──
  section('اعلام خودکار شروع کلاس پس از آماده‌شدن استریم معلم')
  let announceToast = false
  for (let i = 0; i < 20 && !announceToast; i++) {
    announceToast = (await toastTexts(pt)).some((t) => t.includes('اعلان شروع کلاس برای دانش‌آموزان ارسال شد'))
    if (!announceToast) await sleep(700)
  }
  announceToast ? ok('توست «اعلان شروع کلاس برای دانش‌آموزان ارسال شد» نمایش داده شد') : bad('توست اعلام شروع نیامد؛ توست‌ها: ' + JSON.stringify(await toastTexts(pt)))
  const banner = await pt.locator('text=اعلان شروع کلاس برای دانش‌آموزان ارسال شد؛').first().isVisible().catch(() => false)
  banner ? ok('بنر اطلاع‌رسانی اعلام در اتاق معلم پایدار است') : bad('بنر اعلام در اتاق دیده نشد')
  await shot(pt, '41-live-teacher-announced')

  const tSelfVideo = await mediaStats(pt)
  tSelfVideo.some((v) => v.isSelf && v.hasStream && v.live)
    ? ok('ویدئوی محلی معلم متصل است (استریم واقعی — شرط اعلام)')
    : bad('ویدئوی محلی معلم ندارد')

  // وضعیت واقعی سرور: announcedAt ثبت شده باشد
  const detail = await api(t1Cookie, `/api/live-sessions/${SID1}`)
  detail.data?.announcedAt ? ok('announcedAt در سرور ثبت شد (اعلام یک‌بار)') : bad('announcedAt سرور null است')

  // ── ۳) دانش‌آموز: پاپ‌آپ روی صفحه دیگر (مسیر بازیابی — برنامه تازه باز شده) ──
  section('دانش‌آموز: پاپ‌آپ «کلاس شما شروع شد!» روی صفحه گفتگوها')
  const ps = await loginViaUI(ctxS, 'beheshti.s1')
  await ps.goto(`${BASE}/`)
  await ps.waitForTimeout(1500)
  const popup = ps.locator('[data-class-start-popup]')
  await popup.waitFor({ state: 'visible', timeout: 15000 })
  const popupText = await popup.first().textContent()
  popupText?.includes('کلاس شما شروع شد!') ? ok('عنوان پاپ‌آپ «کلاس شما شروع شد!» درست است') : bad('عنوان پاپ‌آپ ناقص')
  popupText?.includes('رضا موسوی') ? ok('نام معلم در پاپ‌آپ نمایش داده شد') : bad('نام معلم در پاپ‌آپ نیست')
  popupText?.includes('هفتم۱') && popupText?.includes('کلاس آنلاین ریاضی')
    ? ok('نام کلاس و عنوان جلسه در پاپ‌آپ هست')
    : bad('کلاس/عنوان جلسه در پاپ‌آپ نیست: ' + popupText?.slice(0, 120))
  await shot(ps, '42-class-start-popup')

  // ── ۴) ورود دانش‌آموز با دکمه پاپ‌آپ ──
  section('ورود دانش‌آموز با دکمه «ورود به کلاس» پاپ‌آپ')
  await popup.first().locator('button', { hasText: 'ورود به کلاس' }).click()
  await ps.waitForURL('**/live/**', { timeout: 15000 })
  const joinedSid = new URL(ps.url()).pathname.split('/').pop()
  joinedSid === SID1 ? ok('دانش‌آموز دقیقاً به همان جلسه هدایت شد') : bad(`مقصد اشتباه: ${joinedSid} vs ${SID1}`)
  await ps.waitForTimeout(2500)
  const sHeader = await ps.locator('header').filter({ hasText: 'فعال' }).first().textContent().catch(() => null)
  sHeader?.includes('فعال') ? ok('دانش‌آموز داخل اتاق جلسه است (وضعیت فعال)') : bad('ورود دانش‌آموز به اتاق')
  // پاپ‌آپ همان جلسه برای دانش‌آموزِ داخل جلسه نمایش داده نمی‌شود
  const popupGone = await ps.locator('[data-class-start-popup]').count()
  popupGone === 0 ? ok('دانش‌آموزِ داخل جلسه پاپ‌آپ ورود نمی‌بیند') : bad('پاپ‌آپ داخل اتاق همچنان باز بود!')
  await shot(ps, '43-student-joined')

  section('انتقال واقعی صدا و تصویر (WebRTC mesh) بین معلم و دانش‌آموز')
  const tRemote = await waitForRemoteVideo(pt, 15000)
  tRemote ? ok(`معلم تصویر واقعی دوربین دانش‌آموز را دریافت کرد (${tRemote.w}px)`) : bad('تصویر دانش‌آموز به معلم نرسید')
  const sRemote = await waitForRemoteVideo(ps, 15000)
  sRemote ? ok(`دانش‌آموز تصویر واقعی دوربین معلم را دریافت کرد (${sRemote.w}px)`) : bad('تصویر معلم به دانش‌آموز نرسید')
  // ترک صوتی مقصد: معلم ابتدا میکروفون خودش را روشن می‌کند (اقدام خودش)
  await pt.locator('button[title*="میکروفون"]').first().click()
  await ps.waitForTimeout(2000)
  const sAudio = await ps.evaluate(() => {
    const auds = [...document.querySelectorAll('audio')]
    return auds.map((a) => ({ live: a.srcObject?.getAudioTracks?.()[0]?.readyState === 'live' }))
  })
  sAudio.some((a) => a.live) ? ok('ترک صوتی زنده معلم در سمت دانش‌آموز دریافت شد') : bad('صوت مقصد زنده نیست')
  await shot(pt, '44-mutual-video')

  // ── ۵) کنترل‌ها: میکروفون دانش‌آموز فقط با اجازه معلم ──
  section('میکروفون دانش‌آموز: بدون اجازه رد، با اجازه روشن')
  const sHand = ps.locator('button[aria-label*="دست"]')
  await sHand.first().click()
  await ps.waitForTimeout(800)
  const tHandSection = pt.locator('text=درخواست‌های صحبت')
  await tHandSection.waitFor({ timeout: 8000 }).catch(() => null)
  ;(await tHandSection.isVisible().catch(() => false))
    ? ok('درخواست صحبت دانش‌آموز در پنل معلم ظاهر شد')
    : bad('بخش درخواست‌های صحبت برای معلم نیامد')
  await shot(pt, '45-hand-raise')

  await pt.locator('button', { hasText: 'اجازه صحبت' }).first().click()
  await ps.waitForTimeout(2500)
  let sPermToasts = await toastTexts(ps)
  if (!sPermToasts.some((t) => t.includes('اجازه صحبت داد'))) {
    await ps.waitForTimeout(2000)
    sPermToasts = await toastTexts(ps)
  }
  sPermToasts.some((t) => t.includes('اجازه صحبت داد'))
    ? ok('دانش‌آموز اعلان «اجازه صحبت» گرفت')
    : bad('اعلان اجازه صحبت نرسید؛ توست‌ها: ' + JSON.stringify(sPermToasts))

  await ps.locator('button[title*="میکروفون"]').first().click()
  await ps.waitForTimeout(1000)
  const sMicOn = await ps.evaluate(() => {
    const b = document.querySelector('button[title*="خاموش‌کردن میکروفون"]')
    return !!b
  })
  sMicOn ? ok('دانش‌آموز با اقدام خودش میکروفون را روشن کرد') : bad('میکروفون دانش‌آموز روشن نشد')

  await pt.locator('button', { hasText: 'بستن میکروفون' }).first().click()
  await ps.waitForTimeout(2500)
  const sMuteToasts = await toastTexts(ps)
  sMuteToasts.some((t) => t.includes('توسط معلم بسته شد'))
    ? ok('سکوت اجباری معلم به دانش‌آموز اطلاع داده شد')
    : bad('رویداد سکوت اجباری به دانش‌آموز نرسید؛ توست‌ها: ' + JSON.stringify(sMuteToasts))
  await shot(ps, '46-student-muted')

  // ── ۶) اشتراک صفحه معلم ──
  section('اشتراک‌گذاری صفحه معلم → دریافت واقعی در سمت دانش‌آموز')
  await pt.locator('button[title*="اشتراک‌گذاری صفحه"]').first().click()
  await pt.waitForTimeout(2000)
  const tSharing = await pt.evaluate(() => !!document.querySelector('button[title*="پایان اشتراک صفحه"]'))
  tSharing ? ok('معلم اشتراک صفحه را شروع کرد') : bad('اشتراک صفحه معلم شروع نشد')
  let sScreenTile = -1
  for (let i = 0; i < 20 && sScreenTile <= 0; i++) {
    sScreenTile = await ps.evaluate(() => {
      const tile = document.querySelector('[data-tile-kind="screen"]')
      if (!tile) return -1
      const v = tile.querySelector('video')
      const t = v?.srcObject instanceof MediaStream ? v.srcObject.getVideoTracks()[0] : null
      return t ? (t.getSettings().width ?? 0) : 0
    })
    if (sScreenTile <= 0) await sleep(700)
  }
  sScreenTile > 0
    ? ok(`دانش‌آموز تصویر اشتراک صفحه معلم را با فریم واقعی گرفت (${sScreenTile}px)`)
    : sScreenTile === -1
      ? bad('کاشی اشتراک صفحه در سمت دانش‌آموز ساخته نشد (وضعیت sharing نرسید)')
      : bad('کاشی هست ولی ترک تصویر اشتراک صفحه نرسید')
  await shot(ps, '47-screen-share')

  // ── ۷) چت جلسه ──
  section('گفتگوی متنی جلسه')
  await pt.locator('button', { hasText: 'گفتگو' }).first().click()
  await pt.waitForTimeout(400)
  await pt.locator('input[placeholder*="پیام به جلسه"]').fill('سلام کلاس، صفحه‌ی درس را می‌بینید؟')
  await pt.keyboard.press('Enter')
  await ps.locator('aside button', { hasText: 'گفتگو' }).first().click()
  await ps.waitForTimeout(1500)
  const sChatText = await ps.locator('text=سلام کلاس، صفحه‌ی درس را می‌بینید؟').first().isVisible().catch(() => false)
  sChatText ? ok('پیام چت معلم در سمت دانش‌آموز نمایش داده شد') : bad('چت جلسه تحویل نشد')
  await shot(ps, '48-session-chat')

  // ── ۸) پایان جلسه → قطع همه + تغییر دکمه دعوت ──
  section('پایان جلسه و تغییر دکمه پیام دعوت')
  await pt.locator('button', { hasText: 'پایان جلسه' }).first().click()
  await pt.waitForTimeout(500)
  await pt.locator('[role="alertdialog"] button', { hasText: 'پایان جلسه' }).click()
  await pt.waitForTimeout(1500)
  const tEnded = await pt.locator('text=جلسه پایان یافته').first().isVisible().catch(() => false)
  tEnded ? ok('سمت معلم: صفحه «جلسه پایان یافته» نمایش داده شد') : bad('صفحه پایان در سمت معلم')
  const sEnded = await ps.locator('text=جلسه پایان یافته').first().isVisible().catch(() => false)
  sEnded ? ok('سمت دانش‌آموز: اتصال قطع و پیام پایان نمایش داده شد') : bad('اتمام در سمت دانش‌آموز')
  await shot(pt, '49-teacher-ended')
  await shot(ps, '50-student-ended')

  await ps.goto(`${BASE}/`)
  await ps.waitForTimeout(1200)
  await ps.locator('button', { hasText: 'ریاضی هفتم۱' }).first().click()
  await ps.waitForTimeout(2000)
  const endedBtn = await ps.locator('text=جلسه پایان یافته').first().isVisible().catch(() => false)
  const activeBtn = await ps.locator('a', { hasText: 'ورود به کلاس' }).first().isVisible().catch(() => false)
  endedBtn && !activeBtn ? ok('دکمه پیام دعوت به «جلسه پایان یافته» تغییر کرد') : bad(`دکمه دعوت (ended=${endedBtn} active=${activeBtn})`)
  await shot(ps, '51-invite-ended')

  // ── ۹) سوییچ: وضعیت واقعی سرور + «بعداً» + پایان هنگام نمایش پاپ‌آپ ──
  section('سوییچ پس از تازه‌سازی صفحه روشن می‌ماند (وضعیت سرور)')
  const created2 = await api(t1Cookie, '/api/live-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ classroomId: CLS7, notifyGroupId: GMATH7, title: 'جلسه سوییچ و بعداً' }),
  })
  const SID2 = created2.data.id
  await pt.goto(`${BASE}/live`)
  await pt.waitForTimeout(1500)
  await pt.reload()
  await pt.waitForTimeout(1500)
  const sw2 = pt.locator('[role="switch"][aria-label="سوییچ شروع کلاس هفتم۱"]')
  ;(await sw2.getAttribute('data-state')) === 'checked'
    ? ok('سوییچ پس از تازه‌سازی صفحه روشن است (وضعیت واقعی جلسه از سرور)')
    : bad('سوییچ پس از رفرش خاموش بود!')
  // کارت معلم وضعیت «در انتظار استریم» را نشان می‌دهد (اعلام‌نشده)
  const pendingText = await pt.locator('div.rounded-xl.border', { hasText: 'هفتم۱' }).first().textContent()
  pendingText?.includes('در انتظار آماده‌شدن استریم')
    ? ok('کارت معلم وضعیت «در انتظار آماده‌شدن استریم» را نشان می‌دهد')
    : bad('وضعیت اعلام‌نشده در کارت معلم نیست')

  section('دانش‌آموز: پاپ‌آپ با رویداد بلادرنگ و دکمه «بعداً»')
  await ps.goto(`${BASE}/`)
  await ps.waitForTimeout(1500)
  // اعلام سمت سرور معلم هنوز انجام نشده → پاپ‌آپ نباید بیاید؛ سپس اعلام می‌کنیم
  const ann2 = await api(t1Cookie, `/api/live-sessions/${SID2}/announce`, { method: 'POST' })
  ann2.status === 200 ? ok('اعلام جلسه دوم انجام شد (مسیر API)') : bad('اعلام جلسه دوم: ' + JSON.stringify(ann2.data))
  const popup2 = ps.locator('[data-class-start-popup]')
  await popup2.waitFor({ state: 'visible', timeout: 15000 })
  const t2popup = await popup2.first().textContent()
  t2popup?.includes('جلسه سوییچ و بعداً') ? ok('پاپ‌آپ جلسه دوم با رویداد بلادرنگ آمد') : bad('پاپ‌آپ جلسه دوم نیامد: ' + t2popup?.slice(0, 100))
  await popup2.first().locator('button', { hasText: 'بعداً' }).click()
  await ps.waitForTimeout(800)
  const popup2Gone = await ps.locator('[data-class-start-popup]').count()
  popup2Gone === 0 ? ok('«بعداً» پاپ‌آپ همان جلسه را بست') : bad('پاپ‌آپ با «بعداً» بسته نشد')
  // جلسه فعال همچنان در بخش کلاس آنلاین دانش‌آموز قابل دسترسی است
  await ps.goto(`${BASE}/live`)
  await ps.waitForTimeout(1500)
  const liveCard = await ps.locator('a', { hasText: 'ورود به کلاس' }).first().isVisible().catch(() => false)
  liveCard ? ok('جلسه فعال پس از «بعداً» در بخش کلاس آنلاین قابل دسترسی است') : bad('جلسه در بخش کلاس آنلاین دیده نشد')
  await shot(ps, '52-later-still-in-live')

  section('پایان جلسه هنگام نمایش پاپ‌آپ → دکمه غیرفعال «کلاس پایان یافته است»')
  // ابتدا جلسه دوم پایان می‌یابد (در هر کلاس فقط یک جلسه فعال مجاز است)
  await api(t1Cookie, `/api/live-sessions/${SID2}/end`, { method: 'POST' })
  const created3 = await api(t1Cookie, '/api/live-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ classroomId: CLS7, notifyGroupId: GMATH7, title: 'جلسه پایان حین پاپ‌آپ' }),
  })
  const SID3 = created3.data?.id
  if (!SID3) {
    bad('ساخت جلسه سوم ناموفق: ' + JSON.stringify(created3.data))
  } else {
    await ps.goto(`${BASE}/`)
    await ps.waitForTimeout(1200)
    const ann3 = await api(t1Cookie, `/api/live-sessions/${SID3}/announce`, { method: 'POST' })
    ann3.status === 200 ? ok('اعلام جلسه سوم انجام شد') : bad('اعلام جلسه سوم: ' + JSON.stringify(ann3.data))
    const popup3 = ps.locator('[data-class-start-popup]')
    await popup3.waitFor({ state: 'visible', timeout: 15000 })
    const t3popup = await popup3.first().textContent()
    t3popup?.includes('جلسه پایان حین پاپ‌آپ') ? ok('پاپ‌آپ جلسه سوم نمایش داده شد') : bad('پاپ‌آپ سوم: ' + t3popup?.slice(0, 100))
    await api(t1Cookie, `/api/live-sessions/${SID3}/end`, { method: 'POST' })
    await ps.waitForTimeout(2000)
    const endedPopupText = await popup3.first().textContent().catch(() => '')
    // دکمه ورود به حالت غیرفعال با برچسب «کلاس پایان یافته است» تغییر می‌کند
    const enterBtn = popup3.first().locator('button:has-text("کلاس پایان یافته است")')
    const enterBtnGone = (await popup3.first().locator('button:has-text("ورود به کلاس")').count()) === 0
    const endedBtnDisabled = await enterBtn.isDisabled().catch(() => null)
    endedPopupText?.includes('کلاس پایان یافته است') && endedBtnDisabled === true && enterBtnGone
      ? ok('پاپ‌آپ هنگام پایان جلسه → دکمه ورود غیرفعال و وضعیت «کلاس پایان یافته است»')
      : bad(`وضعیت پاپ‌آپ پس از پایان (disabled=${endedBtnDisabled} gone=${enterBtnGone}): ` + endedPopupText?.slice(0, 120))
    await shot(ps, '53-popup-ended')
    await popup3.first().locator('button', { hasText: 'بعداً' }).click().catch(() => null)
  }

  section('سوییچ پس از پایان واقعی جلسه خاموش می‌شود (به‌روزرسانی بلادرنگ)')
  // جلسه چهارم از API ساخته می‌شود (بدون نیاز به اعلام — سوییچ وضعیت جلسه است)
  // معلم روی /live منتظر است → پایان با API → سوییچ بلادرنگ خاموش شود
  const created4 = await api(t1Cookie, '/api/live-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ classroomId: CLS7, notifyGroupId: GMATH7, title: 'جلسه خاموشی سوییچ' }),
  })
  const SID4 = created4.data?.id
  if (!SID4) {
    bad('ساخت جلسه چهارم ناموفق: ' + JSON.stringify(created4.data))
  } else {
    await pt.goto(`${BASE}/live`)
    await pt.waitForTimeout(1200)
    const sw4 = pt.locator('[role="switch"][aria-label="سوییچ شروع کلاس هفتم۱"]')
    ;(await sw4.getAttribute('data-state')) === 'checked'
      ? ok('سوییچ جلسه چهارم پیش از پایان روشن است')
      : bad('سوییچ جلسه چهارم روشن نبود!')
    await api(t1Cookie, `/api/live-sessions/${SID4}/end`, { method: 'POST' })
    let flipped = false
    for (let i = 0; i < 12 && !flipped; i++) {
      flipped = (await sw4.getAttribute('data-state')) === 'unchecked'
      if (!flipped) await sleep(700)
    }
    flipped ? ok('با پایان واقعی جلسه، سوییچ معلم بلادرنگ خاموش شد') : bad('سوییچ پس از پایان جلسه خاموش نشد')
    await shot(pt, '54-switch-off-after-end')
  }

  // ── ۱۰) جلوگیری از ورود غیرمجاز از رابط کاربری ──
  section('ورود غیرمجاز: دانش‌آموز کلاس دیگر (s5) و مدرسه دیگر (fs1)')
  const ctxS5 = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const ctxFS = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const ps5 = await ctxS5.newPage()
  await loginViaUI2(ps5, 'beheshti.s5')
  await ps5.goto(`${BASE}/live/${SID3}`)
  const denied5 = await ps5
    .locator('text=جلسه در دسترس نیست')
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  denied5 ? ok('دانش‌آموز کلاس هشتم از UI رد شد («جلسه در دسترس نیست»)') : bad('s5 از UI وارد شد!')
  await shot(ps5, '55-unauthorized-s5')

  const pfs = await ctxFS.newPage()
  await loginViaUI2(pfs, 'farzanegan.s1')
  await pfs.goto(`${BASE}/live/${SID3}`)
  await pfs.waitForTimeout(2500)
  const deniedFs = await pfs.locator('text=جلسه در دسترس نیست').first().isVisible().catch(() => false)
  deniedFs ? ok('دانش‌آموز مدرسه دیگر حتی وجود جلسه را نمی‌بیند (404)') : bad('fs1 از UI وارد شد!')
  await shot(pfs, '56-unauthorized-fs1')
  await ctxS5.close()
  await ctxFS.close()
} catch (e) {
  bad('خطای غیرمنتظره: ' + e.message)
} finally {
  await browser.close()
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`نتیجه مرورگر: ${pass} پاس / ${fail} خطا`)
process.exit(fail === 0 ? 0 : 1)

async function loginViaUI2(page, username) {
  await page.goto(`${BASE}/login`)
  await page.fill('#username', username)
  await page.fill('#password', 'Pass@123')
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 })
}
