/**
 * تست مستقیم ابزارهای تقویم دستیار دانیار — اجرا با bun.
 * ایجاد/فهرست/آمار/ویرایش/حذف رویداد + جداسازی مدرسه + اعتبارسنجی تاریخ جلالی.
 * args: schoolId classId otherSchoolClassId adminUserId
 */
import { executeAiTool } from '../src/lib/ai/tools'
import { db } from '../src/lib/db'

let ok = 0
let bad = 0
const pass = (m: string) => { ok++; console.log('  ✅', m) }
const fail = (m: string) => { bad++; console.log('  ❌', m) }
const j = (r: { result: string }) => JSON.parse(r.result)

async function main() {
  const [, , schoolId, classId, otherClassId, adminUserId] = process.argv
  if (!schoolId || !classId || !adminUserId) {
    console.error('usage: bun scripts/test-ai-calendar-tools.ts <schoolId> <classId> <otherSchoolClassId> <adminUserId>')
    process.exit(1)
  }
  const ctx = { schoolId, userId: adminUserId }
  let createdIds: string[] = []

  try {
    // ── ۱) ایجاد رویداد امتحان برای کلاس ──
    const r1 = await executeAiTool('create_calendar_event', JSON.stringify({ type: 'EXAM', date: '1404-08-10', description: 'امتحان میان‌ترم ریاضی', classId }), ctx)
    const e1 = j(r1)
    if (!e1.error && e1.ok && e1.event.typeLabel === 'امتحان' && e1.event.dateKey === '1404-08-10' && e1.event.class === (await db.classroom.findUnique({ where: { id: classId } }))?.name) {
      pass('create امتحان کلاسی ثبت شد (' + e1.event.dateFa + ')')
      createdIds.push(e1.event.id)
    } else fail('create امتحان: ' + r1.result.slice(0, 150))
    if (r1.refs.some((r) => r.kind === 'event') && r1.refs.some((r) => r.kind === 'class')) pass('refs رویداد + کلاس برگشت')
    else fail('refs ناقص در create')

    // ── ۲) تاریخ با ارقام فارسی و جداکننده اسلش نرمال‌سازی می‌شود ──
    const r2 = await executeAiTool('create_calendar_event', JSON.stringify({ type: 'PARTY', date: '۱۴۰۴/۰۸/۰۵', classId }), ctx)
    const e2 = j(r2)
    if (!e2.error && e2.event.dateKey === '1404-08-05') { pass('تاریخ فارسی‌رقمی با اسلش نرمال‌سازی شد (۱۴۰۴/۰۸/۰۵ → 1404-08-05)'); createdIds.push(e2.event.id) }
    else fail('نرمال‌سازی ارقام فارسی: ' + r2.result.slice(0, 120))

    // ── ۳) رویداد کل‌مدرسه (بدون classId) ──
    const r3 = await executeAiTool('create_calendar_event', JSON.stringify({ type: 'HOLIDAY', date: '1404-08-15', description: 'به مناسبت روز دانش‌آموز' }), ctx)
    const e3 = j(r3)
    if (!e3.error && e3.ok && e3.event.schoolWide === true) { pass('رویداد تعطیل کل‌مدرسه ثبت شد'); createdIds.push(e3.event.id) }
    else fail('رویداد کل‌مدرسه: ' + r3.result.slice(0, 120))

    // ── ۴) خطاها: نوع نامعتبر / تاریخ نامعتبر / CUSTOM بدون نام / نام برای غیرسفارشی ──
    const r4a = await executeAiTool('create_calendar_event', JSON.stringify({ type: 'MAGIC', date: '1404-08-10' }), ctx)
    if (j(r4a).error) pass('نوع نامعتبر رد شد')
    else fail('نوع نامعتبر پذیرفته شد!')
    const r4b = await executeAiTool('create_calendar_event', JSON.stringify({ type: 'EXAM', date: '1404-13-40' }), ctx)
    if (j(r4b).error) pass('تاریخ جلالی نامعتبر رد شد')
    else fail('تاریخ نامعتبر پذیرفته شد!')
    const r4c = await executeAiTool('create_calendar_event', JSON.stringify({ type: 'CUSTOM', date: '1404-08-20' }), ctx)
    if (j(r4c).error) pass('CUSTOM بدون نام رد شد')
    else fail('CUSTOM بدون نام پذیرفته شد!')
    const r4d = await executeAiTool('create_calendar_event', JSON.stringify({ type: 'EXAM', date: '1404-08-20', title: 'امتحان ریاضی' }), ctx)
    if (j(r4d).error) pass('title برای نوع غیرسفارشی رد شد')
    else fail('title برای نوع غیرسفارشی پذیرفته شد!')

    // ── ۵) جداسازی مدرسه: کلاس مدرسه دیگر رد می‌شود ──
    const r5 = await executeAiTool('create_calendar_event', JSON.stringify({ type: 'EXAM', date: '1404-08-10', classId: otherClassId }), ctx)
    if (j(r5).error) pass('کلاس مدرسه دیگر برای create رد شد')
    else fail('نشت بین‌مدرسه‌ای در create!')
    const r5b = await executeAiTool('calendar_stats', JSON.stringify({ classId: otherClassId }), ctx)
    if (j(r5b).error) pass('کلاس مدرسه دیگر برای stats رد شد')
    else fail('نشت بین‌مدرسه‌ای در stats!')

    // ── ۶) فهرست رویدادها: شامل کل‌مدرسه + فیلتر نوع ──
    const r6 = await executeAiTool('list_calendar_events', JSON.stringify({ classId, from: '1404-08-01', to: '1404-08-29' }), ctx)
    const l6 = j(r6)
    const classList = l6.events ?? []
    if (!l6.error && classList.some((e: { schoolWide: boolean }) => e.schoolWide) && classList.some((e: { type: string }) => e.type === 'EXAM')) {
      pass('فهرست کلاس شامل رویداد کل‌مدرسه و کلاسی است (' + l6.count + ' رویداد)')
    } else fail('فهرست ناقص: ' + r6.result.slice(0, 200))
    const r6b = await executeAiTool('list_calendar_events', JSON.stringify({ type: 'HOLIDAY' }), ctx)
    const l6b = j(r6b)
    if (!l6b.error && (l6b.events ?? []).every((e: { type: string }) => e.type === 'HOLIDAY')) pass('فیلتر نوع HOLIDAY دقیق است')
    else fail('فیلتر نوع خراب است')
    const r6c = await executeAiTool('list_calendar_events', JSON.stringify({ month: '1404-08' }), ctx)
    const l6c = j(r6c)
    if (!l6c.error && (l6c.events ?? []).every((e: { dateKey: string }) => e.dateKey.startsWith('1404-08'))) pass('فیلتر ماه ۱۴۰۴-۰۸ دقیق است')
    else fail('فیلتر ماه خراب است')
    const r6d = await executeAiTool('list_calendar_events', JSON.stringify({ month: '13-99' }), ctx)
    if (j(r6d).error) pass('ماه نامعتبر رد شد')
    else fail('ماه نامعتبر پذیرفته شد!')

    // ── ۷) آمار: اعداد دقیق ──
    const r7 = await executeAiTool('calendar_stats', '{}', ctx)
    const s7 = j(r7)
    const dbCount = await db.classEvent.count({ where: { schoolId } })
    if (!s7.error && s7.total === dbCount) pass(`آمار کل با دیتابیس مطابق است (${s7.total})`)
    else fail(`آمار کل ناسازگار: ابزار=${s7.total} دیتابیس=${dbCount}`)
    if (s7.byType?.EXAM?.count >= 1 && s7.byType?.HOLIDAY?.count >= 1 && s7.byType?.PARTY?.count >= 1) pass('تفکیک نوع درست است')
    else fail('تفکیک نوع ناقص: ' + JSON.stringify(s7.byType).slice(0, 150))
    if (s7.schoolWideEvents >= 1 && (s7.perClass ?? []).some((c: { id: string }) => c.id === classId)) pass('تفکیک کل‌مدرسه/کلاس درست است')
    else fail('تفکیک کلاس ناقص')
    if (typeof s7.todayFa === 'string' && s7.todayFa.length > 3) pass('امروز جلالی در آمار هست (' + s7.todayFa + ')')
    else fail('امروز جلالی غایب است')
    const r7b = await executeAiTool('calendar_stats', JSON.stringify({ classId }), ctx)
    const s7b = j(r7b)
    if (!s7b.error && s7b.total <= s7.total) pass('آمار کلاس منطقی است (' + s7b.total + ' ≤ ' + s7.total + ')')
    else fail('آمار کلاس بزرگ‌تر از کل شد!')

    // ── ۸) ویرایش: تغییر تاریخ و توضیحات ──
    const r8 = await executeAiTool('update_calendar_event', JSON.stringify({ eventId: e1.event.id, date: '۱۴۰۴-۰۸-۱۲', description: 'امتحان میان‌ترم فصل ۱ تا ۳' }), ctx)
    const u8 = j(r8)
    if (!u8.error && u8.event.dateKey === '1404-08-12') pass('ویرایش تاریخ (با ارقام فارسی) انجام شد')
    else fail('ویرایش تاریخ: ' + r8.result.slice(0, 150))
    const dbEv = await db.classEvent.findUnique({ where: { id: e1.event.id } })
    if (dbEv?.dateKey === '1404-08-12' && dbEv.description.includes('فصل ۱ تا ۳')) pass('تغییرات در دیتابیس ثبت شد')
    else fail('دیتابیس همگام نشده')

    // ── ۹) ویرایش دامنه به کل مدرسه ──
    const r9 = await executeAiTool('update_calendar_event', JSON.stringify({ eventId: e2?.event?.id, schoolWide: true }), ctx)
    const u9 = j(r9)
    if (!u9.error && u9.event.schoolWide === true) pass('تغییر دامنه به کل مدرسه انجام شد')
    else fail('تغییر دامنه: ' + r9.result.slice(0, 150))

    // ── ۱۰) رویداد متصل به تکلیف: تغییر نوع ممنوع، حذف با نکته ──
    const classroom = await db.classroom.findUnique({ where: { id: classId }, select: { subjectGroups: { take: 1, select: { id: true } } } })
    const groupId = classroom?.subjectGroups[0]?.id
    if (groupId) {
      const assignment = await db.assignment.create({
        data: { subjectGroupId: groupId, title: 'تکلیف آزمون ابزار تقویم', createdById: adminUserId },
        select: { id: true },
      })
      const linked = await db.classEvent.create({
        data: { schoolId, classroomId: classId, dateKey: '1404-09-01', type: 'HOMEWORK', createdById: adminUserId, assignmentId: assignment.id },
        select: { id: true },
      })
      createdIds.push(linked.id)
      const r10 = await executeAiTool('update_calendar_event', JSON.stringify({ eventId: linked.id, type: 'PARTY' }), ctx)
      if (j(r10).error) pass('تغییر نوع رویداد متصل به تکلیف رد شد')
      else fail('تغییر نوع رویداد متصل به تکلیف پذیرفته شد!')
      const r10b = await executeAiTool('delete_calendar_event', JSON.stringify({ eventId: linked.id }), ctx)
      const d10 = j(r10b)
      if (!d10.error && Array.isArray(d10.notes) && d10.notes.some((n: string) => n.includes('تکلیف'))) {
        pass('حذف رویداد متصل به تکلیف با نکته حفظ تکلیف')
        createdIds = createdIds.filter((x) => x !== linked.id)
      } else fail('حذف رویداد متصل: ' + r10b.result.slice(0, 150))
      const stillThere = await db.assignment.findUnique({ where: { id: assignment.id }, select: { id: true } })
      if (stillThere) { pass('تکلیف درسی پس از حذف رویداد باقی ماند'); await db.assignment.delete({ where: { id: assignment.id } }) }
      else fail('تکلیف درسی اشتباهی حذف شد!')
    } else fail('گروه درسی برای آزمون رویداد متصل یافت نشد')

    // ── ۱۱) رویداد مدرسه دیگر برای update/delete نامرئی است ──
    const other = await db.classEvent.findFirst({ where: { schoolId: { not: schoolId } }, select: { id: true } })
    if (other) {
      const r11 = await executeAiTool('update_calendar_event', JSON.stringify({ eventId: other.id, date: '1404-08-01' }), ctx)
      const r11b = await executeAiTool('delete_calendar_event', JSON.stringify({ eventId: other.id }), ctx)
      if (j(r11).error && j(r11b).error) pass('رویداد مدرسه دیگر برای ویرایش/حذف نامرئی است')
      else fail('نشت بین‌مدرسه‌ای در update/delete!')
    } else pass('(رویداد مدرسه دیگری در دیتابیس نیست — آزمون جداسازی update/delete رد شد)')

    // ── ۱۲) حذف رویدادها + حذف تکراری خطا ──
    for (const id of createdIds) {
      const r12 = await executeAiTool('delete_calendar_event', JSON.stringify({ eventId: id }), ctx)
      if (j(r12).error) fail('حذف رویداد ' + id + ' شکست خورد')
    }
    if (createdIds.length) pass('همه رویدادهای آزمون حذف شدند (' + createdIds.length + ')')
    const r12b = await executeAiTool('delete_calendar_event', JSON.stringify({ eventId: createdIds[0] ?? 'c-nonexistent' }), ctx)
    if (j(r12b).error) pass('حذف رویداد ناموجود رد شد')
    else fail('حذف تکراری پذیرفته شد!')
    const remaining = await db.classEvent.count({ where: { schoolId, createdById: adminUserId, type: { in: ['EXAM', 'PARTY', 'HOLIDAY'] } } })
    if (remaining === 0) pass('پاک‌سازی کامل — هیچ رویداد آزمونی باقی نماند')
    else fail(remaining + ' رویداد آزمونی باقی ماند')

  } finally {
    // ایمنی نهایی: پاک‌سازی هر رویداد باقی‌مانده آزمون
    await db.classEvent.deleteMany({ where: { schoolId, description: { contains: 'میان‌ترم' }, type: { in: ['EXAM'] } } }).catch(() => {})
  }

  console.log(`\nنتیجه: ${ok} پاس / ${bad} شکست`)
  process.exit(bad > 0 ? 1 : 0)
}

main().catch((e) => { console.error('CRASH:', e); process.exit(1) })
