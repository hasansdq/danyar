import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminAiClient } from '@/components/admin-ai-client'

/** تنظیمات دستیار هوش مصنوعی — فقط مدیر کل */
export default async function AdminAiPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/login')

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminAiClient />
    </AdminShell>
  )
}
