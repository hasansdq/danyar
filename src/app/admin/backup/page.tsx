import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AdminShell } from '@/components/admin-shell'
import { AdminBackupClient } from '@/components/admin-backup-client'
import { BACKUP_SECTIONS } from '@/lib/backup-catalog'

export const metadata = { title: 'بکاپ گیری و ایمپورت | دانیار' }

/** بخش «بکاپ گیری و ایمپورت» پنل مدیر کل (درخواست کاربر) — انتخابی و جداگانه */
export default async function AdminBackupPage() {
  const session = await getSession()
  if (!session) redirect('/superadmin')
  if (session.role !== 'SUPER_ADMIN') redirect('/chats')

  // کاتالوگ بخش‌ها برای UI (بدون وابستگی سروری)
  const sections = BACKUP_SECTIONS.map((s) => ({ key: s.key, label: s.label, hint: s.hint }))

  return (
    <AdminShell user={{ fullName: session.fullName }}>
      <AdminBackupClient sections={sections} />
    </AdminShell>
  )
}
