import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { AssignmentDetailClient } from '@/components/assignments/assignment-detail-client'

/**
 * جزئیات تکلیف — نمای معلم (پاسخ‌ها و بازخورد)، دانش‌آموز (ارسال پاسخ)
 * و مدیر مدرسه (مشاهده آموزشی)
 */
export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')

  const { id } = await params

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <AssignmentDetailClient id={id} role={session.role} />
    </AppShell>
  )
}
