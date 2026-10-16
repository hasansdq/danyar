import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminMediaClient } from '@/components/admin-media-client'

export const metadata = { title: 'مدیریت رسانه‌ها | دانیار' }

export default async function AdminMediaPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/chats')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminMediaClient />
    </AdminShell>
  )
}
