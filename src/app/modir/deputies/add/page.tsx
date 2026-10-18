import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { DeputiesClient } from '@/components/modir/deputies-client'

export const metadata = { title: 'افزودن معاون جدید | دانیار' }

/**
 * صفحهٔ «فقط فرم افزودن معاون» (درخواست کاربر: آیکون + کارت آماری معاونین باید به
 * صفحه‌ای برود که فقط فرم افزودن باشد) — فقط مدیر مدرسه.
 */
export default async function DeputiesAddPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN') redirect('/modir')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <DeputiesClient addOnly />
    </AppShell>
  )
}
