import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolClassesClient } from '@/components/school-classes-client'

export const metadata = { title: 'کلاس‌های مدرسه | دانیار' }

export default async function SchoolClassesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN') redirect('/')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SchoolClassesClient />
    </AppShell>
  )
}
