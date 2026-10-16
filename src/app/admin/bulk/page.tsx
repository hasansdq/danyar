import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminBulkClient } from '@/components/admin-bulk-client'

export const metadata = { title: 'ارسال انبوه | دانیار' }

/** ارسال انبوه پیامک/اعلان — فقط مدیر کل */
export default async function AdminBulkPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/login')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminBulkClient />
    </AdminShell>
  )
}
