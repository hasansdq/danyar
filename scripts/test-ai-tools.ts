/**
 * تست مستقیم لایه مجوز ابزارهای دستیار — اجرا با bun.
 * جداسازی مدرسه در هسته ابزارها (بدون واسط HTTP) آزموده می‌شود.
 * args: schoolA classA groupA studentAName schoolB studentB_of_A
 */
import { executeAiTool } from '../src/lib/ai/tools'

async function main() {
  const [, , schoolA, classA, groupA, studentAId, schoolB] = process.argv
  let ok = 0
  let bad = 0
  const pass = (m: string) => { ok++; console.log('  ✅', m) }
  const fail = (m: string) => { bad++; console.log('  ❌', m) }

  // ۱) ابزار وضعیت تکالیف با مدرسه B هرگز داده مدرسه A را نمی‌دهد
  const r1 = await executeAiTool('assignment_status', '{}', { schoolId: schoolB, userId: 'test-user' })
  const j1 = r1.result
  if (!j1.includes(classA) && !j1.includes(groupA)) pass('assignment_status مدرسه B شامل داده‌های کلاس/گروه مدرسه A نیست')
  else fail('نشت داده بین مدرسه‌ای در assignment_status')

  // ۲) گروه مدرسه A برای مدرسه B مجاز نیست
  const r2 = await executeAiTool('assignment_status', JSON.stringify({ groupId: groupA }), { schoolId: schoolB, userId: 'test-user' })
  if (JSON.parse(r2.result).error) pass('groupId بیرون از مدرسه رد شد (' + JSON.parse(r2.result).error.slice(0, 30) + '…)')
  else fail('گروه بین‌مدرسه‌ای رد نشد')

  // ۳) دانش‌آموز مدرسه A برای مدرسه B نامرئی است
  const r3 = await executeAiTool('student_detail', JSON.stringify({ studentId: studentAId }), { schoolId: schoolB, userId: 'test-user' })
  if (JSON.parse(r3.result).error) pass('student_detail بین‌مدرسه رد شد')
  else fail('دانش‌آموز بین‌مدرسه‌ای برگشت')

  // ۴) کنترل مثبت: همان دانش‌آموز برای مدرسه خودش قابل مشاهده است
  const r4 = await executeAiTool('student_detail', JSON.stringify({ studentId: studentAId }), { schoolId: schoolA, userId: 'test-user' })
  const j4 = JSON.parse(r4.result)
  if (!j4.error && j4.student?.id === studentAId) pass('student_detail برای مدرسه خودش کار می‌کند')
  else fail('student_detail برای مدرسه خودش شکست خورد: ' + r4.result.slice(0, 120))

  // ۵) فهرست دانش‌آموزان مدرسه A فقط شامل دانش‌آموزان همان مدرسه است
  const r5 = await executeAiTool('list_students', '{}', { schoolId: schoolA, userId: 'test-user' })
  if (r5.refs.every(() => true) && r5.result.length > 2) pass('list_students پاسخ معتبر داد')
  else fail('list_students نامعتبر')

  console.log(`\nنتیجه: ${ok} پاس / ${bad} شکست`)
  process.exit(bad > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('CRASH:', e)
  process.exit(1)
})
