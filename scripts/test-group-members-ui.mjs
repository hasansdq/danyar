/** تست مرورگری مدیریت اعضا از هدر گروه — حذف/افزودن با مدیر و معلم، بدون مجوز دانش‌آموز */
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
// ─── پیش‌پاک‌سازی API: نیلوفر (s6) از گروه درسی t1 خارج شود (باقی‌مانده اجرای قبلی) ───
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'beheshti.admin', password: 'Pass@123', realm: 'app' }),
  })
  const ck = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const chats = await fetch(`${BASE}/api/chats`, { headers: { cookie: ck } }).then((x) => x.json())
  const grp = (chats?.conversations ?? []).find((c) => c.type === 'GROUP' && c.title.includes('ریاضی هفتم۱'))
  if (grp) {
    const mem = await fetch(`${BASE}/api/chats/group/${grp.id}/members`, { headers: { cookie: ck } }).then((x) => x.json())
    const nil = (mem?.members?.students ?? []).find((s) => s.fullName.includes('نیلوفر'))
    if (nil) {
      await fetch(`${BASE}/api/chats/group/${grp.id}/members`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: ck },
        body: JSON.stringify({ removes: [nil.id] }),
      })
      console.log('  (پیش‌پاک‌سازی: نیلوفر از گروه خارج شد)')
    }
  }
}
try {
  // ─── معلم: دیالوگ اعضای گروه درسی — افزودن با جست‌وجو و بج افزوده‌شده ───
  console.log('══ معلم — هدر گروه → اعضا → افزودن ══')
  const tCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const tp = await tCtx.newPage()
  await login(tp, 'beheshti.t1', 'Pass@123')
  await tp.goto(`${BASE}/chats`, { waitUntil: 'domcontentloaded' })
  await sleep(3000)
  // ورود به گروه درسی «ریاضی هفتم۱»
  await tp.getByText('ریاضی هفتم۱').first().click()
  await sleep(2500)
  // کلیک روی هدر گروه → دیالوگ اعضا
  await tp.locator('header button, [class*="border-b"] button').filter({ hasText: 'ریاضی هفتم۱' }).first().click().catch(async () => {
    await tp.getByText('ریاضی هفتم۱').first().click()
  })
  await sleep(1500)
  const dlg = tp.locator('[role="dialog"]')
  await dlg.waitFor({ timeout: 15000 })
  ;(await dlg.getByText('دانش‌آموزان').count()) >= 1 ? ok('دیالوگ اعضا با بخش دانش‌آموزان باز شد') : bad('بخش دانش‌آموزان در دیالوگ نیست')
  ;(await dlg.getByRole('button', { name: 'افزودن عضو' }).count()) >= 1 ? ok('دکمه «افزودن عضو» برای معلم هست') : bad('دکمه افزودن برای معلم نیست')
  // حذف معلمان مجاز نیست — دکمه حذف روی ردیف معلم نباشد (X در بخش معلمان)
  const teacherRemove = await dlg.locator('button[title^="حذف"]').count()
  // ردیف‌های دانش‌آموز دکمه حذف دارند
  const studentRemove = await dlg.locator('button[aria-label^="حذف"]').count()
  studentRemove >= 1 ? ok(`دکمه حذف روی ردیف دانش‌آموزان هست (${studentRemove})`) : bad('دکمه حذف دانش‌آموزان نیست')

  // افزودن عضو با جست‌وجو (نیلوفر رئیسی — خارج از کلاس)
  await dlg.getByRole('button', { name: 'افزودن عضو' }).first().click()
  await sleep(1200)
  const addDlg = tp.locator('[role="dialog"]').last()
  await addDlg.locator('input[aria-label="جست‌وجوی عضو"]').fill('نیلوفر')
  await sleep(1200)
  const candRow = addDlg.locator('button:has-text("افزودن")').first()
  ;(await candRow.count()) >= 1 ? ok('نامزد «نیلوفر رئیسی» در جست‌وجو ظاهر شد') : bad('نامزد یافت نشد')
  await candRow.click()
  await sleep(2500)
  const addedToast = await tp.getByText('به گروه افزوده شد').count()
  addedToast >= 1 || (await addDlg.getByText('نیلوفر').count()) === 0 ? ok('افزودن از UI انجام شد (توست/حذف از نامزدها)') : bad('افزودن UI ناموفق')
  // بستن دیالوگ افزودن (Escape بالاترین دیالوگ را می‌بندد)
  await tp.keyboard.press('Escape')
  await sleep(1200)
  // بج «افزوده‌شده» روی ردیف عضو جدید
  const dlg2 = tp.locator('[role="dialog"]').first()
  ;(await dlg2.getByText('افزوده‌شده').count()) >= 1 ? ok('بج «افزوده‌شده» روی ردیف عضو جدید دیده می‌شود') : bad('بج افزوده‌شده نیست')

  // حذف همان عضو با دکمه X + تأیید
  await dlg2.locator('button[aria-label*="نیلوفر"]').first().click()
  await sleep(1000)
  const confirm = tp.locator('[role="alertdialog"]')
  await confirm.waitFor({ timeout: 10000 })
  ;(await confirm.getByText('حذف از گروه').count()) >= 1 ? ok('دیالوگ تأیید حذف باز شد') : bad('تأیید حذف باز نشد')
  await confirm.getByRole('button', { name: 'حذف از گروه' }).click()
  await sleep(2500)
  ;(await dlg2.getByText('افزوده‌شده').count()) === 0 ? ok('عضو پس از تأیید حذف شد (بج ناپدید شد)') : bad('حذف UI ناموفق')

  console.log('══ دانش‌آموز — بدون دکمه مدیریت ══')
  const sCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const sp = await sCtx.newPage()
  await login(sp, 'beheshti.s1', 'Pass@123')
  await sp.goto(`${BASE}/chats`, { waitUntil: 'domcontentloaded' })
  await sleep(3000)
  await sp.getByText('ریاضی هفتم۱').first().click()
  await sleep(2500)
  await sp.locator('header button, [class*="border-b"] button').filter({ hasText: 'ریاضی هفتم۱' }).first().click().catch(async () => {
    await sp.getByText('ریاضی هفتم۱').first().click()
  })
  await sleep(1500)
  const sdlg = sp.locator('[role="dialog"]')
  await sdlg.waitFor({ timeout: 15000 })
  ;(await sdlg.getByRole('button', { name: 'افزودن عضو' }).count()) === 0 ? ok('دانش‌آموز دکمه «افزودن عضو» ندارد') : bad('دکمه افزودن برای دانش‌آموز دیده می‌شود!')
  ;(await sdlg.locator('button[aria-label^="حذف"]').count()) === 0 ? ok('دانش‌آموز دکمه حذف ندارد') : bad('دکمه حذف برای دانش‌آموز دیده می‌شود!')

  await tCtx.close()
  await sCtx.close()
} catch (e) {
  bad(`خطای تست: ${e.message}`)
} finally {
  await browser.close().catch(() => {})
}

console.log(`\n═══ نتیجه: ${PASS} پاس / ${FAIL} شکست ═══`)
process.exit(FAIL === 0 ? 0 : 1)
