import { PrismaClient } from '@prisma/client'

// پاک‌سازی داده‌های آزمایشی: فقط حساب مدیر کل باقی می‌ماند
const db = new PrismaClient()

async function main() {
  // پیام‌ها روی مدل یکپارچه Message (kind: GROUP | DIRECT)
  await db.message.deleteMany()
  await db.teachingAssignment.deleteMany()
  await db.classroomEnrollment.deleteMany()
  await db.subjectGroup.deleteMany()
  await db.classroom.deleteMany()
  await db.user.deleteMany({ where: { role: { not: 'SUPER_ADMIN' } } })
  await db.school.deleteMany()
  console.log('✔ همه داده‌های آزمایشی پاک شد؛ فقط مدیر کل باقی ماند')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
