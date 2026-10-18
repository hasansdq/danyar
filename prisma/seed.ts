import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const db = new PrismaClient()

async function main() {
  // ایجاد حساب مدیر کل پلتفرم (فقط اگر وجود نداشته باشد)
  // رمز اولیه هرگز در کد ثابت نیست — فقط از تنظیمات مالک (env) خوانده می‌شود؛
  // حساب‌های موجود هرگز تغییر نمی‌کنند (نام کاربری موجود → هیچ کاری انجام نمی‌شود).
  const existing = await db.user.findUnique({
    where: { username: 'superadmin' },
  })

  if (existing) {
    console.log('• مدیر کل از قبل وجود دارد — رمز دست‌نخورده ماند')
    return
  }

  const initialPassword = process.env.SUPERADMIN_INITIAL_PASSWORD?.trim()
  if (!initialPassword || initialPassword.length < 12) {
    throw new Error('[seed] SUPERADMIN_INITIAL_PASSWORD باید حداقل ۱۲ کاراکتر باشد؛ حسابی با رمز پیش‌فرض ساخته نمی‌شود.')
  }

  await db.user.create({
    data: {
      username: 'superadmin',
      passwordHash: await bcrypt.hash(initialPassword, 12),
      fullName: 'مدیر کل پلتفرم',
      role: 'SUPER_ADMIN',
    },
  })
  console.log('✔ مدیر کل ایجاد شد (رمز از SUPERADMIN_INITIAL_PASSWORD خوانده شد — در کد/لاگ ذخیره نمی‌شود)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
