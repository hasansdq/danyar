import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolClassesClient } from '@/components/school-classes-client'
import { viceHasPermission } from '@/lib/vice-permissions'
import { ModirAccessDenied } from '@/components/modir/access-denied'

export const metadata = { title: 'افزودن کلاس جدید | دانیار' }

/**
 * صفحهٔ «فقط فرم افزودن کلاس» (درخواست کاربر: آیکون + کارت آماری کلاس‌ها باید به
 * صفحه‌ای برود که فقط فرم افزودن همان مورد باشد) — فرم همان فرم ایجاد کلاس است.
 */
export default async function SchoolClassesAddPage() {
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
      <SchoolClassesClient addOnly />
    </AppShell>
  )
}
