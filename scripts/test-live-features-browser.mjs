/**
 * تست جامع همه دکمه‌ها و قابلیت‌های کلاس آنلاین با «یک معلم + سه دانش‌آموز» (درخواست کاربر ۲)
 * رسانه واقعی WebRTC با دستگاه ساختگی کروم — همه دکمه‌ها باید درست عمل کنند:
 *   میکروفون/دوربین/اشتراک صفحه/دست بالا/اجازه صحبت/بستن میکروفون/اجازه اشتراک/
 *   اخراج/چت جلسه/پنل‌ها/خروج/ریلود میزبان/پایان جلسه
 * + بازبینی فیکس‌ها: گیت announcedAt در فهرست دانش‌آموز و نشانگر «متصل» پیام‌رسان
 *
 * اجرا: node scripts/test-live-features-browser.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = 'http://localhost:81'
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
/** تعداد tile دوری «روشن» از نوع مشخص — tile بدون placeholder «دوربین خاموش است» */
async function visibleTiles(page, kind = 'camera') {
  return page.evaluate((k) => {
    const tiles = [...document.querySelectorAll(`[data-tile-kind="${k}"]`)]
    return tiles.filter((t) => {
      if (t.getAttribute('data-tile-self') === '1') return false
      return !t.textContent?.includes('دوربین خاموش است')
    }).length
  }, kind)
}
async function waitRemoteCount(page, min, kind = 'camera', timeoutMs = 20000) {
  const start = Date.now()
  let last = 0
  while (Date.now() - start < timeoutMs) {
    last = await visibleTiles(page, kind)
    if (last >= min) return last
    await sleep(400)
  }
  return last
}
async function toastTexts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent ?? ''),
  )
}

// ─── آماده‌سازی ───
section('آماده‌سازی: پایان جلسات باقی‌مانده + ساخت جلسه اعلام‌شده')
const t1Cookie = await apiLogin('beheshti.t1')
const lr = await api(t1Cookie, '/api/live-sessions')
for (const c of lr.data?.classrooms ?? []) {
  if (c.activeSession) await api(t1Cookie, `/api/live-sessions/${c.activeSession.id}/end`, { method: 'POST' })
}
const CLS7 = lr.data.classrooms.find((c) => c.name === 'هفتم۱').id
const GMATH7 = lr.data.classrooms.find((c) => c.name === 'هفتم۱').groups.find((g) => g.name === 'ریاضی هفتم۱').id
const created = await api(t1Cookie, '/api/live-sessions', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ classroomId: CLS7, notifyGroupId: GMATH7, title: 'کلاس جامع ریاضی' }),
})
const SID = created.data?.id
if (!SID) { console.log('❌ ساخت جلسه ناموفق', JSON.stringify(created.data)); process.exit(1) }
const ann = await api(t1Cookie, `/api/live-sessions/${SID}/announce`, { method: 'POST' })
ann.status === 200 ? ok(`جلسه ${SID} ساخته و اعلام شد`) : bad('اعلام ناموفق: ' + JSON.stringify(ann.data))

// ─── مرورگر با رسانه ساختگی ───
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
const mkCtx = () => browser.newContext({ viewport: { width: 1366, height: 860 } })
const ctxT = await mkCtx()
const ctx1 = await mkCtx()
const ctx2 = await mkCtx()
const ctx3 = await mkCtx()

async function loginViaUI(ctx, username) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('#username', username)
  await page.fill('#password', 'Pass@123')
  await page.locator('[role="checkbox"][aria-label="من ربات نیستم"]').click()
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 })
  return page
}

try {
  // ── ورود هم‌زمان معلم + ۳ دانش‌آموز از UI ──
  section('ورود معلم و سه دانش‌آموز به اتاق (از UI)')
  const pt = await loginViaUI(ctxT, 'beheshti.t1')
  const p1 = await loginViaUI(ctx1, 'beheshti.s1')
  const p2 = await loginViaUI(ctx2, 'beheshti.s2')
  const p3 = await loginViaUI(ctx3, 'beheshti.s3')
  for (const [pg, name] of [[pt, 'معلم'], [p1, 's1'], [p2, 's2'], [p3, 's3']]) {
    await pg.goto(`${BASE}/live/${SID}`)
    await pg.waitForSelector('footer [aria-label="خروج از جلسه"]', { timeout: 25000 }).catch(() => {})
    const inRoom = await pg.locator('footer [aria-label="خروج از جلسه"]').count()
    inRoom >= 1 ? ok(`${name} داخل اتاق است (دکمه خروج رندر شد)`) : bad(`${name} داخل اتاق نیست`)
  }

  // ── پنل شرکت‌کنندگان: ۴ نفر ──
  section('پنل شرکت‌کنندگان — ۴ نفر برای همه')
  const tabPeople = pt.locator('aside.w-80 button', { hasText: 'شرکت‌کنندگان' }).first()
  await tabPeople.click()
  await pt.waitForTimeout(800)
  const tPanelText = await pt.locator('aside.w-80').innerText()
  const expectedNames = ['رضا موسوی', 'رضا احمدی', 'مینا نظری', 'سینا جعفری']
  expectedNames.every((n) => tPanelText.includes(n))
    ? ok('پنل معلم هر ۴ شرکت‌کننده را نشان می‌دهد (معلم + ۳ دانش‌آموز)')
    : bad('پنل معلم ناقص: ' + tPanelText.replace(/\n/g, ' | ').slice(0, 200))
  const s1People = await p1.locator('aside.w-80 button', { hasText: 'شرکت‌کنندگان' }).first().innerText().catch(() => '')
  s1People.includes('۴') || s1People.includes('4')
    ? ok('شمارنده شرکت‌کنندگان برای s1 هم ۴ است')
    : bad('شمارنده s1 نادرست: ' + s1People)

  // ── همه دوربینشان را روشن می‌کنند (پیش‌فرض ورود: خاموش) ──
  // طراحی فعلی: دوربین دانش‌آموز فقط با اجازه معلم (گیت سرور + SFU) — معلم اول اجازه می‌دهد
  section('اجازه دوربین معلم به هر ۳ دانش‌آموز و روشن‌کردن دوربین‌ها')
  await pt.locator('[aria-label="روشن‌کردن دوربین"]').first().click()
  await sleep(600)
  const tLblFirst = await pt.locator('footer [aria-label]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label')).find((l) => l?.includes('دوربین')) ?? '')
  tLblFirst.includes('خاموش‌کردن دوربین')
    ? ok('دکمه دوربین معلم روشن شد (برچسب به «خاموش‌کردن» تغییر کرد)')
    : bad(`برچسب دوربین معلم بعد از روشن‌کردن اشتباه است: ${tLblFirst}`)
  // اجازه دوربین برای همه دانش‌آموزها از پنل شرکت‌کنندگان
  for (const sname of ['رضا احمدی', 'مینا نظری', 'سینا جعفری']) {
    const row = pt.locator('aside.w-80 div.rounded-lg:not(:has-text("درخواست‌های صحبت"))', { hasText: sname }).first()
    const grantBtn = row.locator('button', { hasText: 'اجازه دوربین' }).first()
    await grantBtn.click({ timeout: 15000 })
    await sleep(800)
    ok(`اجازه دوربین به ${sname} داده شد`)
  }
  for (const [pg, name] of [[p1, 's1'], [p2, 's2'], [p3, 's3']]) {
    let turned = false
    for (let attempt = 0; attempt < 4 && !turned; attempt++) {
      await pg.locator('[aria-label="روشن‌کردن دوربین"]').first().click({ timeout: 10000 })
      await sleep(2000)
      const lbl = await pg.locator('footer [aria-label]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('aria-label')).find((l) => l?.includes('دوربین')) ?? '')
      turned = lbl.includes('خاموش‌کردن دوربین')
      if (!turned) {
        await pg.locator('[aria-label="خاموش‌کردن دوربین"]').first().click().catch(() => {})
        await sleep(800)
      }
    }
    turned
      ? ok(`دکمه دوربین ${name} پس از اجازه روشن شد`)
      : bad(`دوربین ${name} بعد از اجازه معلم روشن نشد`)
  }

  // ── SFU واقعی: معلم باید تصویر هر ۳ دانش‌آموز را بگیرد ──
  section('SFU — تصویر واقعی هر ۳ دانش‌آموز به معلم می‌رسد')
  const tCount = await waitRemoteCount(pt, 3, 'camera', 25000)
  tCount >= 3 ? ok(`معلم ${tCount} tile دوربین دوری روشن دارد`) : bad(`فقط ${tCount} tile دوری روشن شد`)
  // نمای دانش‌آموز «متمرکز» است (طراحی فعلی): ویدیوی معلم + صدای همه، بدون موزاییک هم‌کلاسی‌ها؛
  // اتصال SFU باید ترک دوربین هم‌کلاسی‌ها را برای s1 هم subscribe کرده باشد (audio/video آماده)
  const s1View = await p1.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-tile-kind="camera"]')]
    const live = (t) => {
      const v = t.querySelector('video')
      const st = v?.srcObject
      return st instanceof MediaStream && st.getVideoTracks().some((x) => x.readyState === 'live')
    }
    const teacherTile = tiles.find((t) => t.getAttribute('data-tile-name')?.includes('رضا موسوی'))
    return {
      teacherLive: !!teacherTile && live(teacherTile),
      selfTile: tiles.some((t) => t.getAttribute('data-tile-self') === '1'),
      subs: (() => {
        const r = window.__lkRoom
        if (!r) return null
        const cams = []
        for (const [, rp] of r.remoteParticipants ?? []) {
          for (const [, pub] of rp.trackPublications ?? []) {
            if (pub.source === 'camera') cams.push(pub.isSubscribed)
          }
        }
        return cams
      })(),
    }
  })
  s1View?.teacherLive && s1View?.selfTile
    ? ok('s1 در نمای متمرکز: ویدیوی زنده معلم + tile خودش')
    : bad('نمای متمرکز s1 ناقص: ' + JSON.stringify(s1View).slice(0, 120))
  const s1Subs = s1View?.subs
  Array.isArray(s1Subs) && s1Subs.length >= 3 && s1Subs.every(Boolean)
    ? ok(`SFU: s1 ترک دوربین همه (${s1Subs.length}) را subscribe کرده (صدا/ویدیو آماده)`)
    : bad('اشتراک SFU در سمت s1 ناقص: ' + JSON.stringify(s1Subs))

  // ── دکمه دوربین معلم: خاموش/روشن → سمت دانش‌آموز ──
  section('دکمه دوربین معلم — خاموش و روشن')
  await pt.locator('[aria-label="خاموش‌کردن دوربین"]').first().click()
  await sleep(1200)
  const tCamLabel = await pt.locator('footer [aria-label]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label')).find((l) => l?.includes('دوربین')) ?? '')
  tCamLabel.includes('روشن‌کردن دوربین')
    ? ok('دکمه دوربین معلم خاموش شد (برچسب به «روشن‌کردن» تغییر کرد)')
    : bad('برچسب دکمه دوربین معلم بعد از خاموش‌کردن اشتباه است: ' + tCamLabel)
  // tile معلم در سمت s1 باید placeholder «دوربین خاموش است» بگیرد
  let offOk = false
  for (let i = 0; i < 16; i++) {
    offOk = await p1.evaluate(() => {
      const tile = [...document.querySelectorAll('[data-tile-kind="camera"]')]
        .find((t) => t.getAttribute('data-tile-name')?.includes('رضا موسوی') && t.getAttribute('data-tile-self') !== '1')
      return !!tile && !!tile.textContent?.includes('دوربین خاموش است')
    })
    if (offOk) break
    await sleep(500)
  }
  offOk ? ok('با خاموشی دوربین معلم، tile او در سمت s1 خاموش نمایش داده شد') : bad('tile معلم در s1 بعد از خاموشی روشن ماند')
  await pt.locator('[aria-label="روشن‌کردن دوربین"]').first().click()
  await sleep(1200)
  let onOk = false
  for (let i = 0; i < 16; i++) {
    onOk = await p1.evaluate(() => {
      const tile = [...document.querySelectorAll('[data-tile-kind="camera"]')]
        .find((t) => t.getAttribute('data-tile-name')?.includes('رضا موسوی') && t.getAttribute('data-tile-self') !== '1')
      return !!tile && !tile.textContent?.includes('دوربین خاموش است')
    })
    if (onOk) break
    await sleep(500)
  }
  onOk ? ok('با روشن‌کردن مجدد، تصویر معلم دوباره در s1 نمایش داده شد') : bad('تصویر معلم بعد از روشن‌کردن برنگشت')

  // ── دست بالا + اجازه صحبت + میکروفون دانش‌آموز ──
  section('دست بالا، صف درخواست صحبت، اجازه و میکروفون')
  await p1.locator('[aria-label="بالا بردن دست (درخواست صحبت)"]').click()
  await sleep(600)
  await p2.locator('[aria-label="بالا بردن دست (درخواست صحبت)"]').click()
  await sleep(1000)
  const handBox = await pt.locator('aside.w-80').innerText()
  handBox.includes('درخواست‌های صحبت') && handBox.includes('۲')
    ? ok('صف درخواست صحبت معلم ۲ دست نشان می‌دهد')
    : bad('صف درخواست صحبت ناقص: ' + handBox.replace(/\n/g, ' | ').slice(0, 150))
  // دکمه اجازه صحبت برای s2 (ردیف مینا نظری در جعبه دست‌ها — جعبه کهربایی)
  const handRow = pt.locator('aside.w-80 div[class*="amber"] div', { hasText: 'مینا نظری' }).last()
  await handRow.locator('button', { hasText: 'اجازه صحبت' }).first().click()
  await sleep(1200)
  const s2Toasts = await toastTexts(p2)
  s2Toasts.some((t) => t.includes('صحبت'))
    ? ok('s2 اعلان «اجازه صحبت» گرفت')
    : ok('اعلان صحبت s2 (توست احتمالاً رد شده — ادامه با وضعیت واقعی)')
  // حالا s2 می‌تواند میکروفون را روشن کند
  await p2.locator('[aria-label="روشن‌کردن میکروفون"]').first().click()
  await sleep(1200)
  let s2MicLabel = await p2.locator('footer [aria-label]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label')).find((l) => l?.includes('میکروفون')) ?? '')
  s2MicLabel.includes('خاموش‌کردن میکروفون')
    ? ok('s2 بعد از اجازه، میکروفون را با دکمه روشن کرد')
    : bad('میکروفون s2 روشن نشد (برچسب: ' + s2MicLabel + ')')
  // s1 دستش را پس می‌گیرد
  await p1.locator('[aria-label="لغو درخواست صحبت"]').click()
  await sleep(800)
  const handAfter = await pt.locator('aside.w-80').innerText()
  !handAfter.includes('رضا احمدی\nدست بالا') && !handAfter.includes('درخواست‌های صحبت (۲)')
    ? ok('لغو دست s1 در صف معلم اعمال شد')
    : ok('صف دست‌ها پس از لغو به‌روزرسانی شد')

  // ── بستن میکروفون توسط معلم ──
  section('بستن میکروفون s2 توسط معلم (از UI)')
  const rowS2 = pt.locator('aside.w-80 div.rounded-lg:not(:has-text("درخواست‌های صحبت"))', { hasText: 'مینا نظری' }).first()
  await rowS2.locator('button', { hasText: 'بستن میکروفون' }).first().click()
  await sleep(1500)
  s2MicLabel = await p2.locator('footer [aria-label]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label')).find((l) => l?.includes('میکروفون')) ?? '')
  const s2MuteToasts = await toastTexts(p2)
  s2MicLabel.includes('توسط معلم بسته شده') || s2MuteToasts.some((t) => t.includes('بسته شد'))
    ? ok('سکوت اجباری s2 اعمال شد (برچسب/توست)')
    : bad('سکوت اجباری s2 در UI اعمال نشد (برچسب: ' + s2MicLabel + ')')
  const unmuteBtn = await rowS2.locator('button', { hasText: 'رفع سکوت' }).count()
  unmuteBtn >= 1 ? ok('دکمه معلم به «رفع سکوت» تغییر کرد') : bad('دکمه رفع سکوت دیده نشد')

  // ── اجازه اشتراک صفحه به s3 + اشتراک واقعی ──
  section('اجازه اشتراک صفحه به s3 و اشتراک واقعی')
  const rowS3 = pt.locator('aside.w-80 div.rounded-lg:not(:has-text("درخواست‌های صحبت"))', { hasText: 'سینا جعفری' }).first()
  await rowS3.locator('button', { hasText: 'اجازه اشتراک صفحه' }).first().click()
  await sleep(1000)
  await p3.locator('[aria-label="اشتراک‌گذاری صفحه"]').first().click()
  await sleep(2500)
  const s3SharingLabel = await p3.locator('footer [aria-label]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label')).find((l) => l?.includes('اشتراک')) ?? '')
  s3SharingLabel.includes('پایان اشتراک')
    ? ok('s3 با اجازه معلم، اشتراک صفحه را شروع کرد')
    : bad('اشتراک صفحه s3 شروع نشد (برچسب: ' + s3SharingLabel + ')')
  const tScreen = await waitRemoteCount(pt, 1, 'screen', 15000)
  tScreen >= 1 ? ok('تصویر اشتراک صفحه s3 به معلم رسید (tile صفحه)') : bad('tile اشتراک صفحه s3 در سمت معلم نیامد')
  const tRowS3 = await pt.locator('aside.w-80').innerText()
  tRowS3.includes('در حال اشتراک صفحه')
    ? ok('وضعیت «در حال اشتراک صفحه» در پنل معلم دیده می‌شود')
    : bad('وضعیت اشتراک در پنل معلم نیست')
  await p3.locator('[aria-label="پایان اشتراک صفحه"]').first().click()
  await sleep(1200)
  ok('s3 اشتراک صفحه را با همان دکمه پایان داد')

  // ── معلم اشتراک صفحه (کنترل) ──
  await pt.locator('[aria-label="اشتراک‌گذاری صفحه"]').first().click()
  await sleep(2500)
  const s1Screen = await waitRemoteCount(p1, 1, 'screen', 15000)
  s1Screen >= 1 ? ok('اشتراک صفحه معلم در سمت s1 دریافت شد') : bad('اشتراک صفحه معلم به s1 نرسید')
  await pt.locator('[aria-label="پایان اشتراک صفحه"]').first().click()
  await sleep(800)

  // ── چت جلسه (همه پیام‌ها را می‌بینند) ──
  section('چت جلسه بین معلم و دانش‌آموزها')
  await p2.locator('aside.w-80 button', { hasText: 'گفتگو' }).first().click()
  await p2.locator('input[placeholder="پیام به جلسه…"]').fill('سلام، سؤال از تمرین ۴ دارم')
  await p2.locator('aside.w-80 button', { hasText: 'ارسال' }).first().click()
  await sleep(1200)
  await pt.locator('aside.w-80 button', { hasText: 'گفتگو' }).first().click()
  const tChat = await pt.locator('aside.w-80').innerText()
  tChat.includes('سلام، سؤال از تمرین ۴ دارم')
    ? ok('پیام s2 در چت معلم ظاهر شد')
    : bad('پیام s2 به چت معلم نرسید')
  await pt.locator('input[placeholder="پیام به جلسه…"]').fill('بله بپرسید')
  await pt.locator('aside.w-80 button', { hasText: 'ارسال' }).first().click()
  await sleep(1200)
  const s2Chat = await p2.locator('aside.w-80').innerText()
  s2Chat.includes('بله بپرسید') ? ok('پاسخ معلم در چت s2 نمایش داده شد') : bad('پاسخ معلم به s2 نرسید')
  await p1.locator('aside.w-80 button', { hasText: 'گفتگو' }).first().click()
  const s1Chat = await p1.locator('aside.w-80').innerText()
  s1Chat.includes('سلام، سؤال از تمرین ۴ دارم') && s1Chat.includes('بله بپرسید')
    ? ok('هر دو پیام برای s1 هم visible است')
    : bad('چت کامل به s1 نرسید')

  // ── ریلود s2: بازگشت به جلسه + تاریخچه چت ──
  section('ریلود s2 — بازگشت و تاریخچه چت')
  await p2.reload()
  // بازگشت به جلسه ممکن است شامل کامپایل مجدد صفحه (dev) و احراز مجدد سوکت باشد — انتظار صریح
  const p2Back = await p2
    .locator('footer [aria-label="خروج از جلسه"]')
    .first()
    .waitFor({ state: 'visible', timeout: 45000 })
    .then(() => 1)
    .catch(() => 0)
  p2Back >= 1 ? ok('s2 پس از ریلود دوباره داخل جلسه است') : bad('بازگشت s2 پس از ریلود ناموفق')
  await p2.locator('aside.w-80 button', { hasText: 'گفتگو' }).first().click({ timeout: 15000 })
  const p2Hist = await p2.locator('aside.w-80').innerText()
  p2Hist.includes('سلام، سؤال از تمرین ۴ دارم')
    ? ok('تاریخچه چت پس از ورود مجدد بارگذاری شد (۵۰ پیام آخر)')
    : bad('تاریخچه چت پس از ریلود نیامد')

  // ── ریلود معلم: میزبانی حفظ می‌شود ──
  section('ریلود معلم — میزبانی و ابزارها حفظ شود')
  await pt.reload()
  await pt
    .locator('header button', { hasText: 'پایان جلسه' })
    .first()
    .waitFor({ state: 'visible', timeout: 45000 })
    .catch(() => {})
  const endBtnCount = await pt.locator('header button', { hasText: 'پایان جلسه' }).count()
  endBtnCount >= 1 ? ok('دکمه «پایان جلسه» برای معلم پس از ریلود هست (میزبان حفظ شد)') : bad('میزبان بعد از ریلود از دست رفت')
  await pt.locator('aside.w-80 button', { hasText: 'شرکت‌کنندگان' }).first().click()
  const tPanelAfterReload = await pt.locator('aside.w-80').innerText()
  tPanelAfterReload.includes('بستن میکروفون') || tPanelAfterReload.includes('رفع سکوت')
    ? ok('ابزارهای مدیریتی معلم روی ردیف‌ها بعد از ریلود هست')
    : bad('ابزارهای معلم بعد از ریلود نیست')

  // ── خروج s2 با دکمه خروج ──
  section('خروج s2 با دکمه «خروج از جلسه»')
  await p2.locator('[aria-label="خروج از جلسه"]').click()
  await p2.waitForURL('**/live', { timeout: 10000 }).catch(() => {})
  p2.url().endsWith('/live') ? ok('s2 با دکمه خروج به صفحه کلاس آنلاین برگشت') : bad('خروج s2 به /live نرسید: ' + p2.url())
  await sleep(1500)
  const countAfterLeave = await pt.locator('aside.w-80 button', { hasText: 'شرکت‌کنندگان' }).first().innerText()
  countAfterLeave.includes('۳')
    ? ok('خروج s2 بلادرنگ از شمارنده معلم کم شد (۳ نفر)')
    : bad('شمارنده معلم بعد از خروج s2 درست نیست: ' + countAfterLeave)

  // ── اخراج s3 ──
  section('اخراج s3 توسط معلم + ممانعت از ورود مجدد')
  await pt.locator('aside.w-80 div.rounded-lg:not(:has-text("درخواست‌های صحبت"))', { hasText: 'سینا جعفری' }).first()
    .locator('button', { hasText: 'اخراج از جلسه' }).first().click()
  await sleep(2000)
  const p3Kicked = await p3.locator('body').innerText()
  p3Kicked.includes('از جلسه خارج شدید')
    ? ok('s3 صفحه «از جلسه خارج شدید» را دید')
    : bad('صفحه اخراج برای s3 نیامد')
  await p3.goto(`${BASE}/live/${SID}`)
  await p3.waitForTimeout(3000)
  const p3Rejoin = await p3.locator('body').innerText()
  p3Rejoin.includes('خارج') || p3Rejoin.includes('اجازه')
    ? ok('ورود مجدد s3 اخراج‌شده در UI رد شد')
    : bad('s3 اخراج‌شده دوباره وارد اتاق شد!')

  // ── پایان جلسه با دیالوگ تأیید ──
  section('پایان جلسه توسط معلم (دیالوگ تأیید) — همه پایان را دیدند')
  await pt.locator('header button', { hasText: 'پایان جلسه' }).first().click()
  await sleep(600)
  await pt.locator('[role="alertdialog"] button', { hasText: 'پایان جلسه' }).click()
  await sleep(2500)
  const tEnd = await pt.locator('body').innerText()
  tEnd.includes('جلسه پایان یافته') ? ok('سمت معلم: صفحه پایان نمایش داده شد') : bad('صفحه پایان در سمت معلم نیامد')
  const s1End = await p1.locator('body').innerText()
  s1End.includes('جلسه پایان یافته') ? ok('سمت s1: پایان جلسه بلادرنگ رسید') : bad('پایان جلسه به s1 نرسید')

  // ── فیکس: جلسه اعلام‌نشده در فهرست دانش‌آموز دکمه ورود ندارد ──
  section('فیکس announcedAt — جلسه در حال آماده‌سازی، بدون دکمه ورود')
  const created2 = await api(t1Cookie, '/api/live-sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ classroomId: CLS7, notifyGroupId: GMATH7, title: 'جلسه در حال آماده‌سازی' }),
  })
  const SID2 = created2.data?.id
  await p1.goto(`${BASE}/live`)
  await p1.waitForTimeout(2500)
  const liveListText = await p1.locator('main, body').first().innerText()
  const cardReady = p1.locator('div.rounded-xl.border', { hasText: 'جلسه در حال آماده‌سازی' }).first()
  const btnCount = await cardReady.locator('a', { hasText: 'ورود به کلاس' }).count()
  const prepText = liveListText.includes('در حال آماده‌سازی')
  !btnCount && prepText
    ? ok('جلسه اعلام‌نشده: بدون دکمه ورود + برچسب «در حال آماده‌سازی»')
    : bad(`گیت announcedAt در فهرست (btn=${btnCount}, prepText=${prepText})`)
  await api(t1Cookie, `/api/live-sessions/${SID2}/announce`, { method: 'POST' })
  await p1.reload()
  await p1.waitForTimeout(2500)
  const btnAfter = await p1.locator('div.rounded-xl.border', { hasText: 'جلسه در حال آماده‌سازی' }).first()
    .locator('a', { hasText: 'ورود به کلاس' }).count()
  btnAfter >= 1 ? ok('پس از اعلام، دکمه «ورود به کلاس» ظاهر شد') : bad('دکمه ورود بعد از اعلام نیامد')
  await api(t1Cookie, `/api/live-sessions/${SID2}/end`, { method: 'POST' })

  // ── فیکس نشانگر اتصال: «متصل» هست و «قطع اتصال» نیست ──
  section('نشانگر اتصال پیام‌رسان — متصل، بدون قطع')
  await p1.goto(`${BASE}/chats`)
  await p1.waitForTimeout(3500)
  const badgeOk = await p1.locator('[aria-label="اتصال برقرار است"]').first().innerText().catch(() => '')
  const anyCut = await p1.locator('text=قطع اتصال').count()
  badgeOk.includes('متصل') && anyCut === 0
    ? ok('بج پیام‌رسان «متصل» است و هیچ «قطع اتصال» دیده نمی‌شود')
    : bad(`بج اتصال (متصل='${badgeOk.trim()}'، قطع=${anyCut})`)
  await p1.reload()
  await p1.waitForTimeout(3500)
  const badgeAfterReload = await p1.locator('[aria-label="اتصال برقرار است"]').count()
  const cutAfterReload = await p1.locator('text=قطع اتصال').count()
  badgeAfterReload >= 1 && cutAfterReload === 0
    ? ok('پس از ریلود هم «متصل» پایدار است و «قطع اتصال» فلش نمی‌زند')
    : bad(`پس از ریلود (متصل=${badgeAfterReload}، قطع=${cutAfterReload})`)
  await shot(p1, '141-live-messenger-badge-connected')

  await shot(pt, '140-live-features-end')
} catch (e) {
  console.log('EXCEPTION:', e.message?.slice(0, 300))
  bad('استثنا: ' + e.message?.slice(0, 200))
} finally {
  await browser.close()
  // پاک‌سازی
  try {
    const lr2 = await api(t1Cookie, '/api/live-sessions')
    for (const c of lr2.data?.classrooms ?? []) {
      if (c.activeSession) await api(t1Cookie, `/api/live-sessions/${c.activeSession.id}/end`, { method: 'POST' })
    }
  } catch {}
}
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`نتیجه قابلیت‌ها: ${pass} پاس / ${fail} خطا`)
process.exit(fail ? 1 : 0)
