// بررسی معلم میزبان جلسه فعال + دانش‌آموزان کلاس نهم۱
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const host = await db.user.findUnique({ where: { id: 'cmv1aryrh001rlokrwnetd11f' }, select: { username: true, fullName: true, role: true } })
console.log('host:', host)
const enr = await db.classroomEnrollment.findMany({
  where: { classroomId: 'cmv1aryrh001tlokrwo9kd4q9' },
  include: { student: { select: { username: true, fullName: true, isActive: true } } },
})
console.log('students of نهم۱:', enr.map((e) => ({ u: e.student.username, n: e.student.fullName, active: e.student.isActive })))
const t = await db.teachingAssignment.findMany({
  where: { subjectGroup: { classroomId: 'cmv1aryrh001tlokrwo9kd4q9' } },
  include: { teacher: { select: { username: true } }, subjectGroup: { select: { name: true } } },
})
console.log('teachers:', t.map((x) => ({ u: x.teacher.username, g: x.subjectGroup.name })))
await db.$disconnect()
