import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { AdminShell } from '@/components/admin-shell'
import { SettingsClient } from '@/components/settings-client'

export const metadata = { title: 'تنظیمات | دانیار' }

/**
 * تنظیمات — برای همهٔ نقش‌ها از جمله مدیر کل (درخواست کاربر: همه کاربران بتوانند
 * از آیکون چرخ‌دنده در هدر رمز عبور خود را تغییر دهند)
 */
export default async function SettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  // مدیر کل پوستهٔ پنل خودش را می‌بیند؛ کاربران اپ پوستهٔ پیام‌رسان را
  if (session.role === 'SUPER_ADMIN') {
    return (
      <AdminShell user={{ fullName: session.fullName }}>
        <SettingsClient
          forcePassword={session.pwdDefault ?? false}
          userRole={session.role}
          returnTo="/admin"
        />
      </AdminShell>
    )
  }

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SettingsClient
        forcePassword={session.pwdDefault ?? false}
        userRole={session.role}
        returnTo="/"
      />
    </AppShell>
  )
}
