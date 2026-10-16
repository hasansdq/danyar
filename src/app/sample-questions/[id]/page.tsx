import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SampleQDetail } from '@/components/sample-questions/sampleq-detail'

/**
 * جزئیات نمونه‌سؤال — فایل‌ها با پیش‌نمایش PDF/تصویر، دانلود با احراز هویت،
 * پاسخ‌نامه فقط در صورت فعال‌بودن نمایش برای دانش‌آموز
 */
export default async function SampleQuestionDetailPage({
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
      <SampleQDetail id={id} role={session.role} />
    </AppShell>
  )
}
