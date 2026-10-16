// بررسی کاربران مرتبط + وضعیت مدارس برای کلاس آنلاین
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
try {
  const host = await db.user.findUnique({
    where: { id: 'cmv1aryrh001rlokrwnetd11f' },
    select: { id: true, username: true, fullName: true, role: true, schoolId: true, isActive: true },
  })
  console.log('HOST OF ACTIVE SESSION:', JSON.stringify(host))
  const t1 = await db.user.findUnique({
    where: { username: 'farzanegan.t1' },
    select: { id: true, username: true, fullName: true, role: true, schoolId: true, isActive: true },
  })
  console.log('FARZANEGAN.T1:', JSON.stringify(t1))
  const schools = await db.school.findMany({
    select: { id: true, name: true, isActive: true, features: true },
  })
  console.log('SCHOOLS:', JSON.stringify(schools, null, 1))
} catch (e) {
  console.error('ERR', e.message)
} finally {
  await db.$disconnect()
}
