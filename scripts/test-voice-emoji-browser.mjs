/**
 * تست E2E مرورگر — پیام صوتی (ویس) با موج + ایموجی‌پیکر در پیام‌رسان
 * میکروفون مجازی Chromium: --use-fake-device-for-media-stream
 * سناریو: ورود دانش‌آموز → گفتگوی خصوصی → ضبط ویس (موج زنده) → ارسال →
 * پلیر موج با پخش واقعی → ایموجی از کنار کامپوزر → ارسال → حباب ایموجی
 *
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-voice-emoji-browser.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅', m) }
const bad = (m) => { fail++; console.log('  ❌', m) }
const section = (m) => console.log(`\n▶ ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOT = '/home/z/my-project/download'

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ['microphone'],
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))

try {
  section('ورود دانش‌آموز و باز کردن گفتگوی خصوصی')
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="username"]', 'beheshti.s1')
  await page.fill('input[name="password"]', 'Pass@123')
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForLoadState('networkidle')
  ok('ورود beheshti.s1')

  await page.goto(`${BASE}/`)
  await sleep(1500)
  const dmItem = page.locator('ul li button', { hasText: 'رضا موسوی' }).first()
  await dmItem.waitFor({ state: 'visible', timeout: 15000 })
  await dmItem.click()
  await sleep(1800)
  const composer = page.locator('textarea[aria-label="متن پیام"]')
  await composer.waitFor({ state: 'visible', timeout: 10000 })
  ok('گفتگو باز شد و کامپوزر نمایان است')

  // ── دکمه‌های جدید کامپوزر ──
  section('دکمه‌های جدید کنار کامپوزر')
  const micBtn = page.locator('button[aria-label="ضبط پیام صوتی"]')
  const emojiBtn = page.locator('button[aria-label="افزودن ایموجی"]')
  ;(await micBtn.count()) === 1 ? ok('دکمه میکروفون کنار کامپوزر هست') : bad('دکمه میکروفون نیست')
  ;(await emojiBtn.count()) === 1 ? ok('دکمه ایموجی کنار کامپوزر هست') : bad('دکمه ایموجی نیست')

  // ── ضبط پیام صوتی ──
  section('ضبط پیام صوتی با موج زنده')
  // صبر تا وصل شدن سوکت (دکمه تا آن موقع disabled است)
  let micEnabled = false
  for (let i = 0; i < 30 && !micEnabled; i++) {
    micEnabled = !(await micBtn.isDisabled())
    if (!micEnabled) await sleep(500)
  }
  micEnabled ? ok('دکمه میکروفون فعال شد (سوکت متصل)') : bad('میکروفون بعد از ۱۵ ثانیه هنوز غیرفعال')
  const sendRec = page.locator('button[aria-label="ارسال پیام صوتی"]')
  let recOpen = false
  for (let i = 0; i < 5 && !recOpen; i++) {
    await micBtn.click()
    recOpen = await sendRec.isVisible().catch(() => false)
    if (!recOpen) await sleep(1500)
  }
  recOpen ? ok('پنل ضبط باز شد (میکروفون مجازی فعال)') : bad('پنل ضبط باز نشد')

  // موج زنده: پس از ~۱ ثانیه چند ستون جمع شده باشد
  await sleep(1100)
  const liveBars = await page.locator('.animate-pulse ~ div span, [class*="gap-[2px]"] span').count()
  liveBars > 4 ? ok(`موج زنده در حال رشد است (${liveBars} ستون)`) : bad('موج زنده جمع نشد')
  const timerTxt = await page.locator('text=/^[۰-۹]+:[۰-۹]{2}$/').first().innerText().catch(() => '')
  timerTxt ? ok(`تایمر ضبط فعال: ${timerTxt}`) : bad('تایمر ضبط دیده نشد')
  await page.screenshot({ path: `${SHOT}/131-voice-recording-live.png` })

  // چند ثانیه ضبط، سپس ارسال
  await sleep(2500)
  await sendRec.click()

  // پیام ویس با پلیر موج — audio از /api/attachments
  section('پلیر پیام ویس با موج')
  const lastAudio = page.locator('audio[src^="/api/attachments/"]').last()
  await lastAudio.waitFor({ state: 'attached', timeout: 20000 })
  ok('پیام ویس ارسال و از سرور برگشت (پیوست صوتی)')

  const playerBars = page.locator('[role="slider"][aria-label="نوار پیشرفت پیام صوتی"] span').last()
  await playerBars.waitFor({ state: 'visible', timeout: 10000 })
  const barCount = await page.locator('[role="slider"][aria-label="نوار پیشرفت پیام صوتی"]').last().locator('span').count()
  barCount >= 20 ? ok(`موج ذخیره‌شده در حباب رندر شد (${barCount} ستون)`) : bad(`ستون‌های موج کم است: ${barCount}`)

  // پخش واقعی — وضعیت دکمه عوض می‌شود
  const playBtn = page.locator('button[aria-label="پخش پیام صوتی"]').last()
  await playBtn.click()
  await sleep(700)
  const playing = await page.locator('button[aria-label="توقف پخش"]').count()
  playing >= 1 ? ok('پخش واقعی شروع شد (دکمه به توقف تغییر کرد)') : bad('پخش شروع نشد')
  const pos1 = await page.locator('[role="slider"][aria-label="نوار پیشرفت پیام صوتی"]').last().getAttribute('aria-valuenow')
  await sleep(1200)
  const pos2 = await page.locator('[role="slider"][aria-label="نوار پیشرفت پیام صوتی"]').last().getAttribute('aria-valuenow')
  Number(pos2) > Number(pos1) ? ok(`پیشرفت زمان جلو می‌رود (${pos1} → ${pos2} ثانیه)`) : bad(`پیشرفت ثابت ماند: ${pos1}→${pos2}`)
  await page.locator('button[aria-label="توقف پخش"]').last().click()
  await sleep(400)
  await page.screenshot({ path: `${SHOT}/132-voice-player-bubble.png` })

  // ── ایموجی ──
  section('ایموجی‌پیکر کنار کامپوزر')
  await emojiBtn.click()
  const gridBtn = page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').locator('button[aria-label^="ایموجی"]').first()
  await gridBtn.waitFor({ state: 'visible', timeout: 8000 })
  const emojiCount = await page.locator('[data-radix-popper-content-wrapper] button[aria-label^="ایموجی"]').count()
  emojiCount >= 30 ? ok(`پاپ‌آور ایموجی باز شد (${emojiCount} ایموجی در دسته)`) : bad(`ایموجی کم است: ${emojiCount}`)
  await page.screenshot({ path: `${SHOT}/133-emoji-picker-open.png` })

  // دسته مدرسه
  await page.locator('button[aria-label="مدرسه"]').click()
  await sleep(300)
  await page.locator('[data-radix-popper-content-wrapper] button[aria-label^="ایموجی"]').nth(0).click()
  await sleep(400)
  const taVal = await composer.inputValue()
  const hasEmoji = [...taVal].some((ch) => ch.codePointAt(0) > 0x2000)
  hasEmoji ? ok(`ایموجی در متن پیام درج شد: «${taVal}»`) : bad('ایموجی درج نشد')

  // ارسال با Enter
  await composer.press('Enter')
  await sleep(1500)
  const emojiBubble = page.locator('p.whitespace-pre-wrap', { hasText: taVal }).last()
  ;(await emojiBubble.count()) >= 1 ? ok('حباب پیام با ایموجی ثبت شد') : bad('حباب ایموجی نیامد')
  await page.screenshot({ path: `${SHOT}/134-emoji-message-sent.png` })

  // ── انصراف از ضبط ──
  section('انصراف از ضبط')
  let recOpen2 = false
  for (let i = 0; i < 5 && !recOpen2; i++) {
    await micBtn.click()
    recOpen2 = await sendRec.isVisible().catch(() => false)
    if (!recOpen2) await sleep(1500)
  }
  const countBefore = await page.locator('audio').count()
  await page.locator('button[aria-label="انصراف از ضبط"]').click()
  await sleep(600)
  const composerBack = await composer.isVisible()
  const noNewAudio = (await page.locator('audio').count()) === countBefore
  composerBack && noNewAudio ? ok('انصراف: پنل بسته شد و پیامی ساخته نشد') : bad('انصراف درست کار نکرد')
} catch (e) {
  bad(`خطای کلی: ${String(e).slice(0, 240)}`)
} finally {
  await browser.close()
  console.log(`\n═══ نتیجه: ${pass} پاس ✅ | ${fail} شکست ❌ ═══`)
  process.exit(fail > 0 ? 1 : 0)
}
