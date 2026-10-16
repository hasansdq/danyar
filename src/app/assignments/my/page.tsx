import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { MyAssignmentsClient } from '@/components/assignments/my-assignments-client'

/** «تکالیف من» — همه تکالیف همه دروس دانش‌آموز با فیلتر درس و وضعیت */
export default async function MyAssignmentsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'STUDENT') redirect('/assignments')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <MyAssignmentsClient />
    </AppShell>
  )
}
