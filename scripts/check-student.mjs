import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const u = await db.user.findUnique({ where: { username: '1234500001' }, select: { id: true, username: true, role: true, isActive: true, schoolId: true, fullName: true } })
console.log('user:', JSON.stringify(u, null, 2))
const cnt = await db.user.count()
console.log('total users:', cnt)
await db.$disconnect()
