/**
 * اعتبارسنجی سمت دیتابیس کوئری‌های ابزارهای جدید دستیار:
 * teacher_detail / list_teachers / list_sample_questions — همان شکل کوئری tools.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(` ${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) fail++
}

const school = await db.school.findFirst({ select: { id: true, name: true } })

// list_teachers
const teachers = await db.user.findMany({
  where: { schoolId: school.id, role: 'TEACHER' },
  select: {
    id: true, fullName: true, username: true, isActive: true,
    teachingAssignments: { select: { subjectGroup: { select: { name: true, classroom: { select: { name: true } } } } } },
  },
  orderBy: { fullName: 'asc' },
})
check('list_teachers', teachers.length === 3, teachers.map((t) => `${t.fullName}(${t.teachingAssignments.length}گروه)`).join('، '))

// teacher_detail با واقعی‌ترین شکل
const t0 = teachers[1]
const t = await db.user.findUnique({
  where: { id: t0.id },
  select: { id: true, fullName: true, username: true, role: true, isActive: true, schoolId: true, phone: true, createdAt: true },
})
const tas = await db.teachingAssignment.findMany({
  where: { teacherId: t.id },
  select: { subjectGroup: { select: { id: true, name: true, archivedAt: true, classroom: { select: { id: true, name: true } } } } },
  orderBy: { createdAt: 'asc' },
})
const made = await db.assignment.findMany({
  where: { createdById: t.id, subjectGroup: { classroom: { schoolId: school.id } } },
  include: {
    subjectGroup: { select: { name: true, classroom: { select: { name: true } } } },
    _count: { select: { submissions: true } },
  },
  orderBy: { createdAt: 'desc' },
  take: 8,
})
const sq = await db.sampleQuestion.count({ where: { createdById: t.id, schoolId: school.id } })
check('teacher_detail — teacher', !!t && t.role === 'TEACHER', t?.fullName)
check('teacher_detail — teaching', tas.length >= 0, `${tas.length} گروه`)
check('teacher_detail — assignments', made.length >= 0, `${made.length} تکلیف`)
check('teacher_detail — sampleq count', sq >= 0, `${sq} نمونه‌سؤال`)

// list_sample_questions
const questions = await db.sampleQuestion.findMany({
  where: { schoolId: school.id },
  select: {
    id: true, title: true, subject: true, topic: true, status: true, showAnswer: true, createdAt: true,
    classes: { select: { classroom: { select: { id: true, name: true } } } },
    _count: { select: { files: true } },
    createdBy: { select: { fullName: true } },
  },
  orderBy: { createdAt: 'desc' },
  take: 15,
})
check('list_sample_questions', questions.length === 4, questions.map((q) => `${q.title}[${q.status === 'PUBLISHED' ? 'منتشر' : 'پیش‌نویس'}]`).join('، '))

// draft_announcement — نام مدرسه
check('draft_announcement — school', !!school?.name, school?.name)

await db.$disconnect()
console.log(fail === 0 ? '\nهمه بررسی‌ها سبز' : `\n${fail} بررسی ناموفق`)
process.exit(fail > 0 ? 1 : 0)
