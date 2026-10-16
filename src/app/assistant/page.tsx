import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { ChatSplit } from '@/components/messenger/chat-split'
import { AssistantView } from '@/components/assistant/assistant-view'

/** گفتگوی اختصاصی «دستیار دانیار» — فقط برای مدیر مدرسه */
export default async function AssistantPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN') redirect('/')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }} hFixed hideMobileNav hideMobileHeader>
      <ChatSplit currentKey="assistant">
        <AssistantView />
      </ChatSplit>
    </AppShell>
  )
}
