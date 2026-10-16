import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { LiveClient } from '@/components/live/live-client'

/**
 * صفحه کلاس آنلاین — فهرست نقش‌محور:
 * - معلم: کلاس‌های مجاز خودش + شروع جلسه فوری (عنوان + گروه اطلاع‌رسانی)
 * - دانش‌آموز: جلسه فعال کلاس‌های خودش
 * - مدیر مدرسه: جلسات فعال مدرسه + ورود یا پایان‌دادن
 */
export default async function LivePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <LiveClient role={session.role} fullName={session.fullName} />
    </AppShell>
  )
}
