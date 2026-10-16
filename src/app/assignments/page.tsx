import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { AssignmentsClient } from '@/components/assignments/assignments-client'

/**
 * صفحه تکالیف — معلم (مدیریت و پیگیری تکالیف گروه‌های خودش)
 * و مدیر مدرسه (نمای فقط‌خواندنی همه تکالیف مدرسه)
 */
export default async function AssignmentsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role === 'STUDENT') redirect('/assignments/my')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <AssignmentsClient role={session.role} />
    </AppShell>
  )
}
