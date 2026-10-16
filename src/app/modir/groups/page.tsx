import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolGroupsClient } from '@/components/school-groups-client'

export const metadata = { title: 'مدیریت گروه‌ها | دانیار' }

export default async function SchoolGroupsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN') redirect('/')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SchoolGroupsClient />
    </AppShell>
  )
}
