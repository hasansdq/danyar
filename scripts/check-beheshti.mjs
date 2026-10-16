// بررسی امکان تست در مدرسه beheshti — کلاس‌ها، دانش‌آموزان، فیچر کلاس آنلاین
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const schools = await db.school.findMany({ select: { id: true, name: true, isActive: true, features: true } })
console.log('schools:', schools)
const beheshti = schools.find((s) => s.name.toLowerCase().includes('beheshti') || s.name.includes('بهشتی'))
if (beheshti) {
  const classes = await db.classroom.findMany({ where: { schoolId: beheshti.id }, select: { id: true, name: true } })
  for (const c of classes) {
    const enr = await db.classroomEnrollment.findMany({
      where: { classroomId: c.id },
      include: { student: { select: { username: true, fullName: true, isActive: true } } },
    })
    const groups = await db.subjectGroup.findMany({ where: { classroomId: c.id }, select: { id: true, name: true } })
    const ta = await db.teachingAssignment.findMany({ where: { subjectGroup: { classroomId: c.id } }, include: { teacher: { select: { username: true } } } })
    console.log('class:', c.name, '| students:', enr.map((e) => `${e.student.username}(${e.student.isActive})`).join(', ') || 'NONE', '| groups:', groups.map((g) => g.name).join(','), '| teachers:', [...new Set(ta.map((t) => t.teacher.username))].join(','))
  }
  const users = await db.user.findMany({ where: { schoolId: beheshti.id }, select: { username: true, role: true, isActive: true } })
  console.log('beheshti users:', users)
}
await db.$disconnect()
