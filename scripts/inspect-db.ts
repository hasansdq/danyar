// بررسی داده‌های موجود دیتابیس برای طراحی تست تقویم
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  const schools = await db.school.findMany({ select: { id: true, name: true } })
  console.log('SCHOOLS:', JSON.stringify(schools))
  const users = await db.user.findMany({
    select: { id: true, username: true, role: true, fullName: true, schoolId: true },
    take: 30,
  })
  console.log('USERS:', JSON.stringify(users, null, 1))
  const classrooms = await db.classroom.findMany({ select: { id: true, name: true, schoolId: true } })
  console.log('CLASSROOMS:', JSON.stringify(classrooms, null, 1))
  const tas = await db.teachingAssignment.findMany({
    select: { teacherId: true, subjectGroupId: true, subjectGroup: { select: { name: true, classroomId: true } } },
  })
  console.log('TEACHING_ASSIGNMENTS:', JSON.stringify(tas, null, 1))
  const enr = await db.classroomEnrollment.findMany({
    select: { studentId: true, classroomId: true, student: { select: { username: true } } },
  })
  console.log('ENROLLMENTS:', JSON.stringify(enr, null, 1))
}

main().finally(() => process.exit(0))
