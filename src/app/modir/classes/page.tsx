import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolClassesClient } from '@/components/school-classes-client'
import { viceHasPermission } from '@/lib/vice-permissions'
import { ModirAccessDenied } from '@/components/modir/access-denied'

export const metadata = { title: 'کلاس‌های مدرسه | دانیار' }

/**
 * باکس کلاس‌ها (درخواست کاربر): فرم افزودن کلاس و فهرست کلاس‌ها داخل همان باکس
 * ادغام شده‌اند — باکس‌های آماری هشتگانه در صفحهٔ مستقل هاب (/modir) هستند.
 */
export default async function SchoolClassesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  // معاون: مدیریت کلاس‌ها قابل محدودیت از طرف مدیر مدرسه است
  if (session.role === 'SCHOOL_VICE' && !(await viceHasPermission(session, 'classes'))) {
    return (
      <AppShell user={{ fullName: session.fullName, role: session.role }}>
        <ModirAccessDenied what="مدیریت کلاس‌ها" />
      </AppShell>
    )
  }

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SchoolClassesClient />
    </AppShell>
  )
}
