import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminBrandingClient } from '@/components/admin-branding-client'

export const metadata = { title: 'هویت دانیار' }

export default async function AdminBrandingPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/chats')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminBrandingClient />
    </AdminShell>
  )
}
