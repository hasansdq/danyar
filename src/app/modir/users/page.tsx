import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolUsersClient, type VicePerms } from '@/components/school-users-client'
import { vicePermissionMap } from '@/lib/vice-permissions'

export const metadata = { title: 'فهرست کاربران مدرسه | دانیار' }

export default async function SchoolUsersPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  // معاون: فهرست کاربران را می‌بیند؛ ثبت‌نام/ویرایش/حذف بر اساس مجوزهایش
  // (سوییچ‌های مدیر مدرسه در /modir/deputies) — null یعنی مدیر مدرسه بدون محدودیت
  const permissions =
    session.role === 'SCHOOL_VICE'
      ? ((await vicePermissionMap(session.uid)) as VicePerms)
      : null

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SchoolUsersClient permissions={permissions} />
    </AppShell>
  )
}
