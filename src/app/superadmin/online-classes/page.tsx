import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { OnlineClassesClient } from '@/components/superadmin/online-classes-client'

export const metadata = { title: 'مدیریت کلاس‌های آنلاین | دانیار' }

/**
 * صفحهٔ «مدیریت کلاس‌های آنلاین» — فقط مدیر کل.
 * گارد سمت سرور صفحه + گارد proxy.ts برای مسیر؛ APIهای این صفحه هم
 * جداگانه با requireSuperAdmin محافظت می‌شوند.
 */
export default async function OnlineClassesPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <OnlineClassesClient />
    </AdminShell>
  )
}
