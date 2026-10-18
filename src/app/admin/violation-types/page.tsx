import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminViolationTypesClient } from '@/components/admin-violation-types-client'

export const metadata = { title: 'مدیریت انواع تخلف | دانیار' }

export default async function AdminViolationTypesPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/chats')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminViolationTypesClient />
    </AdminShell>
  )
}
