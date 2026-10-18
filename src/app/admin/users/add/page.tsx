import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminUsersAddClient } from '@/components/admin-users-add-client'

export const metadata = { title: 'افزودن کاربر | دانیار' }

/** صفحهٔ افزودن کاربر — جدا از فهرست کاربران (درخواست کاربر) */
export default async function AdminUsersAddPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/chats')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminUsersAddClient />
    </AdminShell>
  )
}
