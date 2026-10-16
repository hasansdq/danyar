import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminAppearanceClient } from '@/components/admin-appearance-client'

export const metadata = { title: 'ظاهر و اسپلش' }

export default async function AdminAppearancePage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/chats')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminAppearanceClient />
    </AdminShell>
  )
}
