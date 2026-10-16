import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { ChatList } from '@/components/chat-list'

export const metadata = { title: 'گفتگوها | دانیار' }

export default async function ChatsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <ChatList />
    </AppShell>
  )
}
