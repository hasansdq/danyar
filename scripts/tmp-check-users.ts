import { db } from '@/lib/db'
async function main() {
  const users = await db.user.findMany({ select: { username: true, fullName: true, role: true, isActive: true } })
  console.log(JSON.stringify(users, null, 1))
  await db.$disconnect()
}
main()
