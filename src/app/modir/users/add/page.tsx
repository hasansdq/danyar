import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SchoolUsersAddClient } from '@/components/school-users-add-client'
import { vicePermissionMap } from '@/lib/vice-permissions'
import type { VicePerms } from '@/components/school-users-client'

export const metadata = { title: 'افزودن کاربر مدرسه | دانیار' }

/**
 * صفحهٔ افزودن کاربر مدرسه — مجزای فهرست کاربران (درخواست کاربر:
 * باکس‌های افزودن کاربر و لیست کاربران در دو صفحهٔ جداگانه باشند)
 */
export default async function SchoolUsersAddPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  // معاون: فرم‌های ثبت‌نام بر اساس مجوزهایش (سوییچ‌های مدیر مدرسه در /modir/deputies)
  // null یعنی مدیر مدرسه بدون محدودیت
  const permissions =
    session.role === 'SCHOOL_VICE'
      ? ((await vicePermissionMap(session.uid)) as VicePerms)
      : null

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SchoolUsersAddClient permissions={permissions} />
    </AppShell>
  )
}
