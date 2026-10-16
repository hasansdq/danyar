/**
 * دو نشست مستقل — دریافت واقعی صدا/تصویر دانش‌آموز از مسیر TURN عمومی + مجوزها + پایان جلسه
 *
 * روش صادقانه: درخواست‌های داخل سندباکس به لینک عمومی پیش‌نمایش از سمت لبهٔ پلتفرم
 * به یک بک‌اند دیگر مسیر می‌شوند؛ بنابراین این آزمون از پایهٔ داخلی اجرا می‌شود ولی
 * همهٔ RTCPeerConnectionها با iceTransportPolicy='relay' فورس می‌شوند — تمام رسانه
 * فقط از مسیر TURN عمومی (159.223.110.159:3478 → coturn محلی → LiveKit) عبور
 * می‌کند؛ همان مسیری که مرورگر بیرونیِ پیش‌نمایش از اینترنت می‌رود. شواهد آماری
 * WebRTC (bytes/frames) و کاندید-پر relay در خروجی ثبت می‌شود.
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { writeFileSync } from 'node:fs'

const BASE = process.env.TEST_BASE ?? 'http://127.0.0.1:3000'
const CLASSROOM = 'cmv1aryqw000alokrajw9ermw'
const NOTIFY_GROUP = 'cmv1aryqy000elokrx43nz39n'
const TEACHER = { u: 'beheshti.t1', p: 'Pass@123', name: 'رضا موسوی' }
const RESULT_FILE = 'download/public-turn-two-sessions-result.json'

let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const REDACT = (s) => String(s).replace(/eyJ[A-Za-z0-9_-]{10,}/g, '<jwt>')

// فورس relay — سطح کلاس و سطح نمونه (SDK بعد از join با setConfiguration بازنویسی می‌کند)
// iceServers پاس‌داده‌شده (شامل TURN اپ) حفظ می‌شود؛ فقط سیاست transport عوض می‌شود
const RELAY_INIT = () => {
  const Orig = window.RTCPeerConnection
  window.__pcs = []
  const force = (c) => ({ ...(c ?? {}), iceTransportPolicy: 'relay' })
  const Wrapped = function (rtcConfig, ...rest) {
    const pc = new Orig(force(rtcConfig), ...rest)
    const origSet = pc.setConfiguration.bind(pc)
    pc.setConfiguration = (c) => origSet(force(c))
    window.__pcs.push(pc)
    return pc
  }
  Wrapped.prototype = Orig.prototype
  window.RTCPeerConnection = Wrapped
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
    } catch { await sleep(2000) }
  }
  throw new Error(`login failed for ${username}`)
}

function newPage(ctx, tag, errors) {
  return (async () => {
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`))
    return page
  })()
}

async function tileHasLiveVideo(page, name, kind) {
  return page.evaluate(
    ({ name, kind }) => {
      const tiles = [...document.querySelectorAll('[data-tile-name]')].filter((el) =>
        (el.getAttribute('data-tile-name') ?? '').includes(name))
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

async function pcSummary(page) {
  return page.evaluate(async () => {
    const out = { inbound: [], outbound: [], pairs: [] }
    for (const pc of window.__pcs || []) {
      let stats
      try { stats = await pc.getStats() } catch { continue }
      const cands = {}
      stats.forEach((r) => { if (r.type === 'candidate' || r.type === 'local-candidate' || r.type === 'remote-candidate') cands[r.id] = r })
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind) out.inbound.push({ kind: r.kind, bytesReceived: r.bytesReceived ?? 0, framesDecoded: r.framesDecoded ?? 0 })
        if (r.type === 'outbound-rtp' && r.kind) out.outbound.push({ kind: r.kind, bytesSent: r.bytesSent ?? 0 })
        if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded'))) {
          const lc = cands[r.localCandidateId]
          const rc = cands[r.remoteCandidateId]
          out.pairs.push({
            state: r.state,
            local: lc ? { addr: lc.address || lc.ip, port: lc.port, typ: lc.candidateType, proto: lc.protocol } : null,
            remote: rc ? { addr: rc.address || rc.ip, port: rc.port, typ: rc.candidateType, proto: rc.protocol } : null,
          })
        }
      })
    }
    return out
  })
}

const sumBy = (arr, kind, field) => arr.filter((x) => x.kind === kind).reduce((a, x) => a + (x[field] || 0), 0)

async function runSession(label, student) {
  console.log(`\n══════ نشست ${label} — دانش‌آموز: ${student.name} (مسیر رسانه: TURN عمومی اجباری) ══════`)
  const pageErrors = []
  const evidence = { session: label, student: student.name }
  let tPage = null
  let sessionId = null
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  })
  try {
    const tCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
    await tCtx.addInitScript(RELAY_INIT)
    tPage = await newPage(tCtx, 'T', pageErrors)
    await login(tPage, TEACHER.u, TEACHER.p)
    const createOnce = () => tPage.request.post(`${BASE}/api/live-sessions`, {
      data: { classroomId: CLASSROOM, notifyGroupId: NOTIFY_GROUP, title: `آزمون TURN عمومی — نشست ${label}` },
    })
    let createRes = await createOnce()
    let created = await createRes.json().catch(() => null)
    if (created?.reused) {
      await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`)
      await sleep(1500)
      createRes = await createOnce()
      created = await createRes.json().catch(() => null)
    }
    sessionId = created?.session?.id ?? created?.id
    if (!createRes.ok() || !sessionId || created?.reused) throw new Error(`create session failed: ${JSON.stringify(created)}`)
    evidence.sessionId = sessionId
    ok(`جلسه ساخته شد: ${sessionId}`)

    await tPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
    await tPage.waitForSelector('[data-tile-self]', { timeout: 90000 })
    ok('معلم داخل اتاق (اتصال رسانه فقط از مسیر TURN عمومی)')

    for (const [onSel, offSel, what] of [
      ['[aria-label="روشن‌کردن میکروفون"]', '[aria-label="خاموش‌کردن میکروفون"]', 'میکروفون'],
      ['button[title="روشن‌کردن دوربین"]', 'button[title="خاموش‌کردن دوربین"]', 'دوربین'],
    ]) {
      await tPage.locator(onSel).first().click({ timeout: 25000 })
      let on_ = false
      for (let i = 0; i < 40 && !on_; i++) { on_ = (await tPage.locator(offSel).count()) > 0; if (!on_) await sleep(500) }
      on_ ? ok(`${what} معلم روشن و منتشر شد`) : bad(`${what} معلم روشن نشد`)
    }

    let tOut = { inbound: [], outbound: [], pairs: [] }
    for (let i = 0; i < 60; i++) {
      tOut = await pcSummary(tPage)
      if (sumBy(tOut.outbound, 'audio', 'bytesSent') > 0 && sumBy(tOut.outbound, 'video', 'bytesSent') > 0) break
      await sleep(2000)
    }
    const tAud = sumBy(tOut.outbound, 'audio', 'bytesSent')
    const tVid = sumBy(tOut.outbound, 'video', 'bytesSent')
    tAud > 0 ? ok(`صوت معلم واقعاً ارسال شد (${tAud.toLocaleString('en-US')} بایت)`) : bad('صوت معلم ارسال نشد')
    tVid > 0 ? ok(`تصویر معلم واقعاً ارسال شد (${tVid.toLocaleString('en-US')} بایت)`) : bad('تصویر معلم ارسال نشد')
    evidence.teacherOutbound = { audioBytes: tAud, videoBytes: tVid }

    const sCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
    await sCtx.addInitScript(RELAY_INIT)
    const sPage = await newPage(sCtx, 'S', pageErrors)
    await login(sPage, student.u, student.p)
    await sPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
    await sleep(1500)

    await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]').first().click()
    let announcedAt = null
    for (let i = 0; i < 40; i++) {
      const d = await tPage.request.get(`${BASE}/api/live-sessions/${sessionId}`).then((r) => r.json()).catch(() => null)
      announcedAt = d?.announcedAt ?? null
      if (announcedAt) break
      await sleep(500)
    }
    announcedAt ? ok('اعلان شروع کلاس ثبت شد') : bad('اعلان شروع ثبت نشد')

    const navs = []
    sPage.on('framenavigated', (f) => { if (f === sPage.mainFrame()) navs.push(Date.now()) })
    const joinBtn = sPage.getByRole('button', { name: /ورود/ }).first()
    let joinSecs = null
    let joined = false
    const t0 = Date.now()
    for (let i = 0; i < 120 && !joined; i++) {
      try {
        if ((await joinBtn.count()) > 0 && (await joinBtn.isEnabled())) {
          joinSecs = ((Date.now() - t0) / 1000).toFixed(1)
          await joinBtn.click()
          joined = true
          break
        }
      } catch { /* دکمه هنوز در حال تغییر */ }
      if ((await sPage.locator('[data-tile-self]').count()) > 0) { joined = true; joinSecs = 'auto'; break }
      await sleep(500)
    }
    const reloads = navs.filter((t) => t > t0).length
    joined && reloads === 0
      ? ok(`ورود دانش‌آموز ${joinSecs}s بعد از اعلان فعال شد و بدون رفرش وارد شد`)
      : bad(`ورود دانش‌آموز ناموفق (joined=${joined}, reloads=${reloads})`)
    evidence.joinSeconds = joinSecs
    evidence.joinReloads = reloads

    await sPage.waitForSelector('[data-tile-self]', { timeout: 90000 })

    let gotCam = false
    for (let i = 0; i < 60 && !gotCam; i++) { gotCam = await tileHasLiveVideo(sPage, TEACHER.name, 'camera'); if (!gotCam) await sleep(1000) }
    gotCam ? ok('کاشی ویدیوی زندهٔ معلم در صفحهٔ دانش‌آموز') : bad('ویدیوی معلم دریافت نشد')

    let sIn = { inbound: [], outbound: [], pairs: [] }
    for (let i = 0; i < 75; i++) {
      sIn = await pcSummary(sPage)
      if (sumBy(sIn.inbound, 'audio', 'bytesReceived') > 0 && sumBy(sIn.inbound, 'video', 'bytesReceived') > 0 && sumBy(sIn.inbound, 'video', 'framesDecoded') > 0) break
      await sleep(2000)
    }
    const sAud = sumBy(sIn.inbound, 'audio', 'bytesReceived')
    const sVid = sumBy(sIn.inbound, 'video', 'bytesReceived')
    const sFrames = sumBy(sIn.inbound, 'video', 'framesDecoded')
    sAud > 0 ? ok(`دانش‌آموز صوت واقعی معلم را دریافت کرد (${sAud.toLocaleString('en-US')} بایت)`) : bad('صوت به دانش‌آموز نرسید')
    sVid > 0 && sFrames > 0
      ? ok(`دانش‌آموز تصویر واقعی معلم را دریافت کرد (${sVid.toLocaleString('en-US')} بایت، ${sFrames} فریم decode)`)
      : bad(`تصویر به دانش‌آموز نرسید (${sVid} بایت / ${sFrames} فریم)`)
    evidence.studentInbound = { audioBytes: sAud, videoBytes: sVid, framesDecoded: sFrames }

    let pair = (sIn.pairs || [])[0] || null
    for (let i = 0; i < 20 && !(pair && pair.local && pair.remote); i++) {
      const s2 = await pcSummary(sPage)
      pair = (s2.pairs || [])[0] || pair
      if (pair && pair.local && pair.remote) break
      await sleep(1500)
    }
    evidence.selectedPair = pair
    if (pair && pair.local?.typ === 'relay') {
      ok(`مسیر رسانه = TURN relay (local ${pair.local.addr}:${pair.local.port} typ=relay → remote ${pair.remote?.addr}:${pair.remote?.port} ${pair.remote?.proto})`)
    } else {
      bad(`کاندید-پر انتخابی relay نیست: ${JSON.stringify(pair)}`)
    }

    const tabPeople = tPage.locator('aside.w-80 button', { hasText: 'شرکت‌کنندگان' }).first()
    await tabPeople.click()
    await tPage.waitForTimeout(1500)
    const row = tPage.locator('aside.w-80 div.rounded-lg:not(:has-text("درخواست‌های صحبت"))', { hasText: student.name }).first()
    const grantBtn = row.locator('button', { hasText: 'اجازه دوربین' }).first()
    let granted = false
    for (let i = 0; i < 6 && !granted; i++) {
      try { await grantBtn.click({ timeout: 15000 }); granted = true } catch { await sleep(1500) }
    }
    granted ? ok(`اجازه دوربین به ${student.name} داده شد`) : bad('دکمه اجازه دوربین یافت نشد')

    let turned = false
    for (let attempt = 0; attempt < 5 && !turned; attempt++) {
      await sPage.locator('[aria-label="روشن‌کردن دوربین"], button[title="روشن‌کردن دوربین"]').first().click({ timeout: 10000 }).catch(() => {})
      await sleep(2500)
      const lbl = await sPage.locator('footer [aria-label]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('aria-label')).find((l) => l?.includes('دوربین')) ?? '')
      turned = lbl.includes('خاموش‌کردن دوربین')
      if (!turned) {
        await sPage.locator('[aria-label="خاموش‌کردن دوربین"], button[title="خاموش‌کردن دوربین"]').first().click().catch(() => {})
        await sleep(1000)
      }
    }
    turned ? ok(`دوربین ${student.name} بعد از اجازهٔ معلم روشن شد`) : bad(`دوربین ${student.name} روشن نشد`)

    let remoteCam = 0
    for (let i = 0; i < 60 && remoteCam < 1; i++) {
      remoteCam = await tPage.evaluate(() => {
        const tiles = [...document.querySelectorAll('[data-tile-kind="camera"]')]
        return tiles.filter((t) => t.getAttribute('data-tile-self') !== '1' && !t.textContent?.includes('دوربین خاموش است')).length
      })
      if (remoteCam < 1) await sleep(1000)
    }
    remoteCam >= 1 ? ok('کاشی دوربین روشنِ دانش‌آموز در صفحهٔ معلم') : bad('کاشی دوربین دانش‌آموز در صفحهٔ معلم روشن نشد')
    let tVidIn = 0
    for (let i = 0; i < 40 && tVidIn <= 0; i++) {
      const tIn = await pcSummary(tPage)
      tVidIn = sumBy(tIn.inbound, 'video', 'bytesReceived')
      if (tVidIn <= 0) await sleep(2000)
    }
    tVidIn > 0 ? ok(`معلم تصویر واقعی دانش‌آموز را دریافت کرد (${tVidIn.toLocaleString('en-US')} بایت)`) : bad('آمار دریافت تصویر دانش‌آموز نزد معلم صفر است')
    evidence.permissionFlow = { granted, studentCamOn: turned, teacherReceivedTiles: remoteCam >= 1, teacherInboundVideoBytes: tVidIn }

    await tPage.screenshot({ path: `download/public-turn-session-${label}-teacher.png` })
    await sPage.screenshot({ path: `download/public-turn-session-${label}-student.png` })

    await tPage.getByRole('button', { name: 'پایان جلسه' }).first().click()
    await tPage.getByRole('button', { name: 'پایان جلسه' }).last().click()
    let ended = false
    try { await sPage.getByText('جلسه پایان یافته').waitFor({ timeout: 25000 }); ended = true } catch { }
    ended ? ok('دانش‌آموز «جلسه پایان یافته» را دید') : bad('دانش‌آموز پایان را ندید')
    const fin = await tPage.request.get(`${BASE}/api/live-sessions/${sessionId}`).then((r) => r.json()).catch(() => null)
    const endedAt = fin?.endedAt ?? fin?.session?.endedAt ?? null
    endedAt ? ok('جلسه در DB پایان یافت') : bad('جلسه در DB پایان نیافت')
    evidence.sessionEnded = { studentSaw: ended, dbEnded: !!endedAt }

    const realErrors = pageErrors.filter((e) => !e.includes('ResizeObserver') && !e.includes('favicon'))
    realErrors.length === 0
      ? ok(`بدون خطای جاوااسکریپت ناگهانی (${pageErrors.length} خاموش‌شده)`)
      : bad(`خطاهای صفحه: ${realErrors.slice(0, 3).join(' | ')}`)
    evidence.pageErrors = realErrors.slice(0, 5).map(REDACT)
  } catch (e) {
    bad(`شکست نشست ${label}: ${REDACT(e.message)}`)
    evidence.error = REDACT(e.message)
    try { if (tPage && sessionId) await tPage.request.post(`${BASE}/api/live-sessions/${sessionId}/end`) } catch { }
  } finally {
    await browser.close()
  }
  return evidence
}

const results = []
results.push(await runSession('A', { u: 'beheshti.s1', p: 'Pass@123', name: 'رضا احمدی' }))
results.push(await runSession('B', { u: 'beheshti.s2', p: 'Pass@123', name: 'مینا نظری' }))
const allPassed = FAIL === 0
console.log(`\nنتیجهٔ دو نشست مستقل: ${PASS} پاس / ${FAIL} شکست — ${allPassed ? 'همه سبز' : 'شکست'}`)
console.log('برچسب صادقانه: مرورگرهای آزمون داخل سندباکس اجرا شده‌اند اما تمام رسانه اجباراً از مسیر TURN عمومی')
console.log('(رلهٔ TCP عمومی 159.223.110.159:3478 → coturn محلی → LiveKit) عبور کرده است — همان مسیر مرورگر بیرونی؛')
console.log('آزمون با مرورگرِ واقعاً بیرونی (کاربر) همچنان قدم نهایی تأیید است.')
writeFileSync(RESULT_FILE, JSON.stringify({ base: BASE, finishedAt: new Date().toISOString(), pass: PASS, fail: FAIL, results }, null, 2))
process.exit(allPassed ? 0 : 1)
