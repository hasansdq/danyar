import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { AnnouncementsClient } from '@/components/announcements-client'

export const metadata = { title: 'اطلاعیه‌ها | دانیار' }

export default async function AnnouncementsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN') redirect('/')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <AnnouncementsClient />
    </AppShell>
  )
}
