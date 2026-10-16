import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SettingsClient } from '@/components/settings-client'

export const metadata = { title: 'تنظیمات | دانیار' }

export default async function SettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SettingsClient />
    </AppShell>
  )
}
