import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminSmsClient } from '@/components/admin-sms-client'

/** ورود پیامکی و سرویس پیامک — فقط مدیر کل */
export default async function AdminSmsPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/login')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminSmsClient />
    </AdminShell>
  )
}
