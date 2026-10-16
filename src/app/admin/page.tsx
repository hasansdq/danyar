import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminDashboard } from '@/components/admin-dashboard'

export const metadata = { title: 'پنل مدیر کل | دانیار' }

export default async function AdminPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/chats')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminDashboard />
    </AdminShell>
  )
}
