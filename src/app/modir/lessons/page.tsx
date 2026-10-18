import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolLessonsClient } from '@/components/school-lessons-client'
import { viceHasPermission } from '@/lib/vice-permissions'
import { ModirAccessDenied } from '@/components/modir/access-denied'

export const metadata = { title: 'مدیریت درس‌ها | دانیار' }

/**
 * صفحهٔ «لیست درس‌ها و مدیریت آنها» (درخواست کاربر):
 * آیکون تنظیمات باکس «درس‌ها» در هاب مدیریت مدرسه به اینجا می‌آید —
 * فهرست درس‌های مدرسه با تعداد معلمان منتسب، ویرایش نام و حذف.
 */
export default async function SchoolLessonsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  // معاون: مدیریت درس‌ها قابل محدودیت از طرف مدیر مدرسه است
  if (session.role === 'SCHOOL_VICE' && !(await viceHasPermission(session, 'lessons'))) {
    return (
      <AppShell user={{ fullName: session.fullName, role: session.role }}>
        <ModirAccessDenied what="مدیریت درس‌ها" />
      </AppShell>
    )
  }

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SchoolLessonsClient />
    </AppShell>
  )
}
