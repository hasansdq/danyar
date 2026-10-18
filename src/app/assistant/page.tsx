import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { ChatSplit } from '@/components/messenger/chat-split'
import { AssistantView } from '@/components/assistant/assistant-view'
import { viceHasPermission } from '@/lib/vice-permissions'
import { ModirAccessDenied } from '@/components/modir/access-denied'

/** گفتگوی اختصاصی «دستیار دانیار» — مدیر مدرسه و معاون (با مجوز دستیار هوشمند) */
export default async function AssistantPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  // معاون: دستیار هوشمند قابل محدودیت از طرف مدیر مدرسه است
  if (session.role === 'SCHOOL_VICE' && !(await viceHasPermission(session, 'ai_assistant'))) {
    return (
      <AppShell user={{ fullName: session.fullName, role: session.role }}>
        <ModirAccessDenied what="دستیار هوشمند" />
      </AppShell>
    )
  }

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }} hFixed hideMobileNav hideMobileHeader>
      <ChatSplit currentKey="assistant">
        <AssistantView />
      </ChatSplit>
    </AppShell>
  )
}
