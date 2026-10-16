import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { InfrastructureClient } from '@/components/superadmin/infrastructure-client'

export const metadata = { title: 'وضعیت زیرساخت | دانیار' }

/**
 * صفحهٔ «وضعیت زیرساخت» — فقط مدیر کل.
 * گارد سمت سرور صفحه + گارد proxy.ts برای مسیر؛ APIهای این صفحه هم
 * جداگانه با requireSuperAdmin محافظت می‌شوند.
 */
export default async function InfrastructurePage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <InfrastructureClient />
    </AdminShell>
  )
}
