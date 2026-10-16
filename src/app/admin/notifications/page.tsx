import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminPushClient } from '@/components/admin-push-client'

export const metadata = { title: 'اعلان‌ها | دانیار' }

/** پوش نوتیفیکیشن — فقط مدیر کل */
export default async function AdminNotificationsPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/login')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminPushClient />
    </AdminShell>
  )
}
