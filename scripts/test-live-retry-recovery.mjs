/**
 * تلاش مجدد اتصال رسانه «موفق» — بدون رفرش صفحه:
 *  ۱) LiveKit را می‌کشیم → اتصال معلم شکست می‌خورد (بنر + دکمه تلاش مجدد)
 *  ۲) LiveKit را دوباره بالا می‌آوریم
 *  ۳) کلیک «تلاش مجدد اتصال رسانه» → اتصال برقرار (بدون رفرش)
 *  ۴) انتشار دوربین موفق → سوییچ فعال → اعلام شروع
 *  ۵) دانش‌آموز بدون رفرش دکمه ورود می‌گیرد و ویدیوی معلم را دریافت می‌کند
 *  + سناریوی قطع اینترنت: LiveKit وسط جلسه کشته و برمی‌گردد → بازیابی خودکار
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { execSync, spawn } from 'node:child_process'
const BASE = 'http://localhost:81'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✔', m) }
const bad = (m) => { fail++; console.log('  ✘', m) }
const killLivekit = () => { try { execSync("pkill -f 'livekit-server --config'") } catch {} }
// مخفی‌کردن باینری → خودترمیم اپ نمی‌تواند LiveKit را بالا بیاورد (شبیه از‌کارافتادن واقعی سرویس)
const hideBinary = () => { try { execSync('mv /home/z/my-project/.tools/livekit-server /tmp/livekit-server-hidden') } catch {} }
const restoreBinary = () => { try { execSync('mv /tmp/livekit-server-hidden /home/z/my-project/.tools/livekit-server && chmod +x /home/z/my-project/.tools/livekit-server') } catch {} }
const startLivekit = () => {
  try {
    execSync('cd /home/z/my-project && set -a && source .env && set +a && (LIVEKIT_KEYS="$LIVEKIT_API_KEY: $LIVEKIT_API_SECRET" setsid nohup ./.tools/livekit-server --config .tools/livekit-dev.yaml >> livekit.log 2>&1 < /dev/null &)', { shell: '/bin/bash' })
  } catch (e) { console.log('start err', e.message) }
}
const waitLivekit = async () => {
  for (let i = 0; i < 30; i++) { const r = await fetch('http://127.0.0.1:7880/').then(x => x.ok).catch(() => false); if (r) return true; await sleep(500) }
  return false
}
async function login(page, u, p) {
  for (let a = 0; a < 3; a++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(900)
      await page.fill('#username', u); await page.fill('#password', p)
      const robot = page.locator('#notRobot, [role="checkbox"]').first()
      for (let i = 0; i < 12; i++) { try { if ((await robot.getAttribute('aria-checked')) !== 'true') await robot.click(); else break } catch { await robot.click().catch(() => {}) }; await sleep(400) }
      await page.click('button[type="submit"]')
      for (let i = 0; i < 40; i++) { if (!page.url().includes('/login')) return; await sleep(500) }
    } catch { await sleep(2000) }
  }
  throw new Error('login failed ' + u)
}
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
try {
  // ── فاز ۱: LiveKit خاموش + باینری مخفی (بدون خودترمیم) → شکست تمیز ──
  killLivekit(); hideBinary(); await sleep(1500)
  const tCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const tPage = await tCtx.newPage()
  await login(tPage, 'beheshti.t1', 'Pass@123')
  let created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'بازیابی با تلاش مجدد' } })).json().catch(() => null)
  if (created?.reused) { await tPage.request.post(`${BASE}/api/live-sessions/${created.id}/end`); await sleep(1200); created = await (await tPage.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'بازیابی با تلاش مجدد' } })).json().catch(() => null) }
  const sid = created?.session?.id ?? created?.id
  await tPage.goto(`${BASE}/live/${sid}`, { waitUntil: 'domcontentloaded' })
  await tPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  await sleep(2000)
  const t1 = await tPage.evaluate(() => document.body.innerText)
  ;(t1.includes('اتصال سیگنال رسانه برقرار نشد') || t1.includes('اتصال رسانه برقرار نشد') || t1.includes('سرویس رسانه')) ? ok('با LiveKit خاموش: بنر خطای رسانهٔ مشخص ظاهر شد') : bad('بنر خطای مشخص دیده نشد: ' + t1.slice(0, 200))
  const hasRetry = await tPage.locator('button[aria-label="تلاش مجدد اتصال رسانه"]').count()
  hasRetry > 0 ? ok('دکمه تلاش مجدد موجود') : bad('دکمه تلاش مجدد نیست')

  // ── فاز ۲: LiveKit برمی‌گردد (باینری هم) → retry → اتصال ──
  restoreBinary()
  startLivekit()
  ;(await waitLivekit()) ? ok('LiveKit دوباره بالا آمد') : bad('LiveKit برنگشت')
  await tPage.locator('button[aria-label="تلاش مجدد اتصال رسانه"]').first().click()
  let connected = false
  for (let i = 0; i < 30 && !connected; i++) {
    connected = await tPage.evaluate(() => window.__lkRoom?.state === 'connected')
    if (!connected) await sleep(1000)
  }
  connected ? ok('retry بدون رفرش: اتصال رسانه برقرار شد') : bad('retry موفق نشد')

  // ── فاز ۳: انتشار → اعلام → دانش‌آموز ──
  await tPage.locator('button[title="روشن‌کردن دوربین"]').first().click()
  let camOn = false
  for (let i = 0; i < 20 && !camOn; i++) { camOn = (await tPage.locator('button[title="خاموش‌کردن دوربین"]').count()) > 0; if (!camOn) await sleep(500) }
  camOn ? ok('دوربین معلم منتشر شد') : bad('انتشار دوربین ناموفق')
  await tPage.locator('button[role="switch"][aria-label="سوییچ شروع کلاس"]').first().click()
  let announced = null
  for (let i = 0; i < 40; i++) { const d = await tPage.request.get(`${BASE}/api/live-sessions/${sid}`).then((r) => r.json()).catch(() => null); announced = d?.announcedAt ?? null; if (announced) break; await sleep(500) }
  announced ? ok('اعلام شروع ثبت شد') : bad('اعلام ثبت نشد')

  const sCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const sPage = await sCtx.newPage()
  await login(sPage, 'beheshti.s1', 'Pass@123')
  await sPage.goto(`${BASE}/live`, { waitUntil: 'domcontentloaded' })
  await sleep(3500)
  let joinVisible = await sPage.getByText('ورود به کلاس').count()
  joinVisible > 0 ? ok('دانش‌آموز بدون رفرش دکمه ورود را دید') : bad('دکمه ورود ظاهر نشد')
  await sPage.getByText('ورود به کلاس').first().click()
  await sPage.waitForURL(/\/live\//, { timeout: 20000 })
  await sPage.waitForSelector('[data-tile-self]', { timeout: 60000 })
  let got = false
  for (let i = 0; i < 30 && !got; i++) {
    got = await sPage.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-tile-name]')]
      return tiles.some((el) => {
        if ((el.getAttribute('data-tile-kind') ?? '') !== 'camera') return false
        if (!(el.getAttribute('data-tile-name') ?? '').includes('رضا موسوی')) return false
        const v = el.querySelector('video'); const st = v?.srcObject
        return st instanceof MediaStream && st.getVideoTracks().some((x) => x.readyState === 'live')
      })
    })
    if (!got) await sleep(500)
  }
  got ? ok('دانش‌آموز ویدیوی زندهٔ معلم را دریافت کرد (پس از بازیابی)') : bad('ویدیو دریافت نشد')

  // ── فاز ۴: قطع LiveKit وسط جلسه → بازیابی خودکار ──
  killLivekit(); await sleep(4000)
  const stDuring = await tPage.evaluate(() => window.__lkRoom?.state)
  console.log('    (حین قطعی: state=' + stDuring + ')')
  startLivekit(); await waitLivekit()
  let recovered = false
  for (let i = 0; i < 60 && !recovered; i++) {
    recovered = await tPage.evaluate(() => window.__lkRoom?.state === 'connected')
    if (!recovered) await sleep(1000)
  }
  recovered ? ok('پس از قطع/وصل LiveKit: اتصال رسانه خودکار بازیابی شد') : bad('بازیابی خودکار ناموفق')
  // بدون جلسهٔ تکراری: فقط همان جلسه فعال
  const list = await sPage.request.get(`${BASE}/api/live-sessions`).then((r) => r.json()).catch(() => null)
  const sessions = (list?.activeSessions ?? list?.classrooms?.flatMap((c) => (c.activeSession ? [c.activeSession] : [])) ?? [])
  const dup = sessions.filter((x) => x.id === sid).length
  ;(dup === 1) ? ok('جلسهٔ تکراری ساخته نشد') : bad(`جلسات: ${JSON.stringify(sessions.map((x) => x.id))}`)

  await tPage.getByRole('button', { name: 'پایان جلسه' }).first().click()
  await tPage.getByRole('button', { name: 'پایان جلسه' }).last().click()
  await sleep(2000)
  ok('پایان جلسه')
} catch (e) { console.log('FAIL:', e.message) } finally { await browser.close(); restoreBinary(); startLivekit(); await waitLivekit() }
console.log(`\nنتیجه: ${pass} پاس / ${fail} شکست`)
process.exit(fail > 0 ? 1 : 0)
