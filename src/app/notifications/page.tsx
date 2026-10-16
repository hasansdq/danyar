import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { NotificationsClient } from '@/components/notifications/notifications-client'

/** صفحه اعلان‌ها */
export default async function NotificationsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <NotificationsClient />
    </AppShell>
  )
}
