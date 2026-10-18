import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolHubClient } from '@/components/school-hub-client'

export const metadata = { title: 'مدیریت مدرسه | دانیار' }

/**
 * هاب «مدیریت مدرسه» (درخواست کاربر): باکس‌های آماری هشتگانه (معاونین، معلمان،
 * گروه‌های درسی، …) کاملاً جداگانه در صفحهٔ خودشان — نه داخل تب فهرست کلاس‌ها.
 * فهرست و افزودن کلاس داخل باکس کلاس‌ها (/modir/classes) ادغام شده است.
 * هر باکس: آیکون + → صفحهٔ افزودن، آیکون تنظیمات → فهرست و مدیریت همان مورد.
 */
export default async function ModirHubPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SchoolHubClient
        role={session.role}
        canManageDeputies={session.role === 'SCHOOL_ADMIN'}
      />
    </AppShell>
  )
}
