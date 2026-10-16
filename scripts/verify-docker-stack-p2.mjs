/**
 * فاز ۲ راستی‌آزمایی استقرار — گیت امنیتی، تکلیف/فایل، پوش (headful)، OTP، دستیار
 * اجرا: xvfb-run -a node scripts/verify-docker-stack-p2.mjs   (برای پوش headful)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { spawnSync } from 'child_process'

const BASE = 'http://localhost:3034'
const SHOTS = '.verify-runtime/shots'

let PASS = 0, FAIL = 0
const fails = []
const ok = (cond, msg) => {
  if (cond) { PASS++; console.log('  ✔ ' + msg) }
  else { FAIL++; fails.push(msg); console.log('  ✘ ' + msg) }
}
const section = (t) => console.log('\n── ' + t + ' ──')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
setTimeout(() => { console.error('WATCHDOG'); process.exit(2) }, 300_000).unref()

async function apiLogin(username, password, realm = 'app') {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, realm }),
  })
  return { status: r.status, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') }
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

console.log('فاز ۲ — ' + BASE)

// ─── P0: گیت امنیتی production (پورت جدا برای عدم تداخل) ───
section('P0 — گیت امنیتی: اجرای production با کلید نمونه/فاقد مجاز نیست')
{
  const envBad = { ...process.env, NODE_ENV: 'production', SOCKET_PORT: '3999', DATABASE_URL: 'file:db/custom.db', SESSION_SECRET: 'please-change-this-secret-in-production', SOCKET_INTERNAL_SECRET: 'change-this-internal-secret' }
  const bad = spawnSync('node', ['socket-server.mjs'], { env: envBad, encoding: 'utf8', timeout: 15000 })
  const out = (bad.stderr ?? '') + (bad.stdout ?? '')
  ok(bad.status !== 0 && out.includes('SESSION_SECRET'), 'سرویس Socket با کلید نمونه اجرا نمی‌شود — پیام: ' + out.trim().split('\n')[0].slice(0, 90))
  const noSecret = spawnSync('node', ['socket-server.mjs'], { env: { ...process.env, NODE_ENV: 'production', SOCKET_PORT: '3999', DATABASE_URL: 'file:db/custom.db' }, encoding: 'utf8', timeout: 15000 })
  ok(noSecret.status !== 0 && ((noSecret.stderr ?? '') + '').includes('SESSION_SECRET'), 'بدون هیچ کلیدی هم اجرا نمی‌شود (پیام واضح)')
}

// ─── P1: تکلیف + دانلود فایل ───
section('P1 — تکالیف: آپلود پیوست معلم + دانلود دانش‌آموز')
try {
  const t = await apiLogin('beheshti.t1', 'Pass@123')
  const boundary = '----daniar-e2e-' + Date.now()
  const fileBody = 'دانیار — فایل آزمون استقرار ' + Date.now()
  const form =
    `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nassignment\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\n${fileBody}\r\n--${boundary}--\r\n`
  const up = await (await fetch(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: t.cookie },
    body: form,
  })).json()
  ok(!!up?.key, 'آپلود پیوست از مسیر واقعی API')
  const GID = 'cmv1aryqy000elokrx43nz39n'
  const created = await (await fetch(`${BASE}/api/assignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: t.cookie },
    body: JSON.stringify({ subjectGroupId: GID, title: 'تکلیف استقرار ' + Date.now(), description: 'بررسی زنجیره فایل', attachment: { key: up.key } }),
  })).json()
  ok(!!created?.id, 'ایجاد تکلیف با پیوست: ' + (created?.id ?? created?.error))
  const s = await apiLogin('beheshti.s1', 'Pass@123')
  const dl = await fetch(`${BASE}/api/assignments/${created.id}/attachment`, { headers: { cookie: s.cookie } })
  const text = await dl.text()
  ok(dl.status === 200 && text.includes('دانیار — فایل آزمون استقرار'), `دانلود پیوست توسط دانش‌آموز (${dl.status}) و محتوا مطابق`)
  const noAuth = await fetch(`${BASE}/api/assignments/${created.id}/attachment`)
  ok(noAuth.status === 401 || noAuth.status === 403, 'دانلود بدون نشست رد می‌شود (' + noAuth.status + ')')
} catch (e) { ok(false, 'تکلیف/فایل: ' + e.message.slice(0, 140)) }

// ─── P2: Web Push — ارسال واقعی Web Push (VAPID + رمزنگاری payload) به سرویس آزمون ───
// محدودیت محیط: Chromium حتی با grantPermissions مجوز Notification را در headless/xvfb
// «denied» می‌دهد — پس مسیر اشتراک مرورگر اینجا قابل تست نیست (گزارش: انجام‌نشده).
// به‌جای آن زنجیره سمت سرور واقعی را کامل می‌آزماییم: اشتراک واقعی + ارسال واقعی
// web-push (امضای VAPID + رمزنگاری aes128gcm) به سرویس آزمون پوش روی HTTPS.
section('P2 — Web Push: اشتراک + ارسال آزمایشی واقعی (VAPID → سرویس پوش HTTPS)')
try {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // فقط برای گواهی خودامضای سرویس آزمون
  const crypto = await import('crypto')
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  const p256dh = ecdh.getPublicKey(null, 'uncompressed').toString('base64url')
  const auth = crypto.randomBytes(16).toString('base64url')
  const a = await apiLogin('beheshti.admin', 'Pass@123')
  const endpoint = `https://127.0.0.1:3057/push/e2e-${Date.now()}`
  const sub = await fetch(`${BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: a.cookie },
    body: JSON.stringify({ endpoint, keys: { p256dh, auth }, deviceId: 'e2e-device', label: 'E2E آزمون' }),
  })
  ok(sub.status === 200, 'ثبت اشتراک پوش از مسیر واقعی API (' + sub.status + ')')

  const test = await fetch(`${BASE}/api/push/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: a.cookie },
    body: JSON.stringify({ deviceId: 'e2e-device' }),
  })
  const tr = await test.json().catch(() => null)
  ok(test.status === 200 && tr?.ok === true, `ارسال آزمایشی واقعی موفق: ${tr?.message ?? '—'}`)
  if (tr?.ok !== true) console.log('   خطاهای واقعی:', JSON.stringify(tr?.errors))

  const all = await (await fetch('https://127.0.0.1:3057/records')).json().catch(() => null)
  const rec = all?.records?.filter((r) => r.tag.includes('e2e-')).pop()
  ok(!!rec && rec.status === 201 && (rec.authHeader ?? '').includes('PRESENT') && (rec.bodyB64?.length ?? 0) > 100, `سرویس پوش، ارسال امضاشده با VAPID را دریافت کرد (HTTP ${rec?.status}، payload ${rec?.bodyB64?.length} بایت رمزنگاری‌شده aes128gcm)`)
  console.log('  ⚠ دریافت اعلان در مرورگر (SW): انجام‌نشده — Chromium headless/xvfb مجوز Notification را suppressed می‌دهد؛ در مرورگر واقعی همین مسیر کار می‌کند')
} catch (e) {
  ok(false, 'پوش: ' + e.message.slice(0, 140))
}

// ─── P3: ورود پیامکی OTP با سرویس‌دهنده REST سازگار ───
section('P3 — OTP: درخواست کد → سرویس‌دهنده واقعی (HTTP) → تأیید و ورود')
try {
  const sup = await apiLogin('superadmin', 'Admin@1234', 'superadmin')
  const cfg = await fetch(`${BASE}/api/admin/sms/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: sup.cookie },
    body: JSON.stringify({
      config: {
        enabled: true, smsLoginEnabled: true, provider: 'otpy',
        credentials: { endpoint: 'http://127.0.0.1:3056/send', bodyTemplate: '{"phone":"{{phone}}","code":"{{code}}"}' },
      },
    }),
  })
  ok(cfg.status === 200, 'پیکربندی ورود پیامکی از پنل مدیر کل (' + cfg.status + ')')
  await fetch('http://127.0.0.1:3056/reset', { method: 'POST' })

  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.locator('[role="tab"]').nth(1).click()
  await page.fill('[placeholder="09xxxxxxxxx"]', '09121660949')
  // درخواست پیامکی هم مثل ورود رمزی، تیک «من ربات نیستم» می‌خواهد
  const rb = page.locator('[role="checkbox"][aria-label="من ربات نیستم"]')
  for (let i = 0; i < 10; i++) {
    if ((await rb.getAttribute('aria-checked')) === 'true') break
    await rb.click().catch(() => {})
    await sleep(300)
  }
  await page.locator('button', { hasText: 'ارسال کد ورود' }).click()
  await page.waitForTimeout(4000)
  const inbox = await (await fetch('http://127.0.0.1:3056/messages')).json()
  ok(inbox.count > 0, 'درخواست کد → سرویس‌دهنده واقعاً فراخوانی شد (' + inbox.count + ' پیامک)')
  const code = inbox.messages?.[0]?.code
  ok(!!code, 'کد از سرویس‌دهنده دریافت شد (در DB هش‌شده ذخیره می‌شود)')
  await page.fill('[placeholder="––––––"]', code)
  await page.locator('button', { hasText: 'ورود به دانیار' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
  ok(true, 'ورود با OTP موفق → ' + new URL(page.url()).pathname)
  await page.screenshot({ path: `${SHOTS}/p3-otp.png` })
  await browser.close()
} catch (e) { ok(false, 'OTP: ' + e.message.slice(0, 140)) }

// ─── P4: دستیار دانیار — موجود در فهرست گفتگوهای مدیر مدرسه ───
section('P4 — دستیار دانیار (UI + API)')
try {
  const a = await apiLogin('beheshti.admin', 'Pass@123')
  const chats = await (await fetch(`${BASE}/api/chats`, { headers: { cookie: a.cookie } })).json()
  const list = Array.isArray(chats) ? chats : chats.conversations ?? []
  const ai = list.find((c) => c.type === 'ASSISTANT' || c.key === 'assistant')
  ok(!!ai, 'گفتگوی «دستیار دانیار» در پاسخ API گفتگوها موجود است')
  const browser = await chromium.launch()
  const page = await (await browser.newContext()).newPage()
  await browserLogin(page, 'beheshti.admin', 'Pass@123')
  await page.locator('text=دستیار دانیار').first().waitFor({ timeout: 15000 })
  ok(true, '«دستیار دانیار» در رابط کاربری فهرست گفتگوها دیده می‌شود')
  await browser.close()
  console.log('  ⚠ فراخوانی واقعی هوش مصنوعی: انجام‌نشده (اعتبارنامه سرویس AI در این محیط وجود ندارد)')
} catch (e) { ok(false, 'دستیار: ' + e.message.slice(0, 140)) }

console.log('\nفاز ۲: ' + PASS + ' موفق، ' + FAIL + ' ناموفق')
if (fails.length) console.log(fails.map((f) => '  ✘ ' + f).join('\n'))
process.exit(FAIL > 0 ? 1 : 0)
