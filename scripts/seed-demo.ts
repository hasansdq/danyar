/**
 * ساخت داده‌های تستی پیام‌رسان دانیار (چند مدرسه، کلاس و گروه):
 * - مدرسه ۱ (شهید بهشتی): مدیر + ۳ معلم + ۶ دانش‌آموز + ۲ کلاس + ۵ گروه + پیام و اطلاعیه نمونه
 * - مدرسه ۲ (فرزانگان): مدیر + ۱ معلم + ۲ دانش‌آموز + ۱ کلاس + ۲ گروه + پیام نمونه
 * رمز همه: Pass@123 — اجرا: bun scripts/seed-demo.ts
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

async function main() {
  const hash = await bcrypt.hash('Pass@123', 12)

  // پاک‌سازی داده قبلی (حفظ superadmin)
  await db.message.deleteMany()
  await db.groupReadState.deleteMany()
  await db.groupMemberOverride.deleteMany()
  await db.upload.deleteMany()
  await db.teachingAssignment.deleteMany()
  await db.classroomEnrollment.deleteMany()
  await db.subjectGroup.deleteMany()
  await db.classroom.deleteMany()
  await db.user.deleteMany({ where: { role: { not: 'SUPER_ADMIN' } } })
  await db.school.deleteMany()

  // ─── مدرسه ۱: دبیرستان شهید بهشتی ───
  const school1 = await db.school.create({
    data: { name: 'دبیرستان شهید بهشتی' },
  })
  const admin1 = await db.user.create({
    data: {
      username: 'beheshti.admin',
      passwordHash: hash,
      fullName: 'محمد کریمی',
      role: 'SCHOOL_ADMIN',
      schoolId: school1.id,
    },
  })

  const t1 = await db.user.create({
    data: { username: 'beheshti.t1', passwordHash: hash, fullName: 'رضا موسوی', role: 'TEACHER', schoolId: school1.id },
  })
  const t2 = await db.user.create({
    data: { username: 'beheshti.t2', passwordHash: hash, fullName: 'سارا مرادی', role: 'TEACHER', schoolId: school1.id },
  })
  const t3 = await db.user.create({
    data: { username: 'beheshti.t3', passwordHash: hash, fullName: 'حسین کریم‌زاده', role: 'TEACHER', schoolId: school1.id },
  })

  const class7 = await db.classroom.create({
    data: { name: 'هفتم۱', schoolId: school1.id },
  })
  const class8 = await db.classroom.create({
    data: { name: 'هشتم۱', schoolId: school1.id },
  })

  const gMath7 = await db.subjectGroup.create({
    data: { name: 'ریاضی هفتم۱', classroomId: class7.id },
  })
  const gSci7 = await db.subjectGroup.create({
    data: { name: 'علوم هفتم۱', classroomId: class7.id },
  })
  const gLit7 = await db.subjectGroup.create({
    data: { name: 'ادبیات هفتم۱', classroomId: class7.id },
  })
  const gMath8 = await db.subjectGroup.create({
    data: { name: 'ریاضی هشتم۱', classroomId: class8.id },
  })
  const gSci8 = await db.subjectGroup.create({
    data: { name: 'علوم هشتم۱', classroomId: class8.id },
  })

  await db.teachingAssignment.createMany({
    data: [
      { teacherId: t1.id, subjectGroupId: gMath7.id },
      { teacherId: t1.id, subjectGroupId: gMath8.id },
      { teacherId: t2.id, subjectGroupId: gSci7.id },
      { teacherId: t2.id, subjectGroupId: gSci8.id },
      { teacherId: t3.id, subjectGroupId: gLit7.id },
    ],
  })

  const s1 = await db.user.create({
    data: { username: 'beheshti.s1', passwordHash: hash, fullName: 'رضا احمدی', role: 'STUDENT', schoolId: school1.id },
  })
  const s2 = await db.user.create({
    data: { username: 'beheshti.s2', passwordHash: hash, fullName: 'مینا نظری', role: 'STUDENT', schoolId: school1.id },
  })
  const s3 = await db.user.create({
    data: { username: 'beheshti.s3', passwordHash: hash, fullName: 'سینا جعفری', role: 'STUDENT', schoolId: school1.id },
  })
  const s4 = await db.user.create({
    data: { username: 'beheshti.s4', passwordHash: hash, fullName: 'هانیه احدی', role: 'STUDENT', schoolId: school1.id },
  })
  const s5 = await db.user.create({
    data: { username: 'beheshti.s5', passwordHash: hash, fullName: 'امید صابری', role: 'STUDENT', schoolId: school1.id },
  })
  const s6 = await db.user.create({
    data: { username: 'beheshti.s6', passwordHash: hash, fullName: 'نیلوفر رئیسی', role: 'STUDENT', schoolId: school1.id },
  })

  await db.classroomEnrollment.createMany({
    data: [
      { studentId: s1.id, classroomId: class7.id },
      { studentId: s2.id, classroomId: class7.id },
      { studentId: s3.id, classroomId: class7.id },
      { studentId: s4.id, classroomId: class7.id },
      { studentId: s5.id, classroomId: class8.id },
      { studentId: s6.id, classroomId: class8.id },
    ],
  })

  // پیام‌های نمونه گروه ریاضی هفتم۱
  const base = Date.now() - 1000 * 60 * 60 * 3
  await db.message.createMany({
    data: [
      {
        kind: 'GROUP',
        subjectGroupId: gMath7.id,
        senderId: t1.id,
        type: 'TEXT',
        body: 'سلام بچه‌ها، تمرین‌های فصل کسرها را تا فردا حل کنید.',
        createdAt: new Date(base),
      },
      {
        kind: 'GROUP',
        subjectGroupId: gMath7.id,
        senderId: s1.id,
        type: 'TEXT',
        body: 'سلام استاد، تمرین ۴ سؤال داشت؛ امکان توضیحش هست؟',
        createdAt: new Date(base + 1000 * 60 * 12),
      },
      {
        kind: 'GROUP',
        subjectGroupId: gMath7.id,
        senderId: t1.id,
        type: 'TEXT',
        body: 'بله رضا، فردا سر کلاس توضیح می‌دهم.',
        createdAt: new Date(base + 1000 * 60 * 25),
      },
    ],
  })

  // پیام نمونه در علوم هفتم۱
  await db.message.create({
    data: {
      kind: 'GROUP',
      subjectGroupId: gSci7.id,
      senderId: s2.id,
      type: 'TEXT',
      body: 'خانم مرادی، آزمایش بعدی چه وسایلی لازم دارد؟',
      createdAt: new Date(base + 1000 * 60 * 40),
    },
  })

  // اطلاعیه مدیر مدرسه ۱ برای کلاس هفتم۱ (تحویل به گروه‌های فعال آن)
  const class7Groups = [gMath7.id, gSci7.id, gLit7.id]
  for (const gid of class7Groups) {
    await db.message.create({
      data: {
        kind: 'GROUP',
        subjectGroupId: gid,
        senderId: admin1.id,
        type: 'ANNOUNCEMENT',
        isAnnouncement: true,
        body: 'اولیای گرامی، جلسه انجمن اولیا و مربیان روز چهارشنبه ساعت ۱۰ صبح برگزار می‌شود.',
        createdAt: new Date(base + 1000 * 60 * 55),
      },
    })
  }

  // گفتگوی خصوصی نمونه: مدیر مدرسه ۱ با معلم ریاضی
  await db.message.createMany({
    data: [
      {
        kind: 'DIRECT',
        senderId: admin1.id,
        recipientId: t1.id,
        type: 'TEXT',
        body: 'آقای موسوی، گزارش پیشرفت کلاس هشتم را تا آخر هفته بفرستید.',
        createdAt: new Date(base + 1000 * 60 * 70),
      },
      {
        kind: 'DIRECT',
        senderId: t1.id,
        recipientId: admin1.id,
        type: 'TEXT',
        readAt: new Date(base + 1000 * 60 * 80),
        body: 'چشم، تا پنجشنبه ارسال می‌کنم.',
        createdAt: new Date(base + 1000 * 60 * 75),
      },
    ],
  })

  // ─── مدرسه ۲: دبیرستان فرزانگان ───
  const school2 = await db.school.create({
    data: { name: 'دبیرستان فرزانگان' },
  })
  const admin2 = await db.user.create({
    data: {
      username: 'farzanegan.admin',
      passwordHash: hash,
      fullName: 'فاطمه صادقی',
      role: 'SCHOOL_ADMIN',
      schoolId: school2.id,
    },
  })
  const t4 = await db.user.create({
    data: { username: 'farzanegan.t1', passwordHash: hash, fullName: 'مریم طباطبایی', role: 'TEACHER', schoolId: school2.id },
  })

  const class9 = await db.classroom.create({
    data: { name: 'نهم۱', schoolId: school2.id },
  })
  const gLit9 = await db.subjectGroup.create({
    data: { name: 'ادبیات نهم۱', classroomId: class9.id },
  })
  const gMath9 = await db.subjectGroup.create({
    data: { name: 'ریاضی نهم۱', classroomId: class9.id },
  })

  await db.teachingAssignment.createMany({
    data: [
      { teacherId: t4.id, subjectGroupId: gLit9.id },
      { teacherId: t4.id, subjectGroupId: gMath9.id },
    ],
  })

  const s7 = await db.user.create({
    data: { username: 'farzanegan.s1', passwordHash: hash, fullName: 'زهرا کاظمی', role: 'STUDENT', schoolId: school2.id },
  })
  const s8 = await db.user.create({
    data: { username: 'farzanegan.s2', passwordHash: hash, fullName: 'الهام حسینی', role: 'STUDENT', schoolId: school2.id },
  })

  await db.classroomEnrollment.createMany({
    data: [
      { studentId: s7.id, classroomId: class9.id },
      { studentId: s8.id, classroomId: class9.id },
    ],
  })

  await db.message.create({
    data: {
      kind: 'GROUP',
      subjectGroupId: gLit9.id,
      senderId: t4.id,
      type: 'TEXT',
      body: 'دختران عزیز، روخوانی درس «باران» برای هفته آینده تمرین شود.',
      createdAt: new Date(base + 1000 * 60 * 90),
    },
  })

  // خلاصه
  const counts = {
    schools: await db.school.count(),
    classrooms: await db.classroom.count(),
    groups: await db.subjectGroup.count(),
    users: await db.user.count(),
    messages: await db.message.count(),
  }
  console.log('✓ داده تستی ساخته شد:', counts)
  console.log('  ورود اپ: beheshti.admin | farzanegan.admin | beheshti.t1..t3 | farzanegan.t1 | beheshti.s1..s6 | farzanegan.s1..s2 — همه با Pass@123 از /login')
  console.log('  ورود مدیر کل: superadmin / Admin@1234 از /superadmin')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
