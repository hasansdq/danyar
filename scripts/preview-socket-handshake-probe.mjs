#!/usr/bin/env node
/**
 * پروب تشخیصی handshake سوکت از مسیر پیش‌نمایش (گیت‌وی :81 با XTransformPort=3003)
 *
 * شبیه‌سازی دقیق رفتار مرورگر در پیش‌نمایش:
 *  ۱) لاگین → کوکی daniar_session
 *  ۲) polling handshake → sid
 *  ۳) ارسال بستهٔ CONNECT «40» با همان sid → پاسخ سرور:
 *     «40{...}» = اتصال تأیید شد / «44{...}» = connect_error با کد بی‌خطر
 *
 * کاربرد: تشخیص اینکه چرا پیش‌نمایش «درحال اتصال → قطع اتصال» نشان می‌دهد
 * (کوکی از گیت‌وی عبور نمی‌کند؟ امضا ناسازگار است؟ نقش مجاز نیست؟)
 */
const GATEWAY = process.env.PROBE_GATEWAY ?? 'http://127.0.0.1:81'
const USER = process.env.PROBE_USER ?? 'beheshti.t1'
const PASS = process.env.PROBE_PASS ?? 'Pass@123'
const XOR = 'XTransformPort=3003'

const jar = {}

function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
}

function captureCookies(res) {
  const setCookies = res.headers.getSetCookie?.() ?? []
  for (const sc of setCookies) {
    const [pair] = sc.split(';')
    const eq = pair.indexOf('=')
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (value === '') delete jar[name]
    else jar[name] = value
  }
}

async function main() {
  const t0 = Date.now()
  const ms = () => `${String(Date.now() - t0).padStart(4)}ms`

  // ─── ۱) لاگین ───
  const loginRes = await fetch(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  captureCookies(loginRes)
  const loginBody = await loginRes.json().catch(() => ({}))
  console.log(`[${ms()}] ۱) لاگین ${USER}: HTTP ${loginRes.status} ok=${loginBody.ok} role=${loginBody.user?.role}`)
  if (!loginRes.ok || !loginBody.ok) {
    console.error('✘ لاگین شکست خورد — ادامه بی‌معناست')
    process.exit(1)
  }
  if (!jar.daniar_session) {
    console.error('✘ کوکی daniar_session دریافت نشد')
    process.exit(1)
  }

  // ─── ۲) polling handshake ───
  const hsUrl = `${GATEWAY}/socket.io/?EIO=4&transport=polling&t=probe-${Date.now()}&${XOR}`
  const hsRes = await fetch(hsUrl, {
    headers: { Cookie: cookieHeader(), Origin: GATEWAY },
  })
  captureCookies(hsRes)
  const hsText = await hsRes.text()
  console.log(`[${ms()}] ۲) handshake: HTTP ${hsRes.status} body=${hsText.slice(0, 140)}`)
  const open = hsText.match(/^0(\{.*)$/)
  if (!open) {
    console.error('✘ بستهٔ open engine.io دریافت نشد — مسیر سوکت از گیت‌وی عبور نمی‌کند')
    process.exit(1)
  }
  const sid = JSON.parse(open[1]).sid
  console.log(`[${ms()}]    sid=${sid}`)

  // ─── ۳) بستهٔ CONNECT (40) ───
  const connRes = await fetch(
    `${GATEWAY}/socket.io/?EIO=4&transport=polling&t=probe-${Date.now()}&sid=${sid}&${XOR}`,
    {
      method: 'POST',
      headers: { Cookie: cookieHeader(), Origin: GATEWAY, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '40',
    },
  )
  captureCookies(connRes)
  console.log(`[${ms()}] ۳) POST CONNECT 40: HTTP ${connRes.status}`)

  // ─── ۴) خواندن پاسخ سرور به CONNECT ───
  await new Promise((r) => setTimeout(r, 800))
  const pollRes = await fetch(
    `${GATEWAY}/socket.io/?EIO=4&transport=polling&t=probe-${Date.now()}&sid=${sid}&${XOR}`,
    { headers: { Cookie: cookieHeader(), Origin: GATEWAY } },
  )
  const pollText = await pollRes.text()
  console.log(`[${ms()}] ۴) polling پاسخ: HTTP ${pollRes.status} body=${pollText.slice(0, 200)}`)

  const m = pollText.match(/^(\d\d)(\{.*)/)
  if (m && m[1] === '40') {
    console.log('✔ اتصال سوکت از مسیر پیش‌نمایش تأیید شد (CONNECT OK)')
  } else if (m && m[1] === '44') {
    const err = JSON.parse(m[2])
    console.error(`✘ connect_error از سرور: code=${err.message ?? '?'}`)
    process.exit(2)
  } else {
    console.error(`✘ پاسخ مشخصی به CONNECT نرسید (بالای ۸۰۰ms) — body=${pollText.slice(0, 120)}`)
    process.exit(3)
  }
}

main().catch((e) => {
  console.error('✘ خطای پروب:', e.message)
  process.exit(1)
})
