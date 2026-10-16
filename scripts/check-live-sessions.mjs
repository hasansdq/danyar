// بررسی ردیف‌های اخیر LiveSession در دیتابیس
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
try {
  const rows = await db.liveSession.findMany({
    orderBy: { startedAt: 'desc' },
    take: 8,
    select: {
      id: true, status: true, hostId: true, classroomId: true,
      notifyGroupId: true, startedAt: true, endedAt: true, enderId: true,
      classroom: { select: { name: true, schoolId: true } },
    },
  })
  console.log(JSON.stringify(rows, null, 2))
} catch (e) {
  console.error('ERR', e.message)
} finally {
  await db.$disconnect()
}
