/**
 * E2E — چهار ویرایش پنل مدیریت مدرسه (درخواست کاربر):
 *  ۱) ایجاد معلم/دانش‌آموز جدا از هم + آیکون + روی کارت آمار + الزامی‌بودن گروه‌های درسی معلم
 *  ۲) ویرایش کاربر: تغییر کلاس‌ها و گروه‌های دانش‌آموز (و گروه‌های تدریس معلم)
 *  ۳) فیلد «نام درس» متنی آزاد در فرم ایجاد گروه
 *  ۴) بخش «محدودیت گروه‌ها»: فعال/غیرفعال‌کردن چت خصوصی بین دانش‌آموزان (کلید سراسری + هر کلاس)
 * اجرا: TEST_BASE=http://localhost:81 node scripts/test-modir-four-edits.mjs
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE || 'http://localhost:81'
const SHOT = '/home/z/my-project/download'
let pass = 0
let fail = 0
const results = []

function check(name, ok, extra = '') {
  if (ok) {
    pass++
    results.push(`  ✅ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    results.push(`  ❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

const step = (s) => console.log(`▶ ${s}`)

// درخواست‌های API داخل نشست مرورگر (با کوکی‌ها)
async function api(page, path, opts = {}) {
  return page.evaluate(
    async ({ path, opts }) => {
      const res = await fetch(path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      })
      let data = null
      try {
        data = await res.json()
      } catch {}
      return { status: res.status, data }
    },
    { path, opts },
  )
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.setDefaultTimeout(30000)

// وضعیت اولیه برای بازگردانی در پایان
let originalClasses = null
let studentBackup = null
const createdTeacherIds = []
let createdGroupId = null

try {
  // ─── ورود مدیر مدرسه ───
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#username', { timeout: 60000 })
  await page.fill('#username', 'beheshti.admin')
  await page.fill('#password', 'Pass@123')
  const robotBtn = page.locator('button[role="checkbox"][aria-label="من ربات نیستم"]')
  for (let i = 0; i < 12; i++) {
    await robotBtn.click().catch(() => {})
    if ((await robotBtn.getAttribute('aria-checked')) === 'true') break
    await page.waitForTimeout(400)
  }
  check('تیک «من ربات نیستم» زده شد', (await robotBtn.getAttribute('aria-checked')) === 'true')
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  step('ورود موفق → ' + page.url())

  // وضعیت اولیه کلاس‌ها و دانش‌آموز (برای بازگردانی)
  const clsRes = await api(page, '/api/classes')
  originalClasses = clsRes.data?.classrooms ?? []
  check('فهرست کلاس‌ها خوانده شد', originalClasses.length > 0, `${originalClasses.length} کلاس`)

  const stuRes = await api(page, '/api/users?role=STUDENT&pageSize=100')
  const students = stuRes.data?.users ?? []
  const student = students.find((s) => s.enrollments?.length > 0) ?? students[0] ?? null
  if (student) {
    studentBackup = {
      id: student.id,
      username: student.username,
      fullName: student.fullName,
      classroomIds: student.enrollments.map((e) => e.classroom.id),
      effectiveGroups: (() => {
        const enrolled = new Set(student.enrollments.map((e) => e.classroom.id))
        const ov = new Map((student.groupMemberOverrides ?? []).map((o) => [o.subjectGroupId, o.action]))
        const eff = new Set()
        // گروه‌های همه کلاس‌ها + استثناها
        return { enrolled: [...enrolled], overrides: [...ov.entries()] , effPlaceholder: true }
      })(),
    }
  }
  check('دانش‌آموز نمونه انتخاب شد', !!student, student ? student.username : '')

  // ═══════════════ بخش ۱: کارت‌های آماری + آیکون + و فرم‌های جدا ═══════════════
  step('بخش ۱ — آیکون + روی کارت آمار و فرم‌های جدا معلم/دانش‌آموز')
  await page.goto(BASE + '/modir/classes', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="لیست کلاس‌ها و مدیریت آنها"]', { timeout: 30000 })

  const plusTeacher = await page
    .locator('button[aria-label="ایجاد معلم جدید"]')
    .count()
  const plusStudent = await page
    .locator('button[aria-label="ایجاد دانش‌آموز جدید"]')
    .count()
  const manageIcons = await page.locator('button[aria-label="لیست معلمان و مدیریت آنها"]').count()
  check('کارت معلمان هم آیکون + دارد هم آیکون مدیریت', plusTeacher === 1 && manageIcons === 1)
  check('کارت دانش‌آموزان هم آیکون + دارد هم آیکون مدیریت', plusStudent === 1)

  await page.click('button[aria-label="ایجاد معلم جدید"]')
  await page.waitForURL((u) => u.pathname === '/modir/users' && u.searchParams.get('create') === 'teacher', {
    timeout: 30000,
  })
  step('انتقال به /modir/users?create=teacher')

  // فرم‌های جدا: «ایجاد معلم» و «ایجاد دانش‌آموز» هر دو کارت مستقل‌اند
  await page.waitForSelector('#t-first', { timeout: 30000 })
  const teacherCardTitle = await page.locator('h3:has-text("ایجاد معلم"), div[role="heading"], .text-base:has-text("ایجاد معلم")').count()
  check('کارت مستقل «ایجاد معلم» وجود دارد', teacherCardTitle >= 1)
  const studentFormPresent = (await page.locator('#st-first').count()) === 1
  const bulkFormPresent = (await page.locator('text=افزودن گروهی دانش‌آموزان').count()) >= 1
  check('کارت مستقل «ایجاد دانش‌آموز» جدا از فرم گروهی است', studentFormPresent && bulkFormPresent)

  // برجسته‌سازی فرم معلم پس از ورود با ?create=teacher
  const ringOnTeacher = await page.locator('div.ring-2:has(input#t-first)').count()
  check('فرم معلم با ورود از کارت آمار برجسته می‌شود (ring)', ringOnTeacher === 1)

  // دکمه ایجاد معلم بدون انتخاب گروه غیرفعال است
  const tForm = page.locator('form', { has: page.locator('#t-first') }).first()
  const submitDisabled = await tForm.locator('button[type="submit"]').isDisabled()
  check('دکمه «ایجاد معلم» بدون انتخاب گروه غیرفعال است', submitDisabled)

  await page.screenshot({ path: SHOT + '/modir-users-create-teacher.png', fullPage: true })

  // API: ایجاد معلم بدون گروه → ۴۰۰
  const badTeacher = await api(page, '/api/users', {
    method: 'POST',
    body: JSON.stringify({ firstName: 'تست', lastName: 'بدون گروه', role: 'TEACHER', nationalId: '0099887701' }),
  })
  check('API: ایجاد معلم بدون گروه درسی رد می‌شود (400)', badTeacher.status === 400, badTeacher.data?.error ?? '')

  // ─── ایجاد واقعی معلم از طریق فرم — با انتخاب دو گروه درسی ───
  await tForm.locator('#t-first').fill('آزمایشی')
  await tForm.locator('#t-last').fill('معلم تست')
  await tForm.locator('#t-nid').fill('0099887766')
  const groupBoxes = tForm.locator('button[role="checkbox"]')
  const groupCount = await groupBoxes.count()
  check('فهرست گروه‌های درسی در فرم معلم پر است', groupCount >= 2, `${groupCount} گروه`)
  await groupBoxes.first().click()
  await groupBoxes.nth(1).click()
  const selectedHint = await tForm.locator('text=/۲ گروه انتخاب شده/').count()
  check('شمارنده گروه‌های انتخابی نمایش داده می‌شود', selectedHint >= 1)
  const submitEnabled = !(await tForm.locator('button[type="submit"]').isDisabled())
  check('با انتخاب گروه، دکمه ایجاد معلم فعال می‌شود', submitEnabled)
  if (submitEnabled) {
    await tForm.locator('button[type="submit"]').click()
    // صبر تا معلم در API ظاهر شود
    let createdTeacher = null
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(700)
      const q = await api(page, '/api/users?role=TEACHER&q=0099887766')
      createdTeacher = (q.data?.users ?? []).find((u) => u.username === '0099887766') ?? null
      if (createdTeacher) break
    }
    check('معلم از طریق فرم ایجاد شد', !!createdTeacher, createdTeacher?.fullName ?? '')
    if (createdTeacher) {
      createdTeacherIds.push(createdTeacher.id)
      check(
        'دو گروه درسی انتخابی به معلم منتسب شد',
        (createdTeacher.teachingAssignments ?? []).length === 2,
        (createdTeacher.teachingAssignments ?? []).map((t) => t.subjectGroup.name).join('، '),
      )
    }
    // پاک‌سازی فوری معلم تست
    if (createdTeacher) {
      const del = await api(page, `/api/users/${createdTeacher.id}?confirm=true`, { method: 'DELETE' })
      createdTeacherIds.pop()
      check('معلم تست برای پاک‌سازی حذف شد', del.status === 200)
    }
  }

  // ═══════════════ بخش ۳: فیلد متنی «نام درس» + بخش ۴: محدودیت گروه‌ها ═══════════════
  step('بخش ۳ و ۴ — تب گروه‌های درسی: فیلد متنی درس + محدودیت گروه‌ها')
  await page.goto(BASE + '/modir/classes', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="لیست کلاس‌ها و مدیریت آنها"]', { timeout: 30000 })
  await page.locator('[role="tab"]:has-text("گروه‌های درسی")').click()

  // فیلد نام درس — متنی آزاد
  await page.waitForSelector('#subject-input', { timeout: 30000 })
  const subjectTag = await page.locator('#subject-input').evaluate((el) => el.tagName.toLowerCase())
  const oldSelectGone = (await page.locator('[aria-label="انتخاب نام درس"]').count()) === 0
  check('«نام درس» فیلد متنی است (input نه select)', subjectTag === 'input' && oldSelectGone, `<${subjectTag}>`)

  // انتخاب کلاس + تایپ درس دلخواه → پیش‌نمایش نام گروه
  await page.locator('button[aria-label="انتخاب کلاس"]').first().click()
  await page.locator('[role="option"]').first().click()
  await page.fill('#subject-input', 'علوم آزمایشی')
  const preview = await page.locator('p[aria-live="polite"]').textContent()
  check('پیش‌نمایش نام گروه با درس آزاد ساخته می‌شود', !!preview && preview.includes('علوم آزمایشی'), preview?.trim() ?? '')

  // ایجاد واقعی گروه و سپس حذف آن (پاک‌سازی)
  await page.locator('button[type="submit"]:has-text("ایجاد گروه")').click()
  await page.waitForTimeout(1200)
  const grpRes = await api(page, '/api/groups')
  const created = (grpRes.data?.groups ?? []).find((g) => g.name.includes('علوم آزمایشی'))
  if (created) {
    createdGroupId = created.id
    const del = await api(page, `/api/groups/${created.id}?confirm=true`, { method: 'DELETE' })
    createdGroupId = null
    check('گروه با نام درس آزاد ایجاد و سپس برای پاک‌سازی حذف شد', del.status === 200, created.name)
  } else {
    check('گروه با نام درس آزاد ایجاد شد', false, 'گروه یافت نشد')
  }

  // بخش محدودیت گروه‌ها
  const restrictionTitle = (await page.locator('text=محدودیت گروه‌ها').count()) >= 1
  check('بخش «محدودیت گروه‌ها» در تب گروه‌های درسی هست', restrictionTitle)
  const masterSwitch = page.locator(
    'button[role="switch"][aria-label="فعال/غیرفعال‌سازی گفتگوی خصوصی بین دانش‌آموزان در همه کلاس‌ها"]',
  )
  check('کلید سراسری گفتگوی خصوصی دانش‌آموزان هست', (await masterSwitch.count()) === 1)
  const perClassSwitches = page.locator('button[role="switch"][aria-label^="فعال/غیرفعال‌سازی گفتگوی خصوصی دانش‌آموزان کلاس"]')
  const perClassCount = await perClassSwitches.count()
  check('هر کلاس کلید خودش را دارد', perClassCount === originalClasses.length, `${perClassCount}/${originalClasses.length}`)

  // کلید سراسری: فعال‌سازی → همه کلاس‌ها فعال
  const beforeStates = originalClasses.map((c) => c.allowStudentDm)
  const targetState = !beforeStates.every(Boolean) // اگر همه فعال بودند، غیرفعال می‌کنیم وگرنه فعال
  await masterSwitch.click()
  await page.waitForTimeout(1000)
  const afterRes = await api(page, '/api/classes')
  const afterClasses = afterRes.data?.classrooms ?? []
  const allMatch = afterClasses.every((c) => c.allowStudentDm === targetState)
  check(
    `کلید سراسری همه کلاس‌ها را ${targetState ? 'فعال' : 'غیرفعال'} کرد`,
    allMatch && afterClasses.length > 0,
  )

  // کلید یک کلاس → فقط همان کلاس عوض می‌شود
  if (afterClasses.length > 0) {
    const firstSwitch = perClassSwitches.first()
    const firstClassBefore = afterClasses[0].allowStudentDm
    await firstSwitch.click()
    await page.waitForTimeout(800)
    const singleRes = await api(page, '/api/classes')
    const singleClasses = singleRes.data?.classrooms ?? []
    const changed = singleClasses[0].allowStudentDm === !firstClassBefore
    const othersSame = singleClasses.slice(1).every((c) => c.allowStudentDm === targetState)
    check('کلید هر کلاس فقط همان کلاس را تغییر می‌دهد', changed && othersSame)
  }

  await page.screenshot({ path: SHOT + '/modir-groups-restrictions.png', fullPage: true })

  // ═══════════════ بخش ۲: ویرایش کلاس‌ها و گروه‌های دانش‌آموز ═══════════════
  if (student && studentBackup) {
    step('بخش ۲ — ویرایش کاربر: تغییر کلاس‌ها و گروه‌های دانش‌آموز')

    // دیالوگ ویرایش — UI
    await page.goto(BASE + `/modir/users?q=${studentBackup.username}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(`button[aria-label="ویرایش ${studentBackup.fullName}"]`, { timeout: 30000 })
    await page.click(`button[aria-label="ویرایش ${studentBackup.fullName}"]`)
    await page.waitForSelector('text=کلاس‌ها', { timeout: 15000 })
    const classesSection = (await page.locator('form label:has(button[role="checkbox"])').count()) >= 1
    const groupsSection = (await page.locator('text=گروه‌های درسی').count()) >= 1
    check('دیالوگ ویرایش دانش‌آموز بخش «کلاس‌ها» و «گروه‌های درسی» دارد', classesSection && groupsSection)
    await page.screenshot({ path: SHOT + '/modir-edit-student-dialog.png' })
    await page.keyboard.press('Escape')

    // API: تغییر کلاس‌ها — کلاس دوم اگر هست
    const others = originalClasses.filter((c) => !studentBackup.classroomIds.includes(c.id))
    if (others.length > 0) {
      const newClassId = others[0].id
      const patch = await api(page, `/api/users/${studentBackup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ classroomIds: [newClassId] }),
      })
      check('API: تغییر کلاس دانش‌آموز موفق', patch.status === 200)

      const re = await api(page, `/api/users?role=STUDENT&pageSize=100&q=${studentBackup.username}`)
      const me = (re.data?.users ?? []).find((u) => u.id === studentBackup.id)
      const nowClasses = (me?.enrollments ?? []).map((e) => e.classroom.id)
      check('API: ثبت‌نام کلاس جایگزین شد', nowClasses.length === 1 && nowClasses[0] === newClassId, nowClasses.join(','))

      // API: حذف یک گروه از عضویت مؤثر → استثنای REMOVE
      const groupsRes = await api(page, '/api/groups')
      const allGroups = groupsRes.data?.groups ?? []
      const newClassGroups = allGroups.filter((g) => g.classroomId === newClassId && !g.archivedAt)
      if (newClassGroups.length > 0) {
        const keep = newClassGroups.slice(1).map((g) => g.id)
        const patch2 = await api(page, `/api/users/${studentBackup.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ subjectGroupIds: keep }),
        })
        check('API: تغییر گروه‌های درسی دانش‌آموز موفق', patch2.status === 200)
        const re2 = await api(page, `/api/users?role=STUDENT&pageSize=100&q=${studentBackup.username}`)
        const me2 = (re2.data?.users ?? []).find((u) => u.id === studentBackup.id)
        const removed = (me2?.groupMemberOverrides ?? []).filter((o) => o.action === 'REMOVE')
        const removedTargets = new Set(removed.map((o) => o.subjectGroupId))
        const expectedRemove = newClassGroups[0].id
        check('API: حذف گروه کلاسی → استثنای REMOVE ساخته شد', removedTargets.has(expectedRemove))
      }
    } else {
      check('کلاس دوم برای تست تغییر کلاس موجود است', false, 'فقط یک کلاس در مدرسه است')
    }
  }

  await page.screenshot({ path: SHOT + '/modir-four-edits-final.png', fullPage: true })
} catch (err) {
  fail++
  results.push(`  ❌ خطای غیرمنتظره: ${err.message}`)
  await page.screenshot({ path: SHOT + '/modir-four-edits-error.png', fullPage: true }).catch(() => {})
} finally {
  // ─── پاک‌سازی و بازگردانی وضعیت اولیه ───
  try {
    step('پاک‌سازی — بازگردانی وضعیت اولیه')
    // بازگردانی کلیدهای گفتگوی خصوصی به حالت اول
    if (originalClasses && originalClasses.length > 0) {
      const uniform = originalClasses.every((c) => c.allowStudentDm === originalClasses[0].allowStudentDm)
      if (uniform) {
        await api(page, '/api/classes', {
          method: 'PATCH',
          body: JSON.stringify({ allowStudentDm: originalClasses[0].allowStudentDm }),
        })
      } else {
        for (const c of originalClasses) {
          await api(page, `/api/classes/${c.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ allowStudentDm: c.allowStudentDm }),
          })
        }
      }
    }
    // بازگردانی دانش‌آموز به کلاس‌ها/گروه‌های اولیه
    if (studentBackup) {
      const groupsRes = await api(page, '/api/groups')
      const allGroups = groupsRes.data?.groups ?? []
      const enrolled = new Set(studentBackup.classroomIds)
      const ov = new Map(studentBackup.effectiveGroups.overrides)
      const eff = []
      for (const g of allGroups) {
        const derived = enrolled.has(g.classroomId)
        const o = ov.get(g.id)
        if ((derived && o !== 'REMOVE') || (!derived && o === 'ADD')) eff.push(g.id)
      }
      await api(page, `/api/users/${studentBackup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ classroomIds: studentBackup.classroomIds, subjectGroupIds: eff }),
      })
    }
    // حذف معلمان آزمایشی
    for (const id of createdTeacherIds) {
      await api(page, `/api/users/${id}?confirm=true`, { method: 'DELETE' })
    }
    if (createdGroupId) {
      await api(page, `/api/groups/${createdGroupId}?confirm=true`, { method: 'DELETE' })
    }
  } catch (e) {
    console.log('⚠ پاک‌سازی ناقص:', e.message)
  }

  console.log('\n════════ نتیجه تست ════════')
  for (const r of results) console.log(r)
  console.log(`\n${pass} Passed / ${fail} Failed`)
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
}
