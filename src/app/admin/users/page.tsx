import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminUsersClient } from '@/components/admin-users-client'

export const metadata = { title: 'کاربران پلتفرم | دانیار' }

export default async function AdminUsersPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/chats')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminUsersClient />
    </AdminShell>
  )
}
