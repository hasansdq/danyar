/** تست مرورگری دیالوگ «گروه‌های عمومی مدرسه» در پیام‌رسان — مدیر می‌بیند/می‌سازد، دانش‌آموز نمی‌بیند */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE ?? 'http://localhost:81'
let PASS = 0
let FAIL = 0
const ok = (m) => { PASS++; console.log(`  ✅ ${m}`) }
const bad = (m) => { FAIL++; console.log(`  ❌ ${m}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    } catch {
      await sleep(2000)
    }
  }
  throw new Error(`login failed for ${username}`)
}

const browser = await chromium.launch()
try {
  console.log('══ مدیر مدرسه ══')
  const aCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const ap = await aCtx.newPage()
  await login(ap, 'beheshti.admin', 'Pass@123')
  await ap.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  await ap.locator('button[aria-label="گفتگوی جدید"], button[title="گفتگوی جدید"]').first().click()
  await sleep(1200)
  const section = await ap.getByText('گروه‌های عمومی مدرسه').count()
  section >= 1 ? ok('بخش «گروه‌های عمومی مدرسه» برای مدیر دیده می‌شود') : bad('بخش گروه‌های عمومی برای مدیر نیست')
  const cards = await ap.getByText('گروه همکاران', { exact: true }).count()
  cards >= 1 ? ok('کارت «گروه همکاران» هست') : bad('کارت همکاران نیست')
  const gradeCard = await ap.getByText('گروه بر اساس پایه').count()
  gradeCard >= 1 ? ok('کارت «گروه بر اساس پایه» هست') : bad('کارت پایه نیست')

  // ایجاد گروه همکاران با کلیک
  await ap.getByText('گروه همکاران', { exact: true }).first().click()
  await sleep(300)
  await ap.locator('button:has-text("ایجاد")').last().click()
  await sleep(3000)
  const url = ap.url()
  url.includes('/chats/group/') ? ok(`ایجاد از دیالوگ → انتقال به گفتگو (${url.slice(-8)})`) : bad(`انتقال نشد: ${url}`)
  const header = await ap.getByText('گروه همکاران مدرسه').first().count()
  header >= 1 ? ok('هدر گفتگو زیرعنوان «گروه همکاران مدرسه» دارد') : bad('زیرعنوان در هدر نیست')

  console.log('══ دانش‌آموز ══')
  const sCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const sp = await sCtx.newPage()
  await login(sp, 'beheshti.s1', 'Pass@123')
  await sp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  await sp.locator('button[aria-label="گفتگوی جدید"], button[title="گفتگوی جدید"]').first().click()
  await sleep(1200)
  const sSection = await sp.getByText('گروه‌های عمومی مدرسه').count()
  sSection === 0 ? ok('دانش‌آموز بخش گروه‌های عمومی را نمی‌بیند (درست)') : bad('بخش عمومی برای دانش‌آموز دیده می‌شود!')
  const sCandidates = await sp.getByText('شروع گفتگوی خصوصی').count()
  sCandidates >= 1 ? ok('دیالوگ خصوصی برای دانش‌آموز سالم است') : bad('دیالوگ خصوصی دانش‌آموز خراب شد')

  await aCtx.close()
  await sCtx.close()
} catch (e) {
  bad(`خطای آزمون: ${e.message}`)
} finally {
  await browser.close()
}

// پاک‌سازی گروه ساخته‌شده
try {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'beheshti.admin', password: 'Pass@123', realm: 'app' }),
  })
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const list = await fetch(`${BASE}/api/groups/school`, { headers: { cookie } }).then((x) => x.json())
  for (const g of list.groups ?? []) {
    await fetch(`${BASE}/api/groups/${g.id}?confirm=true`, { method: 'DELETE', headers: { cookie } })
  }
  console.log(`پاک‌سازی: ${(list.groups ?? []).length} گروه حذف شد`)
} catch (e) {
  console.log('پاک‌سازی ناموفق:', e.message)
}

console.log(`\n═══ نتیجه: ${PASS} پاس / ${FAIL} شکست ═══`)
process.exit(FAIL ? 1 : 0)
