/**
 * ساخت داده‌های دموی دانیار (اجرای دستی): bun scripts/seed-demo.ts
 * منطق اصلی در src/lib/seed-data.ts نگه داشته می‌شود تا اسکریپت و bootstrap خودترمیم
 * همیشه یک دادهٔ یکسان بسازند.
 */
import { PrismaClient } from '@prisma/client'
import { seedDemoData, ensureSuperadmin } from '../src/lib/seed-data'

const db = new PrismaClient()

async function main() {
  const summary = await seedDemoData(db, { clean: true })
  const superadminCreated = await ensureSuperadmin(db)
  console.log('✓ داده تستی ساخته شد:', summary)
  if (superadminCreated) {
    console.log('✔ مدیر کل ایجاد شد (رمز از SUPERADMIN_INITIAL_PASSWORD خوانده شد)')
  } else {
    console.log('• مدیر کل از قبل وجود دارد — رمز دست‌نخورده ماند')
  }
  console.log('  ورود اپ: beheshti.admin | farzanegan.admin | beheshti.t1..t3 | farzanegan.t1 | beheshti.s1..s6 | farzanegan.s1..s2 — همه با Pass@123 از /login')
  console.log('  ورود مدیر کل: superadmin / (رمز SUPERADMIN_INITIAL_PASSWORD) از /superadmin')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
