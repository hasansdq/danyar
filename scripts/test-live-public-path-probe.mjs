/**
 * پروب Playwright — اثبات دریافت رسانهٔ معلم از مسیر عمومی پیش‌نمایش
 *
 * مرورگر از URL عمومی پیش‌نمایش بارگذاری می‌شود؛ رسانه باید از اینترنت عمومی
 * و از رلهٔ ICE-TCP عمومی 159.223.110.159:7881 عبور کند.
 * شواهد: آمار WebRTC (bytes/frames) + کاندید-پر انتخابی + خطوط a=candidate tcp در SDP.
 *
 * خروجی: download/public-path-probe-result.json + دو اسکرین‌شات + خلاصهٔ کنسول.
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { writeFileSync } from 'node:fs'

const BASE = process.env.PREVIEW_BASE ?? 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai'
const RELAY_IP = '159.223.110.159'
const RELAY_PORT = 7881
const CLASSROOM = 'cmv1aryqw000alokrajw9ermw' // هفتم۱
const NOTIFY_GROUP = 'cmv1aryqy000elokrx43nz39n' // ریاضی هفتم۱
const TEACHER = { u: 'beheshti.t1', p: 'Pass@123', name: 'رضا موسوی' }
const STUDENT = { u: 'beheshti.s1', p: 'Pass@123', name: 'رضا احمدی' }

let PASS = 0
let FAIL = 0
const results = []
const ok = (m) => { PASS++; results.push({ pass: true, m }); console.log(`  ✔ ${m}`) }
const bad = (m) => { FAIL++; results.push({ pass: false, m }); console.log(`  ✘ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clamp = (n) => (Number.isFinite(n) ? n : 0)

async function login(page, username, password) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(900)
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

const pageErrors = []
const consoleErrors = []
async function newPage(ctx, tag) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${e.message}`))
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${tag}] ${msg.text().slice(0, 200)}`) })
  return page
}

// ردیابی همهٔ RTCPeerConnection ها در صفحه — نصب قبل از هر اسکریپت برنامه
async function trackPcs(ctx) {
  await ctx.addInitScript(() => {
    const Orig = window.RTCPeerConnection
    window.__pcs = []
    window.RTCPeerConnection = function (...args) {
      const pc = new Orig(...args)
      window.__pcs.push(pc)
      return pc
    }
    window.RTCPeerConnection.prototype = Orig.prototype
  })
}

/** آمار outbound-rtp معلم به تفکیک kind */
async function outboundStats(page) {
  return page.evaluate(async () => {
    const perKind = {}
    for (const pc of window.__pcs || []) {
      try {
        const stats = await pc.getStats()
        stats.forEach((r) => {
          if (r.type === 'outbound-rtp') {
            const kind = r.kind ?? r.mediaType ?? 'unknown'
            const e = (perKind[kind] ??= { bytesSent: 0, packetsSent: 0 })
            e.bytesSent += r.bytesSent ?? 0
            e.packetsSent += r.packetsSent ?? 0
          }
        })
      } catch {}
    }
    return perKind
  })
}

/** آمار inbound-rtp دانش‌آموز به تفکیک kind */
async function inboundStats(page) {
  return page.evaluate(async () => {
    const perKind = {}
    for (const pc of window.__pcs || []) {
      try {
        const stats = await pc.getStats()
        stats.forEach((r) => {
          if (r.type === 'inbound-rtp') {
            const kind = r.kind ?? r.mediaType ?? 'unknown'
            const e = (perKind[kind] ??= { bytesReceived: 0, framesDecoded: 0, packetsReceived: 0 })
            e.bytesReceived += r.bytesReceived ?? 0
            e.framesDecoded += r.framesDecoded ?? 0
            e.packetsReceived += r.packetsReceived ?? 0
          }
        })
      } catch {}
    }
    return perKind
  })
}

const evidence = {
  base: BASE,
  startedAt: new Date().toISOString(),
  sessionId: null,
  teacherOutbound: null,
  studentInbound: null,
  selectedPairs: null,
  teacherSdpTcpCandidates: null,
  joinEnabledSeconds: null,
  joinWithoutReload: null,
  pageErrors: [],
  consoleErrors: [],
  assertions: [],
}

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--auto-select-desktop-capture-source=Entire screen',
  ],
})

try {
  console.log(`══ پروب مسیر عمومی — ${BASE} ══`)

  // ─── دو کانتکست مجزا: معلم و دانش‌آموز ───
  const tCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
  await trackPcs(tCtx)
  const sCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1360, height: 900 } })
  await trackPcs(sCtx)

  console.log('══ ۱) معلم: ورود، ساخت جلسه، میکروفون + دوربین ══')
  const tPage = await newPage(tCtx, 'T')
  await login(tPage, TEACHER.u, TEACHER.p)

  const createOnce = () =>
    tPage.request.post(`${BASE}/api/live-sessions`, {
      data: { classroomId: CLASSROOM, notifyGroupId: NOTIFY_GROUP, title: 'پروب مسیر عمومی رسانه' },
    })
  let createRes = await createOnce()
  let created = await createRes.json().catch(() => null)
  if (created?.reused) {
    await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`)
    await sleep(1500)
    createRes = await createOnce()
    created = await createRes.json().catch(() => null)
  }
  const sessionId = created?.session?.id ?? created?.id
  if (!createRes.ok() || !sessionId || created?.reused) throw new Error(`create session failed: ${JSON.stringify(created)}`)
  evidence.sessionId = sessionId
  ok(`جلسه ساخته شد: ${sessionId}`)

  await tPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  ok('معلم داخل اتاق (از URL عمومی)')

  let tConnected = false
  for (let i = 0; i < 90 && !tConnected; i++) {
    tConnected = await tPage.evaluate(() => window.__lkRoom?.state === 'connected')
    if (!tConnected) await sleep(1000)
  }
  tConnected ? ok('اتاق معلم به SFU وصل شد') : bad('اتصال معلم برقرار نشد')

  // میکروفون
  await tPage.locator('button[title="روشن‌کردن میکروفون"]').first().click()
  let micOn = false
  for (let i = 0; i < 40 && !micOn; i++) {
    micOn = (await tPage.locator('button[title="خاموش‌کردن میکروفون"]').count()) > 0
    if (!micOn) await sleep(750)
  }
  micOn ? ok('میکروفون معلم روشن شد') : bad('میکروفون روشن نشد')

  // دوربین
  await tPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
  let camOn = false
  for (let i = 0; i < 40 && !camOn; i++) {
    camOn = (await tPage.locator('button[title="خاموش‌کردن دوربین"]').count()) > 0
    if (!camOn) await sleep(750)
  }
  camOn ? ok('دوربین معلم روشن شد') : bad('دوربین روشن نشد')

  // ─── دانش‌آموز روی صفحهٔ «کلاس آنلاین» قبل از اعلام شروع ══
  console.log('══ ۲) دانش‌آموز: صفحهٔ کلاس آنلاین (قبل از اعلام) ══')
  const sPage = await newPage(sCtx, 'S')
  await login(sPage, STUDENT.u, STUDENT.p)
  await sPage.goto(`${BASE}/live`, { waitUntil: 'domcontentloaded' })
  await sPage.waitForSelector('text=هفتم۱', { timeout: 30000 }).catch(() => {})
  // نشانهٔ بدون-رفرش: اگر صفحه reload شود این پرچم پاک می‌شود
  await sPage.evaluate(() => { window.__probeNoReload = true })
  const preparingSeen = await sPage.getByText('جلسه در حال آماده‌سازی است').count()
  const earlyJoin = await sPage.locator('a:has-text("ورود به کلاس"), button:has-text("ورود به کلاس")').count()
  console.log(`    (وضعیت اولیه دانش‌آموز: پیام آماده‌سازی=${preparingSeen}، دکمه ورود=${earlyJoin})`)

  // ─── معلم: سوییچ شروع کلاس ══
  console.log('══ ۳) معلم: اعلام شروع کلاس (سوییچ) ══')
  const switchClickedAt = Date.now()
  await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]').first().click()
  let announced = null
  for (let i = 0; i < 40; i++) {
    const d = await tPage.request.get(`${BASE}/api/live-sessions/${sessionId}`).then((r) => r.json()).catch(() => null)
    announced = d?.announcedAt ?? null
    if (announced) break
    await sleep(500)
  }
  announced ? ok('اعلام شروع کلاس ثبت شد') : bad('اعلام شروع ثبت نشد')

  // ─── انتظار برای فعال‌شدن دکمهٔ ورود بدون رفرش ══
  console.log('══ ۴) دانش‌آموز: فعال‌شدن دکمهٔ ورود بدون رفرش ══')
  let joinSel = null
  const joinDeadline = Date.now() + 60000
  while (Date.now() < joinDeadline) {
    joinSel = await sPage.evaluate(() => {
      const el = [...document.querySelectorAll('a, button')].find(
        (n) => (n.textContent ?? '').trim() === 'ورود به کلاس',
      )
      return el ? (el.getAttribute('href') ?? 'button') : null
    })
    if (joinSel) break
    await sleep(500)
  }
  const joinEnabledSeconds = joinSel ? (Date.now() - switchClickedAt) / 1000 : null
  evidence.joinEnabledSeconds = joinEnabledSeconds === null ? null : Math.round(joinEnabledSeconds * 10) / 10
  const noReloadFlag = await sPage.evaluate(() => window.__probeNoReload === true)
  evidence.joinWithoutReload = noReloadFlag
  if (joinSel) ok(`دکمهٔ ورود بدون رفرش فعال شد (${evidence.joinEnabledSeconds}s از لحظهٔ سوییچ؛ href=${joinSel})`)
  else bad('دکمهٔ ورود بدون رفرش فعال نشد (تا 60s)')
  noReloadFlag ? ok('نشانهٔ بدون-رفرش پابرجا ماند (هیچ navigation ای رخ نداد)') : bad('صفحهٔ دانش‌آموز reload/navigation شد!')

  // ─── معلم: انتظار برای outbound bytes > 0 (صدا + تصویر) ══
  console.log('══ ۵) معلم: انتشار واقعی رسانه (outbound bytes) ══')
  let tOut = null
  for (let i = 0; i < 45; i++) {
    tOut = await outboundStats(tPage)
    const audioOk = clamp(tOut.audio?.bytesSent) > 0
    const videoOk = clamp(tOut.video?.bytesSent) > 0
    if (audioOk && videoOk) break
    await sleep(2000)
  }
  evidence.teacherOutbound = tOut
  const tAudioBytes = clamp(tOut?.audio?.bytesSent)
  const tVideoBytes = clamp(tOut?.video?.bytesSent)
  tAudioBytes > 0
    ? ok(`outbound صوتی معلم: ${tAudioBytes} بایت ارسال‌شده`)
    : bad(`outbound صوتی معلم صفر است: ${JSON.stringify(tOut)}`)
  tVideoBytes > 0
    ? ok(`outbound ویدیویی معلم: ${tVideoBytes} بایت ارسال‌شده`)
    : bad(`outbound ویدیویی معلم صفر است: ${JSON.stringify(tOut)}`)

  // ─── دانش‌آموز: ورود به جلسه ══
  console.log('══ ۶) دانش‌آموز: ورود و دریافت رسانه ══')
  if (joinSel) {
    await sPage.locator('a:has-text("ورود به کلاس"), button:has-text("ورود به کلاس")').first().click()
  } else {
    await sPage.goto(`${BASE}/live/${sessionId}`, { waitUntil: 'domcontentloaded' })
  }
  await sPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  ok('دانش‌آموز داخل اتاق شد (از URL عمومی)')
  let sConnected = false
  for (let i = 0; i < 90 && !sConnected; i++) {
    sConnected = await sPage.evaluate(() => window.__lkRoom?.state === 'connected')
    if (!sConnected) await sleep(1000)
  }
  sConnected ? ok('اتاق دانش‌آموز به SFU وصل شد') : bad('اتصال دانش‌آموز برقرار نشد')

  // ─── دریافت واقعی: inbound video frames + bytes، inbound audio bytes ══
  let sIn = null
  for (let i = 0; i < 60; i++) {
    sIn = await inboundStats(sPage)
    const v = clamp(sIn.video?.bytesReceived) > 0 && clamp(sIn.video?.framesDecoded) > 0
    const a = clamp(sIn.audio?.bytesReceived) > 0
    if (v && a) break
    await sleep(2000)
  }
  evidence.studentInbound = sIn
  const sAudioBytes = clamp(sIn?.audio?.bytesReceived)
  const sVideoBytes = clamp(sIn?.video?.bytesReceived)
  const sFrames = clamp(sIn?.video?.framesDecoded)
  sAudioBytes > 0
    ? ok(`inbound صوتی دانش‌آموز: ${sAudioBytes} بایت دریافت‌شده`)
    : bad(`inbound صوتی دانش‌آموز صفر است: ${JSON.stringify(sIn)}`)
  sVideoBytes > 0 && sFrames > 0
    ? ok(`inbound ویدیویی دانش‌آموز: ${sVideoBytes} بایت، ${sFrames} فریم decodeشده`)
    : bad(`inbound ویدیویی دانش‌آموز ناقص است: bytes=${sVideoBytes} frames=${sFrames}`)

  // ─── کاندید-پر انتخابی (سمت دانش‌آموز) ══
  console.log('══ ۷) اثبات مسیر: کاندید-پر انتخابی ══')
  const pairInfo = await sPage.evaluate(async () => {
    const out = []
    for (const pc of window.__pcs || []) {
      try {
        const stats = await pc.getStats()
        const candidates = {}
        stats.forEach((r) => {
          if (r.type === 'candidate' || r.type === 'local-candidate' || r.type === 'remote-candidate')
            candidates[r.id] = r
        })
        stats.forEach((r) => {
          if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded'))) {
            const lc = candidates[r.localCandidateId]
            const rc = candidates[r.remoteCandidateId]
            out.push({
              state: r.state,
              local: lc
                ? { addr: lc.address || lc.ip, port: lc.port, proto: lc.protocol || lc.mozLocalType }
                : null,
              remote: rc
                ? { addr: rc.address || rc.ip, port: rc.port, proto: rc.protocol, typ: rc.candidateType }
                : null,
              bytesReceived: r.bytesReceived,
              bytesSent: r.bytesSent,
            })
          }
        })
      } catch {}
    }
    return out
  })
  evidence.selectedPairs = pairInfo
  console.log('    کاندید-پرهای انتخابی:', JSON.stringify(pairInfo))
  const relayPair = pairInfo.find(
    (p) => p.remote && String(p.remote.addr) === RELAY_IP && Number(p.remote.port) === RELAY_PORT,
  )
  if (relayPair) {
    const proto = relayPair.remote.proto ?? '?'
    ok(
      `کاندید-پر انتخابی = رلهٔ عمومی ${RELAY_IP}:${RELAY_PORT} (پروتکل ${proto}) — bytesRx=${clamp(relayPair.bytesReceived)} bytesTx=${clamp(relayPair.bytesSent)}`,
    )
  } else {
    bad(`کاندید-پر انتخابی رلهٔ عمومی ${RELAY_IP}:${RELAY_PORT} نیست — مقادیر واقعی بالا`)
  }

  // ─── SDP معلم: خطوط a=candidate tcp (اثبات ICE-TCP سمت سرور) ══
  const sdpTcp = await tPage.evaluate(() =>
    (window.__pcs || []).map((p) =>
      p.remoteDescription
        ? p.remoteDescription.sdp.split('\n').filter((l) => l.includes('a=candidate') && l.includes('tcp'))
        : [],
    ),
  )
  evidence.teacherSdpTcpCandidates = sdpTcp
  const flatSdpTcp = sdpTcp.flat()
  flatSdpTcp.length > 0
    ? ok(`SDP معلم شامل ${flatSdpTcp.length} خط a=candidate tcp است (سرور ICE-TCP تبلیغ می‌کند)`)
    : bad('SDP معلم هیچ خط a=candidate tcp ندارد')
  if (flatSdpTcp.length) console.log('    نمونه:', flatSdpTcp[0].trim().slice(0, 140))

  // ─── اسکرین‌شات‌ها (لحظهٔ جریان رسانه) ══
  await tPage.screenshot({ path: 'download/public-path-probe-teacher.png' })
  await sPage.screenshot({ path: 'download/public-path-probe-student.png' })
  console.log('    اسکرین‌شات‌ها ذخیره شدند')

  // ─── پایان جلسه ══
  console.log('══ ۸) پایان جلسه ══')
  await tPage.getByRole('button', { name: 'پایان جلسه' }).first().click()
  await tPage.getByRole('button', { name: 'پایان جلسه' }).last().click()
  let endedSeen = false
  try {
    await sPage.getByText('جلسه پایان یافته').waitFor({ timeout: 20000 })
    endedSeen = true
  } catch {}
  endedSeen ? ok('دانش‌آموز «جلسه پایان یافته» را دید') : bad('پایان جلسه به دانش‌آموز نرسید')

  // ─── خطاها ══
  const realErrors = pageErrors.filter(
    (e) => !e.includes('ResizeObserver') && !e.includes('favicon') && !e.includes('React DevTools'),
  )
  evidence.pageErrors = pageErrors
  evidence.consoleErrors = consoleErrors.slice(0, 20)
  realErrors.length === 0
    ? ok(`بدون pageerror ناگهانی (${pageErrors.length} خاموش‌شده)`)
    : bad(`خطاهای صفحه: ${realErrors.slice(0, 3).join(' | ')}`)
  if (consoleErrors.length) console.log('    (خطاهای کنسول — تحمل‌شده):', consoleErrors.slice(0, 5).join(' | '))
} catch (e) {
  bad(`شکست پروب: ${e.message}`)
  console.log(e.stack?.split('\n').slice(0, 6).join('\n'))
} finally {
  await browser.close().catch(() => {})
}

// ─── جمع‌بندی ══
evidence.finishedAt = new Date().toISOString()
evidence.assertions = results
evidence.allPassed = FAIL === 0

console.log('\n══ جدول جمع‌بندی ══')
console.log('┌──────────────────────────────────────────────┬────────┐')
console.log('│ بررسی                                        │ نتیجه  │')
console.log('├──────────────────────────────────────────────┼────────┤')
const labelMap = [
  ['outbound صوتی معلم > 0 بایت', evidence.teacherOutbound?.audio?.bytesSent > 0],
  ['outbound ویدیویی معلم > 0 بایت', evidence.teacherOutbound?.video?.bytesSent > 0],
  ['inbound صوتی دانش‌آموز > 0 بایت', (evidence.studentInbound?.audio?.bytesReceived ?? 0) > 0],
  [
    'inbound ویدیویی > 0 بایت و > 0 فریم',
    (evidence.studentInbound?.video?.bytesReceived ?? 0) > 0 && (evidence.studentInbound?.video?.framesDecoded ?? 0) > 0,
  ],
  [
    `کاندید-پر انتخابی = ${RELAY_IP}:${RELAY_PORT} (tcp)`,
    (evidence.selectedPairs || []).some(
      (p) => p.remote && String(p.remote.addr) === RELAY_IP && Number(p.remote.port) === RELAY_PORT,
    ),
  ],
  ['فعال‌شدن دکمهٔ ورود بدون رفرش', !!evidence.joinEnabledSeconds && evidence.joinWithoutReload === true],
  ['بدون pageerror', (evidence.pageErrors || []).filter((e) => !e.includes('ResizeObserver') && !e.includes('favicon') && !e.includes('React DevTools')).length === 0],
]
for (const [label, pass] of labelMap) {
  console.log(`│ ${(label + ' ').padEnd(46, ' ').slice(0, 46)}│ ${pass ? '  ✔    ' : '  ✘    '}│`)
}
console.log('└──────────────────────────────────────────────┴────────┘')
console.log(`مدت فعال‌شدن دکمهٔ ورود: ${evidence.joinEnabledSeconds ?? '—'} ثانیه (بدون رفرش: ${evidence.joinWithoutReload})`)

try {
  writeFileSync('download/public-path-probe-result.json', JSON.stringify(evidence, null, 2))
  console.log('شواهد JSON: download/public-path-probe-result.json')
} catch (e) {
  console.log('نوشتن JSON ناموفق:', e.message)
}

console.log(`\nنتیجهٔ پروب: ${PASS} پاس / ${FAIL} شکست`)
process.exitCode = FAIL > 0 ? 1 : 0
