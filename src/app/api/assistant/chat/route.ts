import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolAdmin } from '@/lib/api-auth'
import { assertAiUsable, logAiUsage } from '@/lib/ai/access'
import { generateAssistantResponse } from '@/lib/ai/generate'

const MAX_BODY = 4000

/**
 * ارسال پیام به دستیار و دریافت پاسخ جریان‌شده (SSE).
 * گیت‌های سمت سرور: پیکربندی، فعال بودن سراسری، فعال بودن مدرسه و نقش، سهمیه روزانه.
 * خطا هرگز پیام ساختگی ثبت نمی‌کند؛ پیام کاربر با clientId یونیک ضدتکرار است.
 */
export async function POST(req: NextRequest) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const session = res.session

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'بدنه درخواست نامعتبر است' }, { status: 400 })
  }
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const clientId = typeof body.clientId === 'string' ? body.clientId.slice(0, 100) : ''
  const conversationId = Number.isInteger(Number(body.conversationId)) ? Number(body.conversationId) : null

  if (!content || content.length > MAX_BODY) {
    return NextResponse.json({ error: `متن پیام باید بین ۱ تا ${MAX_BODY} کاراکتر باشد` }, { status: 400 })
  }
  if (!clientId) {
    return NextResponse.json({ error: 'شناسه پیام الزامی است' }, { status: 400 })
  }

  // گیت دسترسی + سهمیه (سمت سرور)
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

  // گفتگو: موجود یا جدید
  let convId: number
  if (conversationId !== null) {
    const conv = await db.aiConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true },
    })
    // جداسازی کاربران: گفتگوی دیگری ۴۰۴ می‌شود
    if (!conv || conv.userId !== session.uid) {
      return NextResponse.json({ error: 'گفتگو یافت نشد' }, { status: 404 })
    }
    convId = conv.id
  } else {
    const conv = await db.aiConversation.create({
      data: { userId: session.uid, title: content.slice(0, 40) + (content.length > 40 ? '…' : '') },
      select: { id: true },
    })
    convId = conv.id
  }

  // ثبت پیام کاربر با clientId یونیک — تکرار همان پیام ثبت نمی‌شود
  let userMessageId: number
  try {
    const created = await db.aiMessage.create({
      data: { conversationId: convId, role: 'USER', content, clientId },
      select: { id: true },
    })
    userMessageId = created.id
    await db.aiConversation.update({ where: { id: convId }, data: { updatedAt: new Date() } })
  } catch {
    // clientId تکراری: اگر همان آخرین پیام همین گفتگو است، تولید را ادامه بده (تلاش مجدد پس از قطعی)
    const existing = await db.aiMessage.findUnique({
      where: { clientId },
      select: { id: true, conversationId: true, role: true },
    })
    if (!existing || existing.conversationId !== convId || existing.role !== 'USER') {
      return NextResponse.json({ error: 'این پیام قبلاً ثبت شده است', code: 'DUPLICATE' }, { status: 409 })
    }
    const later = await db.aiMessage.count({
      where: { conversationId: convId, createdAt: { gt: (await db.aiMessage.findUniqueOrThrow({ where: { clientId }, select: { createdAt: true } })).createdAt } },
    })
    if (later > 0) {
      return NextResponse.json({ error: 'این پیام قبلاً پاسخ گرفته است', code: 'DUPLICATE' }, { status: 409 })
    }
    userMessageId = existing.id
  }

  const response = await generateAssistantResponse({
    req,
    conversationId: convId,
    userId: session.uid,
    schoolId: session.schoolId,
    cfg: gate.cfg,
  })

  // شناسه گفتگو برای کلاینت (در صورت ساخت خودکار)
  const headers = new Headers(response.headers)
  headers.set('X-Assistant-Conversation', String(convId))
  headers.set('X-Assistant-User-Message', String(userMessageId))
  return new Response(response.body, { status: response.status, headers })
}
