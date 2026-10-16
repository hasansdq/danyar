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
  if (!initialPassword) {
    console.error(
      '[seed] حساب مدیر کل وجود ندارد و SUPERADMIN_INITIAL_PASSWORD تنظیم نشده است.\n' +
        'در .env سرور یک رمز امن تعیین کنید (حداقل ۱۲ کاراکتر) و دوباره تلاش کنید.',
    )
    process.exit(1)
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
