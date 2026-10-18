/**
 * دادهٔ پایهٔ دانیار — منبع واحد برای هم اسکریپت CLI و هم bootstrap خودترمیم:
 * ۱) ensureSuperadmin: حساب مدیر کل با رمز اولیهٔ env (حساب موجود هرگز تغییر نمی‌کند)
 * ۲) seedDemoData: مجموعهٔ دموی دو مدرسه (بهشتی + فرزانگان) با کاربران Pass@123
 * هر دو تابع idempotent هستند و در محیط واقعی هم بی‌خطر.
 */
import type { PrismaClient } from '@prisma/client'
import { hashPassword } from './password'

export const DEMO_USER_PASSWORD = 'Pass@123'

/** انواع تخلف پیش‌فرض (درخواست کاربر) — فهرست کشویی ثبت تخلف؛ اولین مورد مثال کاربر است */
export const DEFAULT_VIOLATION_TYPES = [
  'انجام ندادن تکلیف',
  'بی‌ادبی با معلم',
  'تأخیر در ورود به کلاس',
  'استفاده از تلفن همراه',
  'بی‌نظمی در کلاس',
  'عدم رعایت پوشش مناسب',
]

/** اگر هیچ نوع تخلفی تعریف نشده باشد، فهرست پیش‌فرض را می‌سازد (idempotent) */
export async function ensureViolationTypes(db: PrismaClient): Promise<boolean> {
  const count = await db.violationType.count()
  if (count > 0) return false
  await db.violationType.createMany({
    data: DEFAULT_VIOLATION_TYPES.map((label, i) => ({
      label,
      sortOrder: i,
    })),
  })
  return true
}

/**
 * رمز اولیهٔ مدیر کل: اول از env مالک سرور؛ در نبودش مقدار مستندشده.
 * هدف: رمز اعلامی به کاربر «هرگز» بی‌دلیل از کار نیفتد (پایداری دسترسی در سندباکس).
 */
export function initialSuperadminPassword(): string {
  const fromEnv = process.env.SUPERADMIN_INITIAL_PASSWORD?.trim()
  if (process.env.NODE_ENV === 'production' && (!fromEnv || fromEnv.length < 12)) {
    throw new Error('SUPERADMIN_INITIAL_PASSWORD باید حداقل ۱۲ کاراکتر باشد؛ رمز پیش‌فرض در production مجاز نیست.')
  }
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'Admin@1234'
}

/** اگر حساب superadmin وجود نداشته باشد می‌سازد؛ حساب موجود را دست نمی‌زند. خروجی: ساخته شد؟ */
export async function ensureSuperadmin(db: PrismaClient): Promise<boolean> {
  const existing = await db.user.findUnique({ where: { username: 'superadmin' } })
  if (existing) return false
  try {
    await db.user.create({
      data: {
        username: 'superadmin',
        passwordHash: await hashPassword(initialSuperadminPassword()),
        fullName: 'مدیر کل پلتفرم',
        role: 'SUPER_ADMIN',
      },
    })
    return true
  } catch (err) {
    // ایجاد هم‌زمان از دو مسیر (رقابت) — حساب ساخته شد، فقط نه توسط ما
    if ((err as { code?: string })?.code === 'P2002') return false
    throw err
  }
}

/**
 * پاک‌سازی دادهٔ وابسته به مدارس/کاربران دمو — ترتیب فرزند→والد تا FK در هر حالی ایمن باشد.
 * تنظیمات سراسری (SmsConfig، AiConfig، PushConfig، Platform/Infra/…Setting) و superadmin دست‌نخورده می‌مانند.
 */
async function cleanDemoData(db: PrismaClient) {
  // برگ‌ها و جدول‌های وابسته به گفتگو/هوش/پوش/نمونه‌سؤال
  await db.aiMessage.deleteMany()
  await db.aiConversation.deleteMany()
  await db.aiUsageLog.deleteMany()
  await db.aiSchoolSetting.deleteMany()
  await db.pushDelivery.deleteMany()
  await db.pushSubscription.deleteMany()
  await db.impersonationLog.deleteMany()
  await db.bulkSendLog.deleteMany()
  await db.sampleQuestionBookmark.deleteMany()
  await db.sampleQuestionFile.deleteMany()
  await db.sampleQuestionClass.deleteMany()
  await db.sampleQuestion.deleteMany()
  // تکالیف و ارسال‌ها
  await db.assignmentSubmission.deleteMany()
  await db.assignment.deleteMany()
  // حضور و غیاب + نمره + تخلف
  await db.attendanceEditLog.deleteMany()
  await db.attendanceRecord.deleteMany()
  await db.attendanceSession.deleteMany()
  await db.studentGrade.deleteMany()
  await db.studentViolation.deleteMany()
  // کلاس زنده
  await db.liveChatMessage.deleteMany()
  await db.liveParticipantLog.deleteMany()
  await db.liveSession.deleteMany()
  // درس‌ها و رویدادهای کلاسی
  await db.classEvent.deleteMany()
  await db.teacherLesson.deleteMany()
  await db.lesson.deleteMany()
  // اعلان/سکوت/مجوز معاون
  await db.notification.deleteMany()
  await db.notificationPref.deleteMany()
  await db.mutedChat.deleteMany()
  await db.vicePermission.deleteMany()
  // پیام‌رسان و ساختار آموزشی
  await db.message.deleteMany()
  await db.groupReadState.deleteMany()
  await db.groupMemberOverride.deleteMany()
  await db.classroomEnrollment.deleteMany()
  await db.teachingAssignment.deleteMany()
  await db.subjectGroup.deleteMany()
  await db.classroom.deleteMany()
  await db.upload.deleteMany()
  await db.smsSendLog.deleteMany()
  // کاربران عادی (superadmin حفظ می‌شود) و مدارس
  await db.user.deleteMany({ where: { role: { not: 'SUPER_ADMIN' } } })
  await db.school.deleteMany()
}

export interface DemoSeedSummary {
  schools: number
  classrooms: number
  groups: number
  users: number
  messages: number
}

/**
 * ساخت مجموعهٔ دمو (دو مدرسه). پیش‌فرض clean=true یعنی ابتدا پاک‌سازی؛
 * bootstrap خودترمیم فقط وقتی صدا می‌زند که مدرسه‌ای در دیتابیس نیست (یعنی دادهٔ واقعی‌ای برای از دست دادن نیست).
 */
export async function seedDemoData(
  db: PrismaClient,
  opts: { clean?: boolean } = {},
): Promise<DemoSeedSummary> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ساخت یا پاک‌سازی داده‌های دمو در production مجاز نیست.')
  }
  if (opts.clean !== false) await cleanDemoData(db)

  const hash = await hashPassword(DEMO_USER_PASSWORD)

  // ─── مدرسه ۱: دبیرستان شهید بهشتی ───
  const school1 = await db.school.create({ data: { name: 'دبیرستان شهید بهشتی' } })
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

  const class7 = await db.classroom.create({ data: { name: 'هفتم۱', schoolId: school1.id } })
  const class8 = await db.classroom.create({ data: { name: 'هشتم۱', schoolId: school1.id } })

  const gMath7 = await db.subjectGroup.create({ data: { name: 'ریاضی هفتم۱', classroomId: class7.id } })
  const gSci7 = await db.subjectGroup.create({ data: { name: 'علوم هفتم۱', classroomId: class7.id } })
  const gLit7 = await db.subjectGroup.create({ data: { name: 'ادبیات هفتم۱', classroomId: class7.id } })
  const gMath8 = await db.subjectGroup.create({ data: { name: 'ریاضی هشتم۱', classroomId: class8.id } })
  const gSci8 = await db.subjectGroup.create({ data: { name: 'علوم هشتم۱', classroomId: class8.id } })

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
  for (const gid of [gMath7.id, gSci7.id, gLit7.id]) {
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
  const school2 = await db.school.create({ data: { name: 'دبیرستان فرزانگان' } })
  await db.user.create({
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

  const class9 = await db.classroom.create({ data: { name: 'نهم۱', schoolId: school2.id } })
  const gLit9 = await db.subjectGroup.create({ data: { name: 'ادبیات نهم۱', classroomId: class9.id } })
  const gMath9 = await db.subjectGroup.create({ data: { name: 'ریاضی نهم۱', classroomId: class9.id } })

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

  return {
    schools: await db.school.count(),
    classrooms: await db.classroom.count(),
    groups: await db.subjectGroup.count(),
    users: await db.user.count(),
    messages: await db.message.count(),
  }
}
