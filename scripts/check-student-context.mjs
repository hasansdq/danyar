// بررسی عضویت دانش‌آموز 1234500001 و معلم مرتبط
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const stu = await db.user.findUnique({ where: { username: '1234500001' }, select: { id: true, schoolId: true, fullName: true } })
console.log('student:', stu)

const enr = await db.classroomEnrollment.findMany({
  where: { studentId: stu.id },
  include: { classroom: { select: { id: true, name: true, schoolId: true } } },
})
console.log('enrollments:', enr.map((e) => ({ classroomId: e.classroom.id, name: e.classroom.name })))

for (const e of enr) {
  const groups = await db.subjectGroup.findMany({
    where: { classroomId: e.classroom.id },
    select: { id: true, name: true, assignments: { select: { createdBy: { select: { username: true } } } } },
  })
  console.log('groups of', e.classroom.name, ':', groups.map((g) => ({ id: g.id, name: g.name, teachers: g.assignments.map((a) => a.createdBy.username) })))
}

// جلسات ACTIVE موجود
const active = await db.liveSession.findMany({ where: { status: 'ACTIVE' }, select: { id: true, title: true, hostId: true, classroomId: true } })
console.log('ACTIVE live sessions:', active)
await db.$disconnect()
