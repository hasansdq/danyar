import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { AnnouncementsClient } from '@/components/announcements-client'
import { viceHasPermission } from '@/lib/vice-permissions'
import { ModirAccessDenied } from '@/components/modir/access-denied'

export const metadata = { title: 'ارسال اطلاعیه | دانیار' }

/**
 * صفحهٔ «ارسال اطلاعیه جدید» (درخواست کاربر: آیکون + باکس اطلاعیه‌ها در هاب
 * مدیریت مدرسه به این صفحه می‌رسد) — با زیرناوبری دو صفحه‌ای اطلاعیه‌ها.
 */
export default async function AnnouncementsAddPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  // معاون: ارسال اطلاعیه قابل محدودیت از طرف مدیر مدرسه است
  if (session.role === 'SCHOOL_VICE' && !(await viceHasPermission(session, 'announcements'))) {
    return (
      <AppShell user={{ fullName: session.fullName, role: session.role }}>
        <ModirAccessDenied what="ارسال اطلاعیه" />
      </AppShell>
    )
  }

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <AnnouncementsClient showSubNav />
    </AppShell>
  )
}
