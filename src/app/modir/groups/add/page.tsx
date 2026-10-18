import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolGroupsClient } from '@/components/school-groups-client'
import { viceHasPermission } from '@/lib/vice-permissions'
import { ModirAccessDenied } from '@/components/modir/access-denied'

export const metadata = { title: 'افزودن گروه جدید | دانیار' }

/**
 * صفحهٔ «فقط فرم افزودن گروه» (درخواست کاربر: آیکون + کارت آماری گروه‌ها باید به
 * صفحه‌ای برود که فقط فرم افزودن باشد) — همان فرم‌های ایجاد گروه پیام‌رسان.
 */
export default async function SchoolGroupsAddPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  // معاون: مدیریت گروه‌ها قابل محدودیت از طرف مدیر مدرسه است
  if (session.role === 'SCHOOL_VICE' && !(await viceHasPermission(session, 'groups'))) {
    return (
      <AppShell user={{ fullName: session.fullName, role: session.role }}>
        <ModirAccessDenied what="مدیریت گروه‌ها" />
      </AppShell>
    )
  }

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SchoolGroupsClient addOnly />
    </AppShell>
  )
}
