import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { ChatSplit } from '@/components/messenger/chat-split'
import { MessengerList, EmptyChatPane } from '@/components/messenger/messenger-list'

/** صفحه اصلی: فهرست گفتگوها (گروه‌های درسی + خصوصی) */
export default async function RootPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')

  return (
    <AppShell
      user={{ fullName: session.fullName, role: session.role }}
      hFixed
    >
      <ChatSplit listOnMobile>
        <EmptyChatPane />
      </ChatSplit>
    </AppShell>
  )
}
