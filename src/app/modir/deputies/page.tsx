import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { DeputiesClient } from '@/components/modir/deputies-client'

export const metadata = { title: 'معاونین و دسترسی‌ها | دانیار' }

/** مدیریت معاون‌های مدرسه و سوییچ دسترسی‌های هرکدام — فقط مدیر مدرسه */
export default async function DeputiesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  // پنل مدیریت دسترسی معاون‌ها فقط برای مدیر مدرسه — خود معاون‌ها به مدیریت مدرسه برمی‌گردند
  if (session.role !== 'SCHOOL_ADMIN') redirect('/modir')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <DeputiesClient />
    </AppShell>
  )
}
