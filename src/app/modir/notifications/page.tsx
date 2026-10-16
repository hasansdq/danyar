import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolPushClient } from '@/components/school-push-client'

export const metadata = { title: 'اعلان‌ها | دانیار' }

/** بخش اعلان‌های پنل مدیر مدرسه — فقط مدیر مدرسه */
export default async function ModirNotificationsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN') redirect('/')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SchoolPushClient />
    </AppShell>
  )
}
