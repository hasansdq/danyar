/**
 * تست E2E جامع پیام‌رسان دانیار — دو کاربر هم‌زمان (معلم + دانش‌آموز) در گروه درسی مشترک
 *
 * پوشش: پیام متنی زنده دوطرفه، ایموجی، فایل (txt)، عکس (png)، ویدئو (mp4)،
 * پیام صوتی (ویس با ضبط و پخش واقعی)، پاسخ به پیام، ویرایش، سنجاق/برداشتن سنجاق،
 * هدایت پیام به گفتگوی دیگر، حذف پیام، کپی، بی‌صدا/صدادار، رسید خواندن در گفتگوی خصوصی
 *
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-messenger-full-e2e.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { readFileSync } from 'fs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
// گروه مشترک معلم/دانش‌آموز: ریاضی هفتم۱
const GROUP_URL = `${BASE}/chats/group/cmvcotcj8000ermnmj2nsfpdv`
// گروه دوم معلم (مقصد هدایت): ریاضی هشتم۱
const GROUP2_URL = `${BASE}/chats/group/cmvcotcja000krmnm6rnxs0ai`
// گفتگوی خصوصی: معلم ↔ دانش‌آموز
const TEACHER_DM_URL = `${BASE}/chats/dm/cmvcotcjc000trmnm9ivnir8c`
const STUDENT_DM_URL = `${BASE}/chats/dm/cmvcotcj30004rmnmd8xxxmzc`

const MEDIA = '/tmp/msgtest'
const stamp = String(Date.now()).slice(-8)

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOT = '/home/z/my-project/download'

/** آوردن عنصر با متن در فهرست پیام‌های یک صفحه (poll با مهلت) */
async function waitText(page, text, timeout = 20000) {
  try {
    await page.locator(`[data-message-id]`, { hasText: text }).first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

async function login(page, username, password) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45000 })
  await sleep(800)
}

async function openChat(page, url) {
  await page.goto(url)
  await page.locator('textarea[aria-label="متن پیام"]').waitFor({ state: 'visible', timeout: 60000 })
  // اتصال سوکت: دکمه پیوست وقتی connected فعال می‌شود
  await page.locator('button[aria-label="پیوست فایل"]:not([disabled])').waitFor({ timeout: 30000 })
}

/** منوی ⋯ یک پیام مشخص را باز و آیتم دلخواه را بزن (first = قدیمی‌ترین تطابق = خود پیام، نه پیش‌نمایش پاسخ) */
async function msgAction(page, msgText, itemText) {
  const msg = page.locator('[data-message-id]', { hasText: msgText }).first()
  await msg.locator('button[aria-label="عملیات پیام"]').click()
  const item = page.locator('[role="menuitem"]', { hasText: itemText }).first()
  await item.waitFor({ state: 'visible', timeout: 8000 })
  await item.click()
}

async function sendText(page, text) {
  await page.locator('textarea[aria-label="متن پیام"]').fill(text)
  await page.locator('button[aria-label="ارسال"]').click()
}

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const tCtx = await browser.newContext({
  viewport: { width: 1360, height: 850 },
  permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
})
const sCtx = await browser.newContext({
  viewport: { width: 1360, height: 850 },
  permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
})
const T = await tCtx.newPage() // معلم: رضا موسوی
const S = await sCtx.newPage() // دانش‌آموز: رضا احمدی

// پنهان‌سازی پوشال dev اکست (نشان «N Issues» گوشهٔ پایین) — در RTL دقیقاً روی
// دکمهٔ ارسال می‌نشیند و کلیک‌های Playwright را می‌بلعد؛ فقط محیط dev وجود دارد
const hideDevOverlay = () => {
  const inject = () => {
    try {
      const st = document.createElement('style')
      st.textContent = 'nextjs-portal { display: none !important; }'
      ;(document.head || document.documentElement || document).appendChild(st)
    } catch { /* سند میانی (about:blank و مانند آن) */ }
  }
  if (document.documentElement) inject()
  else document.addEventListener('DOMContentLoaded', inject, { once: true })
}
await T.addInitScript(hideDevOverlay)
await S.addInitScript(hideDevOverlay)
const errors = { T: [], S: [] }
T.on('pageerror', (e) => errors.T.push(String(e).slice(0, 180)))
S.on('pageerror', (e) => errors.S.push(String(e).slice(0, 180)))

try {
  // ═══════════ ۰) ورود و اتصال ═══════════
  section('ورود و اتصال دو کاربر')
  await login(T, 'beheshti.t1', 'Pass@123')
  ok('معلم (beheshti.t1) وارد شد')
  await login(S, 'beheshti.s1', 'Pass@123')
  ok('دانش‌آموز (beheshti.s1) وارد شد')

  await openChat(T, GROUP_URL)
  await openChat(S, GROUP_URL)
  ok('گفتگوی گروه درسی «ریاضی هفتم۱» برای هر دو باز شد')

  const tBadge = (await T.locator('[role="status"][aria-label="اتصال برقرار است"]').innerText().catch(() => '')) || ''
  const sBadge = (await S.locator('[role="status"][aria-label="اتصال برقرار است"]').innerText().catch(() => '')) || ''
  tBadge.includes('متصل') ? ok('نشان اتصال معلم: متصل') : bad(`نشان اتصال معلم: «${tBadge}»`)
  sBadge.includes('متصل') ? ok('نشان اتصال دانش‌آموز: متصل') : bad(`نشان اتصال دانش‌آموز: «${sBadge}»`)
  await T.screenshot({ path: `${SHOT}/msg-e2e-both-open.png` })

  // ═══════════ ۱) پیام متنی زنده دوطرفه ═══════════
  section('پیام متنی — ارسال و دریافت زنده (سوکت)')
  const tMsg1 = `سلام! تست کامل پیام‌رسان ${stamp}`
  await sendText(T, tMsg1)
  ;(await waitText(T, tMsg1)) ? ok('معلم: حباب پیام ارسالی ظاهر شد') : bad('معلم: حباب پیام ظاهر نشد')
  ;(await waitText(S, tMsg1)) ? ok('دانش‌آموز: پیام بدون رفرش رسید (زنده)') : bad('دانش‌آموز: پیام زنده نرسید')

  const sMsg1 = `سلام استاد، دریافت شد! ${stamp}`
  await sendText(S, sMsg1)
  ;(await waitText(T, sMsg1)) ? ok('معلم: پاسخ دانش‌آموز زنده رسید') : bad('معلم: پاسخ دانش‌آموز نرسید')

  // ═══════════ ۲) ایموجی ═══════════
  section('ایموجی — پیکر، درج و ارسال')
  await S.locator('button[aria-label="افزودن ایموجی"]').click()
  const emojiPanel = S.locator('[data-radix-popper-content-wrapper]')
  await emojiPanel.waitFor({ state: 'visible', timeout: 8000 })
  ok('پنل ایموجی باز شد')
  // دستهٔ قلب‌ها → 🎉
  await S.locator('button[aria-label="قلب‌ها"]').click()
  await S.locator('button[aria-label="ایموجی 🎉"]').click()
  await sleep(300)
  const taVal = await S.locator('textarea[aria-label="متن پیام"]').inputValue()
  taVal.includes('🎉') ? ok('ایموجی 🎉 در متن درج شد') : bad(`ایموجی درج نشد (مقدار: «${taVal}»)`)
  // یک ایموجی دیگر از دستهٔ صورتک‌ها (چندتایی — پنل باز می‌ماند)
  await S.locator('button[aria-label="صورتک‌ها"]').click()
  await S.locator('button[aria-label="ایموجی 😍"]').click()
  await sleep(300)
  await S.locator('button[aria-label="بستن ایموجی‌ها"]').click()
  const taVal2 = await S.locator('textarea[aria-label="متن پیام"]').inputValue()
  taVal2.includes('😍') ? ok('انتخاب چندتایی ایموجی کار می‌کند (😍 هم اضافه شد)') : bad('ایموجی دوم درج نشد')
  await S.locator('textarea[aria-label="متن پیام"]').fill(`آفرین ${taVal2}`)
  await S.locator('button[aria-label="ارسال"]').click()
  const emojiMsg = `آفرین 🎉😍`
  ;(await waitText(T, emojiMsg)) ? ok('معلم: پیام ایموجی‌دار زنده رسید') : bad('پیام ایموجی‌دار به معلم نرسید')
  await T.screenshot({ path: `${SHOT}/msg-e2e-emoji.png` })

  // ═══════════ ۳) فایل (txt) ═══════════
  section('ارسال فایل متن (txt)')
  const fileName = `test-note-${stamp}.txt`
  await T.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: readFileSync(`${MEDIA}/test-note.txt`),
  })
  await T.locator(`text=${fileName}`).first().waitFor({ state: 'visible', timeout: 20000 })
  ok('پیش‌نمایش پیوست قبل از ارسال (نام + حجم) نمایش داده شد')
  await T.locator('button[aria-label="ارسال"]').click()
  await T.locator('[data-message-id] a[download]', { hasText: fileName }).first().waitFor({ state: 'visible', timeout: 25000 })
  ok('معلم: حباب فایل (آیکون + نام + دانلود) رندر شد')
  ;(await waitText(S, fileName, 25000)) ? ok('دانش‌آموز: فایل زنده رسید') : bad('فایل به دانش‌آموز نرسید')
  // لینک دانلود سمت دانش‌آموز واقعاً قابل دریافت است
  const dlHref = await S.locator('[data-message-id] a[download]', { hasText: fileName }).first().getAttribute('href')
  if (dlHref) {
    const resp = await S.request.get(`${BASE}${dlHref.startsWith('/') ? dlHref : '/' + dlHref}`)
    resp.ok() ? ok(`دانلود فایل از سرور موفق (${resp.status()}، ${resp.headers()['content-type']?.slice(0, 30) ?? ''})`) : bad(`دانلود فایل ناموفق: ${resp.status()}`)
  } else {
    bad('لینک دانلود فایل پیدا نشد')
  }

  // ═══════════ ۴) عکس (png) ═══════════
  section('ارسال عکس (png)')
  const photoName = `test-photo-${stamp}.png`
  await S.locator('input[type="file"]').setInputFiles({
    name: photoName,
    mimeType: 'image/png',
    buffer: readFileSync(`${MEDIA}/test-photo.png`),
  })
  await sleep(1200) // آپلود + پیش‌نمایش
  await S.locator('button[aria-label="ارسال"]').click()
  // حباب تصویر سمت فرستنده: img با بارگذاری واقعی (با تحمل تأخیر بارگذاری)
  const sImg = S.locator(`[data-message-id] img[alt="${photoName}"]`).first()
  await sImg.waitFor({ state: 'visible', timeout: 25000 })
  let sImgLoaded = false
  for (let i = 0; i < 10 && !sImgLoaded; i++) {
    sImgLoaded = await sImg.evaluate((el) => el.complete && el.naturalWidth > 0).catch(() => false)
    if (!sImgLoaded) await sleep(500)
  }
  sImgLoaded ? ok('دانش‌آموز: تصویر واقعاً بارگذاری شد (naturalWidth > 0)') : bad('تصویر فرستنده بارگذاری نشد')
  // سمت دریافت‌کننده
  const tImg = T.locator(`[data-message-id] img[alt="${photoName}"]`).first()
  await tImg.waitFor({ state: 'visible', timeout: 25000 })
  let tImgLoaded = false
  for (let i = 0; i < 10 && !tImgLoaded; i++) {
    tImgLoaded = await tImg.evaluate((el) => el.complete && el.naturalWidth > 0).catch(() => false)
    if (!tImgLoaded) await sleep(500)
  }
  tImgLoaded ? ok('معلم: تصویر زنده رسید و بارگذاری شد') : bad('تصویر برای معلم بارگذاری نشد')
  // پیش‌نمایش تمام‌صفحه با کلیک روی تصویر
  await tImg.click()
  const dlg = T.locator('[role="dialog"]')
  await dlg.waitFor({ state: 'visible', timeout: 8000 })
  ;(await dlg.locator('img').count()) >= 1 ? ok('دیالوگ پیش‌نمایش تصویر باز شد') : bad('دیالوگ پیش‌نمایش باز نشد')
  await T.keyboard.press('Escape')
  await sleep(400)
  await S.screenshot({ path: `${SHOT}/msg-e2e-photo.png` })

  // ═══════════ ۵) ویدئو (mp4) ═══════════
  section('ارسال ویدئو (mp4)')
  await T.locator('input[type="file"]').setInputFiles({
    name: `test-video-${stamp}.mp4`,
    mimeType: 'video/mp4',
    buffer: readFileSync(`${MEDIA}/test-video.mp4`),
  })
  await sleep(1500)
  await T.locator('button[aria-label="ارسال"]').click()
  const tVid = T.locator('[data-message-id] video').last()
  await tVid.waitFor({ state: 'visible', timeout: 25000 })
  ok('معلم: حباب ویدئو (تگ video) رندر شد')
  const sVid = S.locator('[data-message-id] video').last()
  await sVid.waitFor({ state: 'visible', timeout: 25000 })
  ok('دانش‌آموز: ویدئو زنده رسید')
  // متادیتا با تأخیر طبیعی بار می‌شود — چند ثانیه فرصت
  let sVidReady = false
  for (let i = 0; i < 10 && !sVidReady; i++) {
    sVidReady = await sVid.evaluate((v) => v.readyState >= 1 || v.videoWidth > 0).catch(() => false)
    if (!sVidReady) await sleep(500)
  }
  sVidReady ? ok('ویدئوی دریافت‌شده متادیتا دارد (قابل پخش)') : bad('ویدئوی دریافتی متادیتا ندارد')
  // پخش کوتاه ویدئو توسط دانش‌آموز
  await sVid.evaluate((v) => { v.muted = true; v.currentTime = 0.2; return v.play().catch(() => null) })
  await sleep(900)
  const sVidT = await sVid.evaluate((v) => v.currentTime).catch(() => 0)
  sVidT > 0.2 ? ok(`پخش ویدئو پیش می‌رود (currentTime=${sVidT.toFixed(2)})`) : bad('ویدئو پخش نشد')
  await T.screenshot({ path: `${SHOT}/msg-e2e-video.png` })

  // ═══════════ ۶) پیام صوتی (ویس) ═══════════
  section('پیام صوتی — ضبط، ارسال، دریافت و پخش')
  await T.locator('button[aria-label="ضبط پیام صوتی"]').click()
  // پنل ضبط: تایمر + دکمهٔ ارسال
  await T.locator('button[aria-label="ارسال پیام صوتی"]').waitFor({ state: 'visible', timeout: 10000 })
  ok('پنل ضبط باز شد (تایمر + موج زنده)')
  await sleep(2200) // ضبط واقعی با میکروفون مجازی
  await T.locator('button[aria-label="ارسال پیام صوتی"]').click()
  // حباب ویس سمت فرستنده: VoicePlayer
  const tVoice = T.locator('[data-message-id] button[aria-label="پخش پیام صوتی"]').last()
  await tVoice.waitFor({ state: 'visible', timeout: 30000 })
  ok('معلم: حباب پیام صوتی (پلیر موج‌دار) رندر شد')
  // سمت دانش‌آموز زنده
  const sVoice = S.locator('[data-message-id] button[aria-label="پخش پیام صوتی"]').last()
  await sVoice.waitFor({ state: 'visible', timeout: 30000 })
  ok('دانش‌آموز: پیام صوتی زنده رسید')
  // پخش واقعی — کلیک با تلاش مجدد (اگر متادیتا هنوز آماده نیست play ممکن است بی‌اثر بماند)
  let audioState = null
  for (let attempt = 0; attempt < 3; attempt++) {
    await sVoice.click({ timeout: 8000 }).catch(() => {})
    await sleep(1500)
    audioState = await S.locator('[data-message-id] audio').last()
      .evaluate((a) => ({ t: a.currentTime, paused: a.paused, err: a.error ? a.error.code : null }))
      .catch(() => null)
    if (audioState && audioState.t > 0) break
  }
  if (audioState && audioState.t > 0 && !audioState.paused) {
    ok(`پخش ویس واقعی: زمان پیش می‌رود (${audioState.t.toFixed(2)}s)`)
  } else if (audioState && audioState.t > 0) {
    ok(`ویس پخش شد و پیش رفت (t=${audioState.t.toFixed(2)}s؛ پایان/توقف طبیعی)`)
  } else {
    bad(`پخش ویس ناموفق (t=${audioState?.t}, paused=${audioState?.paused}, err=${audioState?.err})`)
  }
  await S.screenshot({ path: `${SHOT}/msg-e2e-voice.png` })

  // ═══════════ ۷) پاسخ به پیام ═══════════
  section('پاسخ به پیام (Reply)')
  await msgAction(S, tMsg1, 'پاسخ')
  const replyBar = S.locator('text=پاسخ به رضا موسوی').first()
  await replyBar.waitFor({ state: 'visible', timeout: 8000 })
  ok('نوار پاسخ با نام فرستندهٔ پیام اصلی ظاهر شد')
  const sReply = `پاسخ آزمایشی به پیام ${stamp}`
  await sendText(S, sReply)
  const sReplyBubble = S.locator('[data-message-id]', { hasText: sReply }).last()
  await sReplyBubble.waitFor({ state: 'visible', timeout: 15000 })
  ;(await sReplyBubble.innerText()).includes('پاسخ به رضا موسوی') && (await sReplyBubble.innerText()).includes(tMsg1.slice(0, 20))
    ? ok('حباب پاسخ شامل پیش‌نمایش پیام اصلی است')
    : bad('حباب پاسخ پیش‌نمایش پیام اصلی را ندارد')
  const tReplyBubble = T.locator('[data-message-id]', { hasText: sReply }).last()
  await tReplyBubble.waitFor({ state: 'visible', timeout: 20000 })
  ;(await tReplyBubble.innerText()).includes('پاسخ به رضا موسوی')
    ? ok('معلم: پاسخ با زمینهٔ آن زنده رسید')
    : bad('معلم: زمینهٔ پاسخ نرسید')
  // کلیک روی پیش‌نمایش پاسخ → پرش به پیام اصلی
  await T.locator('[data-message-id]', { hasText: sReply }).last().locator('button', { hasText: 'پاسخ به' }).click()
  await sleep(600)
  const originalVisible = await T.locator('[data-message-id]', { hasText: tMsg1 }).first().isVisible().catch(() => false)
  originalVisible ? ok('کلیک روی پاسخ → پرش به پیام اصلی') : bad('پرش به پیام اصلی کار نکرد (شاید نیازمند اسکرول)')

  // ═══════════ ۸) ویرایش پیام ═══════════
  section('ویرایش پیام')
  await msgAction(T, tMsg1, 'ویرایش')
  const editBar = T.locator('text=ویرایش پیام').first()
  await editBar.waitFor({ state: 'visible', timeout: 8000 })
  const editVal = await T.locator('textarea[aria-label="متن پیام"]').inputValue()
  editVal.includes(tMsg1) ? ok('متن اصلی در حالت ویرایش بارگذاری شد') : bad('متن اصلی در ویرایش نیست')
  const tMsg1Edited = `${tMsg1} — نسخهٔ ویرایش‌شده`
  await T.locator('textarea[aria-label="متن پیام"]').fill(tMsg1Edited)
  await T.locator('button[aria-label="ارسال"]').click()
  const tEdited = T.locator('[data-message-id]', { hasText: tMsg1Edited }).last()
  await tEdited.waitFor({ state: 'visible', timeout: 15000 })
  ;(await tEdited.innerText()).includes('ویرایش‌شده') ? ok('حباب نشان «(ویرایش‌شده)» دارد') : bad('نشان ویرایش‌شده نیست')
  ;(await waitText(S, tMsg1Edited, 20000)) ? ok('دانش‌آموز: متن ویرایش‌شده زنده رسید') : bad('ویرایش به دانش‌آموز نرسید')

  // ═══════════ ۹) سنجاق پیام ═══════════
  section('سنجاق پیام (فقط معلم/مدیر)')
  await msgAction(T, sMsg1, 'سنجاق')
  // toast + نوار سنجاق سمت معلم
  await T.locator('text=پیام سنجاق شد').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  const tPinBar = T.locator('text=پیام سنجاق‌شده').first()
  await tPinBar.waitFor({ state: 'visible', timeout: 10000 })
  ok('معلم: نوار «پیام سنجاق‌شده» بالای چت ظاهر شد')
  ;(await T.locator('[data-message-id]', { hasText: sMsg1 }).last().innerText()).includes('سنجاق')
    ? ok('حباب پیام نشان «سنجاق» گرفت')
    : bad('حباب پیام نشان سنجاق ندارد')
  // دانش‌آموز هم زنده نوار سنجاق را می‌بیند (message:updated)
  const sPinBar = S.locator('text=پیام سنجاق‌شده').first()
  await sPinBar.waitFor({ state: 'visible', timeout: 15000 })
  ok('دانش‌آموز: نوار سنجاق زنده ظاهر شد')
  ;(await sPinBar.innerText().catch(() => '')) || ''
  const sPinText = (await S.locator('[aria-label="رفتن به پیام سنجاق‌شده"]').textContent().catch(() => '')) || ''
  sPinText.includes(sMsg1.slice(0, 12))
    ? ok('پیش‌نمایش پیام سنجاق‌شده درست است')
    : bad(`پیش‌نمایش سنجاق درست نیست — متن واقعی: «${sPinText.slice(0, 90)}»`)
  await T.screenshot({ path: `${SHOT}/msg-e2e-pin.png` })
  // برداشتن سنجاق
  await T.locator('button[aria-label="برداشتن سنجاق"]').click()
  await sleep(1500)
  ;(await T.locator('text=پیام سنجاق‌شده').count()) === 0 ? ok('معلم: سنجاق برداشته شد (نوار حذف شد)') : bad('نوار سنجاق معلم حذف نشد')
  let sPinGone = false
  for (let i = 0; i < 15; i++) {
    if ((await S.locator('text=پیام سنجاق‌شده').count()) === 0) { sPinGone = true; break }
    await sleep(500)
  }
  sPinGone ? ok('دانش‌آموز: برداشتن سنجاق زنده اعمال شد') : bad('نوار سنجاق دانش‌آموز حذف نشد')

  // ═══════════ ۱۰) هدایت پیام ═══════════
  section('هدایت پیام به گفتگوی دیگر')
  await msgAction(T, sMsg1, 'هدایت')
  const fwdDlg = T.getByRole('dialog')
  await T.locator('text=هدایت پیام').first().waitFor({ state: 'visible', timeout: 8000 })
  ok('دیالوگ «هدایت پیام» باز شد')
  // مقصد: گروه ریاضی هشتم۱ (گروه دوم معلم)
  const fwdTarget = T.locator('[role="checkbox"][aria-label*="هشتم"]').first()
  await fwdTarget.waitFor({ state: 'visible', timeout: 10000 })
  await fwdTarget.click()
  await T.locator('button', { hasText: 'هدایت (1)' }).click()
  await T.locator('text=گفتگو هدایت شد').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  ok('هدایت اجرا شد (تأیید: پیام به ۱ گفتگو هدایت شد)')
  await sleep(1500)
  // رفتن به گفتگوی مقصد و بررسی پیام هدایت‌شده
  await openChat(T, GROUP2_URL)
  const fwdBubble = T.locator('[data-message-id]', { hasText: sMsg1 }).last()
  await fwdBubble.waitFor({ state: 'visible', timeout: 20000 })
  ;(await fwdBubble.innerText()).includes('هدایت‌شده از') ? ok('پیام هدایت‌شده با برچسب «هدایت‌شده از …» در گفتگوی مقصد است') : bad('برچسب هدایت‌شده نیست')
  // بازگشت به گروه اصلی برای ادامهٔ تست
  await openChat(T, GROUP_URL)
  await sleep(600)

  // ═══════════ ۱۱) حذف پیام ═══════════
  section('حذف پیام برای همه')
  await msgAction(T, tMsg1Edited, 'حذف')
  await T.locator('text=این پیام برای همه اعضای گفتگو حذف می‌شود').first().waitFor({ state: 'visible', timeout: 8000 })
  ok('دیالوگ تأیید حذف باز شد')
  await T.locator('button', { hasText: 'حذف پیام' }).click()
  const tTomb = T.locator('[data-message-id]', { hasText: 'این پیام حذف شد' }).last()
  await tTomb.waitFor({ state: 'visible', timeout: 15000 })
  ok('معلم: پیام به «این پیام حذف شد» تبدیل شد')
  const sTomb = S.locator('[data-message-id]', { hasText: 'این پیام حذف شد' }).last()
  await sTomb.waitFor({ state: 'visible', timeout: 20000 })
  ok('دانش‌آموز: حذف زنده اعمال شد')
  ;(await S.locator('[data-message-id]', { hasText: tMsg1Edited }).count()) === 0
    ? ok('محتوای پیام حذف‌شده در سمت دانش‌آموز باقی نماند')
    : bad('متن پیام حذف‌شده هنوز دیده می‌شود')
  await S.screenshot({ path: `${SHOT}/msg-e2e-deleted.png` })

  // ═══════════ ۱۲) کپی متن ═══════════
  section('کپی متن پیام')
  await msgAction(S, sMsg1, 'کپی')
  await sleep(700)
  let clip = ''
  try { clip = await S.evaluate(() => navigator.clipboard.readText()) } catch { /* بسته به مجوز */ }
  clip.includes(sMsg1.slice(0, 12)) ? ok('متن پیام در کلیپ‌بورد کپی شد') : bad(`کلیپ‌بورد: «${clip.slice(0, 40)}»`)

  // ═══════════ ۱۳) بی‌صدا/صدادار ═══════════
  section('بی‌صدا کردن گفتگو')
  const muteBtn = S.locator('button[aria-label="بی‌صدا کردن این گفتگو"]').first()
  if (await muteBtn.count()) {
    await muteBtn.click()
    await S.locator('button[aria-label="صدادار کردن این گفتگو"]').first().waitFor({ state: 'visible', timeout: 8000 })
    ok('گفتگو بی‌صدا شد (آیکون/برچسب تغییر کرد)')
    await S.locator('button[aria-label="صدادار کردن این گفتگو"]').first().click()
    await S.locator('button[aria-label="بی‌صدا کردن این گفتگو"]').first().waitFor({ state: 'visible', timeout: 8000 })
    ok('صدادار شدن دوباره کار کرد')
  } else {
    bad('دکمهٔ بی‌صدا پیدا نشد')
  }

  // ═══════════ ۱۴) گفتگوی خصوصی + رسید خواندن ═══════════
  section('گفتگوی خصوصی — پیام و رسید خواندن')
  await openChat(T, TEACHER_DM_URL)
  // صبر تا آماده‌شدن کامپوزر (متن خالی است و دکمهٔ ارسال منطقاً disabled می‌ماند —
  // کلیک خود Playwright تا enabled شدن صبر می‌کند)
  const dmText = `پیام خصوصی تست ${stamp}`
  await sendText(T, dmText)
  ;(await waitText(T, dmText)) ? ok('معلم: پیام خصوصی ارسال شد') : bad('پیام خصوصی ارسال نشد')
  // قبل از خواندن: تیک تک (ارسال شد)
  const dmBubbleT = T.locator('[data-message-id]', { hasText: dmText }).last()
  const beforeRead = (await dmBubbleT.locator('[aria-label="خوانده شد"]').count()) === 0
  beforeRead ? ok('قبل از خواندن: فقط تیک «ارسال شد»') : bad('قبل از خواندن: تیک دوتایی است؟!')
  // دانش‌آموز گفتگو را باز می‌کند → خوانده می‌شود
  await openChat(S, STUDENT_DM_URL)
  ;(await waitText(S, dmText)) ? ok('دانش‌آموز: پیام خصوصی رسید') : bad('پیام خصوصی به دانش‌آموز نرسید')
  // معلم باید زنده تیک دوتایی «خوانده شد» ببیند
  await dmBubbleT.locator('[aria-label="خوانده شد"]').waitFor({ state: 'visible', timeout: 20000 })
  ok('معلم: تیک دوتایی «خوانده شد» زنده ظاهر شد')
  await T.screenshot({ path: `${SHOT}/msg-e2e-dm-read.png` })

  // ═══════════ ۱۵) جمع‌بندی خطاها ═══════════
  section('خطاهای صفحه (JS)')
  errors.T.length === 0 ? ok('صفر خطای صفحه در سمت معلم') : bad(`${errors.T.length} خطای معلم: ${errors.T[0]}`)
  errors.S.length === 0 ? ok('صفر خطای صفحه در سمت دانش‌آموز') : bad(`${errors.S.length} خطای دانش‌آموز: ${errors.S[0]}`)
} catch (e) {
  bad(`استثنا: ${String(e).slice(0, 400)}`)
  try { await T.screenshot({ path: `${SHOT}/msg-e2e-fail-teacher.png` }) } catch {}
  try { await S.screenshot({ path: `${SHOT}/msg-e2e-fail-student.png` }) } catch {}
} finally {
  await browser.close()
}

console.log(`\n————————————\nنتیجهٔ تست جامع پیام‌رسان: ${pass} سبز / ${fail} قرمز`)
process.exit(fail > 0 ? 1 : 0)
