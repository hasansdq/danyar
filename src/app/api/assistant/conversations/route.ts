import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager } from '@/lib/api-auth'

/** فهرست گفتگوهای خصوصی کاربر با دستیار */
export async function GET() {
  const res = await requireSchoolManager('ai_assistant')
  if ('response' in res) return res.response
  const uid = res.session.uid

  const conversations = await db.aiConversation.findMany({
    where: { userId: uid },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { role: true, content: true, createdAt: true } },
    },
  })

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messageCount: c._count.messages,
      lastMessage: c.messages[0]
        ? {
            role: c.messages[0].role,
            preview: c.messages[0].content.replace(/\s+/g, ' ').slice(0, 80),
            at: c.messages[0].createdAt.toISOString(),
          }
        : null,
    })),
  })
}

/** ایجاد گفتگوی جدید */
export async function POST(req: NextRequest) {
  const res = await requireSchoolManager('ai_assistant')
  if ('response' in res) return res.response

  const body = await req.json().catch(() => ({}))
  const title =
    typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : 'دستیار دانیار'

  const conversation = await db.aiConversation.create({
    data: { userId: res.session.uid, title },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  })

  return NextResponse.json(
    {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        messageCount: 0,
      },
    },
    { status: 201 },
  )
}
