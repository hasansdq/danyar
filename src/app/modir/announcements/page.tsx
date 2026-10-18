import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { AnnouncementsListClient } from '@/components/announcements-list-client'
import { viceHasPermission } from '@/lib/vice-permissions'
import { ModirAccessDenied } from '@/components/modir/access-denied'

export const metadata = { title: 'اطلاعیه‌های اخیر | دانیار' }

/**
 * لیست اطلاعیه‌های اخیر و مدیریت آنها (درخواست کاربر: آیکون تنظیمات باکس
 * اطلاعیه‌ها در هاب مدیریت مدرسه به این صفحه می‌رسد؛ آیکون + به فرم ارسال می‌رود).
 */
export default async function AnnouncementsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  // معاون: ارسال/مدیریت اطلاعیه قابل محدودیت از طرف مدیر مدرسه است
  if (session.role === 'SCHOOL_VICE' && !(await viceHasPermission(session, 'announcements'))) {
    return (
      <AppShell user={{ fullName: session.fullName, role: session.role }}>
        <ModirAccessDenied what="مدیریت اطلاعیه‌ها" />
      </AppShell>
    )
  }

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <AnnouncementsListClient />
    </AppShell>
  )
}
