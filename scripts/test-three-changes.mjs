// تست E2E سه تغییر: تقویم پیش‌فرض لیستی + تب‌های مجزای کلاس/گروه + ضدتکرار ارور استریم
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = process.env.TEST_BASE || 'http://localhost:81'
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }

// ─── بخش ۳ (API): ضدتکرار شروع جلسه ───
async function liveAntiRepeat() {
  console.log('— ضدتکرار شروع جلسه (farzanegan.t1)')
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'farzanegan.t1', password: 'Pass@123', realm: 'app' }),
  })
  const cookie = (loginRes.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  ok(loginRes.ok, 'ورود معلم')

  const teacher = await db.user.findUnique({ where: { username: 'farzanegan.t1' }, select: { id: true } })
  const assign = await db.teachingAssignment.findFirst({
    where: { teacherId: teacher.id },
    include: { subjectGroup: { select: { id: true, classroomId: true } } },
  })
  const payload = {
    classroomId: assign.subjectGroup.classroomId,
    notifyGroupId: assign.subjectGroup.id,
    title: 'تست ضدتکرار',
  }

  // پاک‌سازی جلسات فعال قبلی
  await db.liveSession.updateMany({
    where: { classroomId: payload.classroomId, status: 'ACTIVE' },
    data: { status: 'ENDED', endedAt: new Date() },
  })

  const post = () =>
    fetch(`${BASE}/api/live-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(payload),
    })

  // تلاش اول → 201
  const r1 = await post()
  const d1 = await r1.json()
  ok(r1.status === 201 && d1.id, `تلاش اول: جلسه ساخته شد (${r1.status})`)

  // تلاش دوم بلافاصله (شبیه‌سازی تلاش مجدد پس از شکست ورود) → نباید 409 ارور بدهد
  const r2 = await post()
  const d2 = await r2.json()
  ok(r2.status === 201 && d2.id && d2.id !== d1.id, `تلاش دوم بلافاصله: جلسه تازه ساخته شد، بدون ارور (${r2.status})`)
  const old1 = await db.liveSession.findUnique({ where: { id: d1.id }, select: { status: true } })
  ok(old1?.status === 'ENDED', 'جلسه نیمه‌کاره قبلی خودکار پایان یافت')

  // جلسه دارای شرکت‌کننده → تلاش مجدد = ورود مجدد (reused) نه ارور
  await db.liveParticipantLog.create({
    data: { sessionId: d2.id, userId: teacher.id, role: 'TEACHER' },
  })
  const r3 = await post()
  const d3 = await r3.json()
  ok(r3.status === 200 && d3.reused === true && d3.id === d2.id, `تلاش مجدد با جلسه در جریان: reused (${r3.status})`)

  // پاک‌سازی
  await db.liveSession.updateMany({
    where: { id: d2.id, status: 'ACTIVE' },
    data: { status: 'ENDED', endedAt: new Date() },
  })
  await db.liveParticipantLog.deleteMany({ where: { sessionId: d2.id } })
}

// ─── بخش ۱ و ۲ (UI): تقویم + تب‌ها ───
async function uiChecks() {
  console.log('— UI: تقویم و تب‌های مدیریت مدرسه (beheshti.admin)')
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'fa' })
  const page = await ctx.newPage()

  try {
    // ورود
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.locator('input[name="username"], #username, input[type="text"]').first().fill('beheshti.admin')
    await page.locator('input[type="password"]').first().fill('Pass@123')
    const robot = page.locator('[role="checkbox"][aria-label="من ربات نیستم"]')
    if (await robot.count()) await robot.click()
    await page.locator('button[type="submit"]').first().click()
    await page.waitForTimeout(3500)

    // ۱) تقویم — پیش‌فرض لیستی
    await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(1500)
    const listBtn = page.locator('[aria-label="نمای لیستی"]')
    const gridBtn = page.locator('[aria-label="نمای شبکه‌ای"]')
    ok(await listBtn.getAttribute('aria-pressed') === 'true', 'تقویم: پیش‌فرض «لیستی» فعال است')
    ok(await gridBtn.getAttribute('aria-pressed') === 'false', 'تقویم: «شبکه‌ای» غیرفعال (در دسترس با کلیک)')
    await page.screenshot({ path: '/home/z/my-project/download/calendar-default-list.png' })

    // ۲) تب‌های مجزا در مدیریت مدرسه
    await page.goto(`${BASE}/modir/classes`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(1500)
    const tabClasses = page.locator('[role="tab"]', { hasText: 'کلاس‌ها' })
    const tabGroups = page.locator('[role="tab"]', { hasText: 'گروه‌های درسی' })
    ok((await tabClasses.count()) === 1 && (await tabGroups.count()) === 1, 'دو تب مجزا نمایش داده شد')
    ok(await page.locator('#grade-select').isVisible(), 'تب کلاس‌ها: فرم ایجاد کلاس نمایان')
    ok(!(await page.locator('#group-class-select').isVisible().catch(() => false)), 'تب کلاس‌ها: فرم گروه مخفی (مجزا)')

    await tabGroups.click()
    await page.waitForTimeout(800)
    ok(await page.locator('#group-class-select').isVisible(), 'تب گروه‌ها: فرم ایجاد گروه نمایان')
    ok(await page.locator('#grade-select').isHidden(), 'تب گروه‌ها: فرم کلاس مخفی (مجزا)')
    const groupsList = await page.locator('text=فهرست گروه‌های درسی').count()
    ok(groupsList >= 1, 'تب گروه‌ها: فهرست گروه‌های درسی نمایش داده شد')
    await page.screenshot({ path: '/home/z/my-project/download/modir-groups-tab.png' })

    await tabClasses.click()
    await page.waitForTimeout(500)
    ok(await page.locator('#grade-select').isVisible(), 'بازگشت به تب کلاس‌ها سالم است')
  } catch (e) {
    fail++
    console.log('  ✗ خطای UI:', e.message.split('\n')[0])
    await page.screenshot({ path: '/home/z/my-project/download/modir-error.png' }).catch(() => {})
  } finally {
    await browser.close()
  }
}

try {
  await uiChecks()
  await liveAntiRepeat()
} finally {
  await db.$disconnect()
}
console.log(`\nنتیجه: ${pass} سبز / ${fail} قرمز`)
process.exit(fail ? 1 : 0)
