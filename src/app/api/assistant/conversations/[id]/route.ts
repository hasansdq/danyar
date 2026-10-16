import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolAdmin } from '@/lib/api-auth'

/** مالکیت گفتگو — گفتگوی دیگری حتی با دانستن شناسه ۴۰۴ می‌شود */
async function ownConversation(uid: string, id: number) {
  const c = await db.aiConversation.findUnique({
    where: { id },
    select: { id: true, userId: true, title: true, createdAt: true },
  })
  return c && c.userId === uid ? c : null
}

/** پیام‌های گفتگو — فقط برای صاحبش */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const { id } = await ctx.params
  const convId = Number(id)
  if (!Number.isInteger(convId)) return NextResponse.json({ error: 'یافت نشد' }, { status: 404 })

  const conv = await ownConversation(res.session.uid, convId)
  if (!conv) return NextResponse.json({ error: 'گفتگو یافت نشد' }, { status: 404 })

  const messages = await db.aiMessage.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, refs: true, stopped: true, createdAt: true },
  })

  return NextResponse.json({
    conversation: { id: conv.id, title: conv.title, createdAt: conv.createdAt.toISOString() },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      refs: m.refs ?? [],
      stopped: m.stopped,
      createdAt: m.createdAt.toISOString(),
    })),
  })
}

/** حذف گفتگو — دو مرحله‌ای: بدون confirm آمار می‌دهد؛ با confirm حذف قطعی */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const { id } = await ctx.params
  const convId = Number(id)
  if (!Number.isInteger(convId)) return NextResponse.json({ error: 'یافت نشد' }, { status: 404 })

  const conv = await ownConversation(res.session.uid, convId)
  if (!conv) return NextResponse.json({ error: 'گفتگو یافت نشد' }, { status: 404 })

  const confirm = req.nextUrl.searchParams.get('confirm') === 'true'
  const count = await db.aiMessage.count({ where: { conversationId: convId } })

  if (!confirm) {
    return NextResponse.json(
      { error: 'برای حذف قطعی تأیید لازم است', messages: count },
      { status: 409 },
    )
  }

  await db.aiConversation.delete({ where: { id: convId } })
  return NextResponse.json({ ok: true })
}
