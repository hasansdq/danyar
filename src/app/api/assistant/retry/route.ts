import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolAdmin } from '@/lib/api-auth'
import { assertAiUsable, logAiUsage } from '@/lib/ai/access'
import { generateAssistantResponse } from '@/lib/ai/generate'

/**
 * تلاش مجدد برای آخرین پیام کاربر گفتگو — بدون ثبت پیام تکراری.
 * پاسخ‌های نیمه‌کاره/قبلیِ پس از آن پیام حذف و پاسخ نو ساخته می‌شود.
 * سهمیه مصرف نمی‌شود چون پیام کاربر جدیدی ثبت نمی‌شود.
 */
export async function POST(req: NextRequest) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const session = res.session

  const body = await req.json().catch(() => null)
  const conversationId = Number(body?.conversationId)
  if (!Number.isInteger(conversationId)) {
    return NextResponse.json({ error: 'شناسه گفتگو نامعتبر است' }, { status: 400 })
  }

  const conv = await db.aiConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true },
  })
  if (!conv || conv.userId !== session.uid) {
    return NextResponse.json({ error: 'گفتگو یافت نشد' }, { status: 404 })
  }

  const gate = await assertAiUsable(session)
  if (!gate.ok) {
    await logAiUsage({
      userId: session.uid,
      schoolId: session.schoolId,
      ok: false,
      errorType: gate.code,
      provider: null,
      model: null,
    })
    return NextResponse.json({ error: gate.message, code: gate.code }, { status: 403 })
  }

  // آخرین پیام باید USER باشد
  const last = await db.aiMessage.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, role: true, createdAt: true },
  })
  if (!last || last.role !== 'USER') {
    return NextResponse.json({ error: 'چیزی برای تلاش مجدد وجود ندارد' }, { status: 409 })
  }

  // حذف پاسخ‌های نیمه‌کاره قبلی پس از آن پیام
  await db.aiMessage.deleteMany({
    where: { conversationId, role: 'ASSISTANT', createdAt: { gt: last.createdAt } },
  })

  const response = await generateAssistantResponse({
    req,
    conversationId,
    userId: session.uid,
    schoolId: session.schoolId,
    cfg: gate.cfg,
  })
  return new Response(response.body, { status: response.status, headers: response.headers })
}
