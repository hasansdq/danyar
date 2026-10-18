import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { ClassCalendarClient } from '@/components/calendar/class-calendar-client'

export const metadata = { title: 'تقویم آموزشی | دانیار' }

/**
 * صفحه تقویم آموزشی کلاسی — تقویم جلالی ایرانی کلاس‌محور:
 * - مدیر مدرسه: انتخاب کلاس + ثبت رویداد برای کلاس یا کل مدرسه (تعطیل فقط مدیر)
 * - معلم: فقط کلاس‌های منتسب خودش
 * - دانش‌آموز: فقط مشاهده رویدادهای کلاس خودش
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; open?: string; t?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')

  const sp = await searchParams

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <ClassCalendarClient
        role={session.role}
        uid={session.uid}
        initialClassId={sp.class}
        // دیپ‌لینک دکمه شناور «+» معلم: /calendar?open=attendance&t=… →
        // انتخاب خودکار امروز + بازشدن مستقیم ویرایشگر «ثبت غیبت/نمره/تخلف»
        autoAttendance={sp.open === 'attendance' ? (sp.t ?? '0') : undefined}
      />
    </AppShell>
  )
}
