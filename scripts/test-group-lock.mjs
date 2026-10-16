#!/usr/bin/env node
/**
 * تست سرتاسری «قفل گروه برای دانش‌آموزان» — جایگزین «بستن گروه»:
 *   ۱) UI پنل مدیر مدرسه (/modir/groups): آیکون قفل هست، آیکون بستن (بایگانی) حذف شده؛
 *      کلیک قفل → تأیید → نشان «قفل برای دانش‌آموزان» روی همان ردیف
 *   ۲) API: قفل فقط برای مدیر مدرسه؛ دانش‌آموز قفل‌شده:
 *      - گروه در فهرست گفتگوها مخفی نمی‌شود
 *      - پیام‌ها را می‌بیند (GET سبز)
 *      - ارسال متن/پیوست → ۴۰۳ با پیام قابل‌فهم
 *      - معلم/مدیر عادی پیام می‌فرستند (بی‌تأثیر)
 *   ۳) برداشتن قفل → دانش‌آموز دوباره می‌فرستد
 *
 * اجرا: node scripts/test-group-lock.mjs
 */
const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:81'

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    fail++
    failures.push(name)
    console.error(`  ✘ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

const okSend = (s) => s === 200 || s === 201

function makeClient() {
  const jar = {}
  return {
    jar,
    async fetch(path, opts = {}) {
      const headers = { ...(opts.headers ?? {}) }
      if (Object.keys(jar).length) headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
      const res = await fetch(`${BASE}${path}`, { ...opts, headers })
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(';')
        const eq = pair.indexOf('=')
        const name = pair.slice(0, eq).trim()
        const value = pair.slice(eq + 1).trim()
        if (value === '') delete jar[name]
        else jar[name] = value
      }
      return res
    },
    async json(path, opts = {}) {
      const res = await this.fetch(path, opts)
      const body = await res.json().catch(() => null)
      return { status: res.status, body }
    },
  }
}

async function main() {
  const admin = makeClient()
  const teacher = makeClient()
  const student = makeClient()

  console.log('─ ۰) ورود حساب‌ها')
  const lg = (r, name) => ok(name, r.status === 200 && r.body?.ok === true)
  lg(await admin.json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'beheshti.admin', password: 'Pass@123' }) }), 'ورود مدیر مدرسه (beheshti.admin)')
  lg(await teacher.json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'beheshti.t1', password: 'Pass@123' }) }), 'ورود معلم (beheshti.t1)')
  lg(await student.json('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'beheshti.s1', password: 'Pass@123' }) }), 'ورود دانش‌آموز (beheshti.s1)')

  console.log('─ ۱) انتخاب گروه عضوِ دانش‌آموز')
  const chats = await student.json('/api/chats')
  const convs = chats.body?.conversations ?? chats.body?.groups ?? []
  const groupConv = convs.find((c) => c.type === 'GROUP' && c.id)
  ok('دانش‌آموز حداقل یک گروه دارد', !!groupConv, groupConv?.title ?? '')
  if (!groupConv) process.exit(1)
  const gid = groupConv.id
  const gname = groupConv.title ?? gid

  console.log('─ ۲) مبنا پیش از قفل')
  const baseStudent = await student.json(`/api/chats/group/${gid}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'مبنای دانش‌آموز پیش از قفل', clientId: `lockbase-${Date.now()}` }),
  })
  ok('دانش‌آموز پیش از قفل پیام می‌فرستد', okSend(baseStudent.status))

  const baseTeacher = await teacher.json(`/api/chats/group/${gid}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'مبنای معلم پیش از قفل', clientId: `lockbaset-${Date.now()}` }),
  })
  const teacherCanSend = okSend(baseTeacher.status)
  ok(teacherCanSend ? 'معلم پیش از قفل پیام می‌فرستد' : 'معلم به این گروه منتسب نیست (اطلاعی)', teacherCanSend ? true : baseTeacher.status === 403)

  console.log('─ ۳) قفل توسط مدیر')
  const lockRes = await admin.json(`/api/groups/${gid}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lockedForStudents: true }),
  })
  ok('PATCH lockedForStudents=true (مدیر) سبز', lockRes.status === 200 && lockRes.body?.group?.lockedForStudents === true)

  const teacherLockTry = await teacher.json(`/api/groups/${gid}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lockedForStudents: true }),
  })
  ok('معلم اجازه قفل ندارد (۴۰۳/۴۰۴)', teacherLockTry.status === 403 || teacherLockTry.status === 404)
  const studentLockTry = await student.json(`/api/groups/${gid}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lockedForStudents: false }),
  })
  ok('دانش‌آموز اجازه قفل/بازکردن ندارد (۴۰۳/۴۰۴)', studentLockTry.status === 403 || studentLockTry.status === 404)

  console.log('─ ۴) حالت قفل — دانش‌آموز فقط مشاهده‌گر')
  const listAfter = await student.json('/api/chats')
  const convsAfter = listAfter.body?.conversations ?? listAfter.body?.groups ?? []
  ok('گروه قفل‌شده هنوز در فهرست گفتگوهای دانش‌آموز است (مخفی نمی‌شود)', convsAfter.some((c) => c.id === gid))

  const readRes = await student.json(`/api/chats/group/${gid}/messages`)
  ok('دانش‌آموز پیام‌های گروه را می‌بیند (GET سبز)', readRes.status === 200)
  ok('conversation.canSend دانش‌آموز=false', readRes.body?.conversation?.canSend === false)
  ok('دلیل قابل‌فهم قفل به کلاینت می‌رسد', (readRes.body?.conversation?.cannotSendReason ?? '').includes('قفل'))
  ok('پرچم lockedForStudents در گفتگو هست', readRes.body?.conversation?.lockedForStudents === true)

  const sendText = await student.json(`/api/chats/group/${gid}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'تلاش ارسال در حالت قفل', clientId: `locktext-${Date.now()}` }),
  })
  ok('ارسال متن دانش‌آموز در قفل → ۴۰۳', sendText.status === 403, sendText.body?.error ?? '')
  ok('پیام ردشدگی دربارهٔ قفل است', (sendText.body?.error ?? '').includes('قفل'))

  const sendFile = await student.json(`/api/chats/group/${gid}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      body: '',
      clientId: `lockfile-${Date.now()}`,
      attachment: { name: 'x.png', key: 'uploads/test.png', mime: 'image/png', size: 10, type: 'IMAGE', meta: null },
    }),
  })
  ok('ارسال فایل/پیوست دانش‌آموز در قفل → ۴۰۳ (قبل از اعتبارسنجی پیوست)', sendFile.status === 403)

  const teacherDuring = await teacher.json(`/api/chats/group/${gid}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'پیام معلم در حالت قفل', clientId: `locktd-${Date.now()}` }),
  })
  if (teacherCanSend) {
    ok('معلم در حالت قفل عادی پیام می‌فرستد (بی‌تأثیر)', okSend(teacherDuring.status))
  } else {
    ok('معلم (نامنتسب) همان مبنای پیش از قفل را دارد', teacherDuring.status === 403)
  }
  const adminDuring = await admin.json(`/api/chats/group/${gid}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'پیام مدیر در حالت قفل', clientId: `lockad-${Date.now()}` }),
  })
  ok('مدیر مدرسه در حالت قفل پیام می‌فرستد', okSend(adminDuring.status))

  console.log('─ ۵) برداشتن قفل')
  const unlockRes = await admin.json(`/api/groups/${gid}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lockedForStudents: false }),
  })
  ok('PATCH lockedForStudents=false سبز', unlockRes.status === 200 && unlockRes.body?.group?.lockedForStudents === false)
  const sendAfter = await student.json(`/api/chats/group/${gid}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'پس از برداشتن قفل دوباره می‌فرستم', clientId: `unlock-${Date.now()}` }),
  })
  ok('دانش‌آموز پس از برداشتن قفل دوباره می‌فرستد', okSend(sendAfter.status))

  console.log('─ ۶) UI پنل مدیر مدرسه (مرورگر واقعی)')
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  try {
    // الگوی امتحان‌شدهٔ login از test-groups-ui.mjs
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    await page.fill('#username', 'beheshti.admin')
    await page.fill('#password', 'Pass@123')
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
      if (!page.url().includes('/login')) break
      await sleep(500)
    }
    ok('ورود مدیر از مرورگر', !page.url().includes('/login'))

    await page.goto(`${BASE}/modir/classes`, { waitUntil: 'domcontentloaded' })
    await sleep(1200)
    await page.locator('aside a[href="/modir/groups"]').first().click()
    await page.waitForURL('**/modir/groups', { timeout: 15000 })
    await sleep(1500)
    await page.waitForSelector('.py-3', { timeout: 30000 })

    const lockButtons = await page.locator('button[aria-label^="قفل گروه"], button[aria-label^="برداشتن قفل گروه"]').count()
    ok('آیکون قفل گروه در فهرست هست', lockButtons > 0, `${lockButtons} دکمه`)
    const closeButtons = await page.locator('button[title="بستن گروه"], button[title="بازکردن گروه"], button[aria-label="بستن گروه"]').count()
    ok('آیکون بستن گروه حذف شده', closeButtons === 0)

    // قفل همان گروه آزمون از رابط واقعی
    const row = page.locator('.py-3', { hasText: gname }).first()
    await row.locator('button[aria-label^="قفل گروه"]').first().click()
    await page.waitForSelector('text=برای دانش‌آموزان؟', { timeout: 10000 })
    ok('دیالوگ تأیید قفل با توضیح صحیح باز شد', await page.locator('text=فقط ارسال پیام و فایل دانش‌آموزان بسته می‌شود').count() > 0)
    await page.locator('button:has-text("تأیید")').last().click()
    await page.waitForSelector('.py-3 >> text=قفل برای دانش‌آموزان', { timeout: 20000 })
    ok('نشان «قفل برای دانش‌آموزان» روی ردیف ظاهر شد', true)

    // بازگشت وضعیت از UI: برداشتن قفل
    await row.locator('button[aria-label^="برداشتن قفل گروه"]').first().click()
    await page.locator('button:has-text("تأیید")').last().click()
    await page.waitForFunction(
      (g) => !document.body.innerText.includes('قفل برای دانش‌آموزان'),
      gname,
      { timeout: 20000 },
    ).catch(() => {})
    const badgeLeft = await page.locator('.py-3 >> text=قفل برای دانش‌آموزان').count()
    ok('برداشتن قفل از UI هم کار می‌کند (نشان رفت)', badgeLeft === 0)

    await page.screenshot({ path: 'download/149-group-lock-icon.png', fullPage: false })
    ok('اسکرین‌شات ذخیره شد (download/149-group-lock-icon.png)', true)
  } finally {
    // اطمینان: گروه آزمون قفل نماند
    await admin.json(`/api/groups/${gid}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lockedForStudents: false }),
    })
    await browser.close()
  }

  console.log('')
  console.log(`نتیجه: ${pass} موفق، ${fail} ناموفق`)
  if (failures.length) {
    console.error('شکست‌ها:', failures.join(' | '))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('خطای کلی:', e)
  process.exit(1)
})
