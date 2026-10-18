import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { AttendanceClient } from '@/components/attendance/attendance-client'

/**
 * صفحه حضور و غیاب — بخش مستقل در منوی موبایل و دسکتاپ، کاملاً تقویم‌محور (جلالی):
 * - معلم: انتخاب روز در تقویم + کلاس مجاز خودش → ثبت وضعیت (پیش‌فرض حاضر) + سوابق و اصلاح
 * - دانش‌آموز: «حضور و غیاب من» — فقط سوابق نهایی‌شده خودش + تخلفات ثبت‌شده
 * - مدیر/معاون مدرسه: گزارش کل مدرسه با فیلتر، آمار، اصلاح و خروجی اکسل
 */
export default async function AttendancePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <AttendanceClient role={session.role} fullName={session.fullName} />
    </AppShell>
  )
}
