import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { SchoolDetailClient } from '@/components/school-detail-client'

export const metadata = { title: 'جزئیات مدرسه | دانیار' }

export default async function AdminSchoolDetailPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/chats')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <SchoolDetailClient />
    </AdminShell>
  )
}
