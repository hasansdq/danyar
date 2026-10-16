import { redirect, notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { ChatSplit } from '@/components/messenger/chat-split'
import { ChatView } from '@/components/messenger/chat-view'

export default async function DmChatPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  const { userId } = await params
  if (!userId) notFound()

  return (
    <AppShell
      user={{ fullName: session.fullName, role: session.role }}
      hFixed
      hideMobileNav
      hideMobileHeader
    >
      <ChatSplit currentKey={`dm:${userId}`}>
        <ChatView
          kind="dm"
          targetId={userId}
          me={{ id: session.uid, fullName: session.fullName, role: session.role }}
        />
      </ChatSplit>
    </AppShell>
  )
}
