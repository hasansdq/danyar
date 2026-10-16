/**
 * راستی‌آزمایی E2E پشته استقرار دانیار — از طریق تنها درگاه ورودی :3034
 * (شبیه‌سازی دقیق معماری Docker: درگاه داخلی → web:3000 و socket:3003)
 *
 * پوشش: ورود واقعی، چت بلادرنگ دوطرفه، اعلان، کلاس آنلاین با رسانه واقعی WebRTC،
 * تکلیف + دانلود فایل، پوش مرورگر، ورود پیامکی OTP، دستیار، حفظ رمز حساب موجود.
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const BASE = 'http://localhost:3034'
const V = '.verify-runtime'
const SHOTS = `${V}/shots`
const vapid = JSON.parse(readFileSync(`${V}/vapid.json`, 'utf8'))

let PASS = 0, FAIL = 0
const fails = []
const ok = (cond, msg) => {
  if (cond) { PASS++; console.log('  ✔ ' + msg) }
  else { FAIL++; fails.push(msg); console.log('  ✘ ' + msg) }
}
const section = (t) => console.log('\n── ' + t + ' ──')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// نگهبان کل — فرآیند هرگز معلق نمی‌ماند
setTimeout(() => { console.error('WATCHDOG: زمان کل اجرا تمام شد'); process.exit(2) }, 220_000).unref()

async function apiLogin(username, password, realm = 'app') {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, realm }),
  })
  const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return { status: r.status, cookie: cookies }
}

async function browserLogin(page, username, password, path = '/login') {
  await page.goto(BASE + path)
  await page.fill('#username', username)
  await page.fill('#password', password)
  const rb = page.locator('[role="checkbox"][aria-label="من ربات نیستم"]')
  for (let i = 0; i < 10; i++) {
    if ((await rb.getAttribute('aria-checked')) === 'true') break
    await rb.click().catch(() => {})
    await sleep(300)
  }
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login') && !u.pathname.startsWith('/superadmin/login'), { timeout: 20000 })
}

async function sendChatMessage(page, text) {
  await page.fill('[aria-label="متن پیام"]:visible', text)
  await page.click('[aria-label="ارسال"]:visible')
}

// ───────────────────────────────────────────────
console.log('پوشه E2E استقرار — ' + BASE)
execSync(`mkdir -p ${SHOTS}`)

const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const MEDIA_PERMS = ['camera', 'microphone']
const browser = await chromium.launch({ args: FAKE_MEDIA })
const adminCtx = await browser.newContext()
const admin = await adminCtx.newPage()

// ─── T1: ورود مدیر مدرسه از طریق درگاه یکسان ───
section('T1 — ورود مدیر مدرسه (beheshti.admin) از طریق :3034')
try {
  await browserLogin(admin, 'beheshti.admin', 'Pass@123')
  ok(true, 'ورود موفق و هدایت به خانه پیام‌رسان: ' + new URL(admin.url()).pathname)
  await admin.screenshot({ path: `${SHOTS}/t1-admin-home.png` })
} catch (e) { ok(false, 'ورود مدیر: ' + e.message.slice(0, 120)) }

// ─── T2: رمز مدیر کل موجود تغییر نکرده باشد ───
section('T2 — حفظ رمز حساب‌های موجود (superadmin/Admin@1234 بدون تغییر)')
{
  const sup = await apiLogin('superadmin', 'Admin@1234', 'superadmin')
  ok(sup.status === 200 && sup.cookie.includes('daniar_session'), 'ورود مدیر کل با رمز قبلی همچنان موفق است (مهاجرت رمزها را تغییر نمی‌دهد)')
}

// ─── T3: چت بلادرنگ دوطرفه در گروه (سوکت از طریق درگاه یکسان) ───
section('T3 — پیام‌رسانی بلادرنگ: مدیر ⇄ دانش‌آموز در «ریاضی هفتم۱»')
const GID = 'cmv1aryqy000elokrx43nz39n'
const studentCtx = await browser.newContext()
const student = await studentCtx.newPage()
const MSG_S = 'پیام دانش‌آموز ' + Date.now()
const MSG_A = 'پاسخ مدیر ' + Date.now()
try {
  await browserLogin(student, 'beheshti.s1', 'Pass@123')
  ok(true, 'ورود دانش‌آموز موفق')
  await admin.goto(`${BASE}/chats/group/${GID}`)
  await student.goto(`${BASE}/chats/group/${GID}`)
  await admin.waitForSelector('[aria-label="متن پیام"]:visible', { timeout: 15000 })
  await student.waitForSelector('[aria-label="متن پیام"]:visible', { timeout: 15000 })

  await sendChatMessage(student, MSG_S)
  await admin.waitForSelector(`text=${MSG_S}`, { timeout: 12000 })
  ok(true, 'پیام دانش‌آموز بلادرنگ به مدیر رسید (socket از مسیر /socket.io درگاه)')

  await sendChatMessage(admin, MSG_A)
  await student.waitForSelector(`text=${MSG_A}`, { timeout: 12000 })
  ok(true, 'پاسخ مدیر بلادرنگ به دانش‌آموز رسید')

  await admin.screenshot({ path: `${SHOTS}/t3-realtime.png` })
} catch (e) {
  ok(false, 'چت بلادرنگ: ' + e.message.slice(0, 140))
  await admin.screenshot({ path: `${SHOTS}/t3-fail.png` }).catch(() => {})
}

// ─── T4: پیام خصوصی + اعلان زنگ ───
section('T4 — پیام خصوصی و اعلان درون‌برنامه‌ای')
try {
  const users = await (await fetch(`${BASE}/api/users?role=STUDENT`, { headers: { cookie: (await apiLogin('beheshti.admin', 'Pass@123')).cookie } })).json()
  const list = Array.isArray(users) ? users : users.users ?? []
  const s1 = list.find((u) => u.username === 'beheshti.s1')
  ok(!!s1, 'یافتن دانش‌آموز از API کاربران')
  const DM = 'پیام خصوصی تست ' + Date.now()
  await admin.goto(`${BASE}/chats/dm/${s1.id}`)
  await admin.waitForSelector('[aria-label="متن پیام"]:visible', { timeout: 15000 })
  await sendChatMessage(admin, DM)
  await student.waitForSelector(`text=${DM}`, { timeout: 12000 })
  ok(true, 'پیام خصوصی بلادرنگ به دانش‌آموز رسید')
  const bell = student.locator('[aria-label*="اعلان‌ها"]').first()
  const bellLabel = await bell.getAttribute('aria-label', { timeout: 10000 }).catch(() => null)
  ok(!!bellLabel && /نخوانده/.test(bellLabel), `اعلان نخوانده در زنگ دانش‌آموز: ${bellLabel}`)
  await student.screenshot({ path: `${SHOTS}/t4-dm-bell.png` })
} catch (e) { ok(false, 'پیام خصوصی/اعلان: ' + e.message.slice(0, 140)) }

// ─── T5: کلاس آنلاین با رسانه واقعی WebRTC (دستگاه‌های مجازی مرورگر) ───
section('T5 — کلاس آنلاین: signaling از درگاه + رسانه P2P (دوربین مجازی)')
try {
  const t = await apiLogin('beheshti.t1', 'Pass@123')
  const CID = 'cmv1aryqw000alokrajw9ermw' // ریاضی هفتم۱
  const created = await (await fetch(`${BASE}/api/live-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: t.cookie },
    body: JSON.stringify({ classroomId: CID, notifyGroupId: GID, title: 'کلاس راستی‌آزمایی استقرار' }),
  })).json()
  ok(!!created.id, 'ساخت جلسه از مسیر واقعی API: ' + (created.id ?? created.error))

  const teacherCtx = await browser.newContext({ permissions: MEDIA_PERMS })
  const teacher = await teacherCtx.newPage()
  await browserLogin(teacher, 'beheshti.t1', 'Pass@123')
  await teacher.goto(`${BASE}/live/${created.id}`)
  await sleep(5000)

  await student.goto(`${BASE}/live/${created.id}`)
  await sleep(7000)

  // شرکت‌کنندگان از دید معلم
  const panelText = await teacher.locator('body').innerText()
  ok(panelText.includes('رضا احمدی'), 'دانش‌آموز (رضا احمدی) در اتاق معلم دیده می‌شود')

  // رسانه: ویدئوی زنده معلم در مرورگر دانش‌آموز
  const hasStream = await student.evaluate(() => {
    return [...document.querySelectorAll('video')].some((v) => v.srcObject && v.srcObject.getVideoTracks().length > 0)
  })
  ok(hasStream, 'استریم ویدئوی معلم (WebRTC P2P) در مرورگر دانش‌آموز فعال است')
  await teacher.screenshot({ path: `${SHOTS}/t5-teacher.png` })
  await student.screenshot({ path: `${SHOTS}/t5-student.png` })

  // اشتراک صفحه: دسترسی UI برای معلم حفظ شده باشد
  const shareBtn = await teacher.locator('button', { hasText: 'اشتراک صفحه' }).count()
  ok(shareBtn > 0, 'دکمه اشتراک صفحه در اتاق معلم موجود است')

  // پایان جلسه (پاک‌سازی)
  await fetch(`${BASE}/api/live-sessions/${created.id}/end`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: t.cookie },
    body: JSON.stringify({}),
  })
  await teacherCtx.close()
} catch (e) { ok(false, 'کلاس آنلاین: ' + e.message.slice(0, 140)) }

console.log('\nبخش ۱: ' + PASS + ' موفق، ' + FAIL + ' ناموفق')
if (fails.length) console.log(fails.map((f) => '  ✘ ' + f).join('\n'))
await browser.close()
process.exit(FAIL > 0 ? 1 : 0)
