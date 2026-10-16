import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { LiveRoomClient } from '@/components/live/live-room'
import { onlineClassEnabled } from '@/lib/live-access'
import { ModuleBlocked } from '@/components/live/module-blocked'

/**
 * اتاق جلسه کلاس آنلاین — ورود فقط با احراز هویت و مجوز سمت سرور؛
 * کنترل دسترسی واقعی در هنگام join ساکتی و در سرویس Socket.IO انجام می‌شود.
 * اگر ماژول استریم مدرسه خاموش باشد، قبل از رندر اتاق با پیام رسمی مسدود می‌شود.
 */
export default async function LiveRoomPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  const { sessionId } = await params

  // گیت ماژول استریم — سمت سرور و پیش از هر رندری از اتاق؛
  // کاربر بدون مدرسه (حالت غیرمنتظره) هم بلاک می‌شود
  const enabled = session.schoolId ? await onlineClassEnabled(session.schoolId) : false
  if (!enabled) {
    return (
      <AppShell
        user={{ fullName: session.fullName, role: session.role }}
        hFixed
        hideMobileNav
        hideMobileHeader
      >
        <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full">
          <ModuleBlocked />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      user={{ fullName: session.fullName, role: session.role }}
      hFixed
      hideMobileNav
      hideMobileHeader
    >
      <LiveRoomClient
        sessionId={sessionId}
        me={{ id: session.uid, fullName: session.fullName, role: session.role }}
      />
    </AppShell>
  )
}
