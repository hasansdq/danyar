// ترمیم رمز farzanegan.t1 → Pass@123 (الگوی تکرارشونده: بازنشانی محیط رمز را برمی‌گرداند)
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
const db = new PrismaClient()
const target = await db.user.findFirst({ where: { username: 'farzanegan.t1' }, select: { id: true, username: true } })
if (!target) { console.error('farzanegan.t1 یافت نشد'); process.exit(1) }
const hash = await bcrypt.hash('Pass@123', 12)
await db.user.update({ where: { id: target.id }, data: { passwordHash: hash } })
const check = await db.user.findUnique({ where: { id: target.id }, select: { username: true } })
const okHash = await bcrypt.compare('Pass@123', hash)
console.log(`رمز ${check.username} ترمیم شد (verify=${okHash})`)
await db.$disconnect()
