import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { canDirectMessage } from '@/lib/chat-access'
import {
  loadConversationMessages,
  serializeMessage,
  loadPinnedMessages,
  previewOf,
  sanitizeVoiceMeta,
} from '@/lib/messaging'
import { pushNotifications, filterMutedUsers } from '@/lib/notifications'
import { notifySocket, roomForUser } from '@/lib/notify'

type Params = { params: Promise<{ userId: string }> }

const threadWhere = (a: string, b: string) => ({
  kind: 'DIRECT' as const,
  OR: [
    { senderId: a, recipientId: b },
    { senderId: b, recipientId: a },
  ],
})

/** دریافت پیام‌های گفتگوی خصوصی با بارگذاری تدریجی */
export async function GET(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { userId } = await params

  const peer = await db.user.findFirst({
    where: { id: userId, schoolId: session.schoolId, isActive: true },
    select: { id: true, fullName: true, role: true },
  })
  if (!peer) return jsonError('کاربر یافت نشد یا دسترسی ندارید', 404)

  const allowed = await canDirectMessage(session, userId)
  if (!allowed.ok) return jsonError(allowed.reason ?? 'دسترسی غیرمجاز', 403)

  const sp = req.nextUrl.searchParams
  const thread = threadWhere(session.uid, userId)
  const result = await loadConversationMessages(thread, {
    before: sp.get('before'),
    limit: Number(sp.get('limit') ?? 30),
  })
  const pinned = await loadPinnedMessages(thread)

  return NextResponse.json({
    conversation: {
      key: `dm:${peer.id}`,
      type: 'DM' as const,
      id: peer.id,
      title: peer.fullName,
      subtitle: peer.role === 'SCHOOL_ADMIN' ? 'مدیر مدرسه' : peer.role === 'SCHOOL_VICE' ? 'معاون مدرسه' : peer.role === 'TEACHER' ? 'معلم' : 'دانش‌آموز',
      canSend: true,
      cannotSendReason: null,
    },
    ...result,
    pinned,
  })
}

const MAX_BODY = 4000

/** ارسال پیام خصوصی */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { userId } = await params

  const allowed = await canDirectMessage(session, userId)
  if (!allowed.ok) return jsonError(allowed.reason ?? 'گفتگوی خصوصی مجاز نیست', 403)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const text = String(body.body ?? '').trim()
  const clientId = body.clientId ? String(body.clientId).slice(0, 64) : null
  const replyToId = body.replyToId ? String(body.replyToId) : null
  const att = body.attachment ?? null

  if (!text && !att) return jsonError('پیام خالی است')
  if (text.length > MAX_BODY) return jsonError('متن پیام بیش از حد مجاز است')

  // جلوگیری از ثبت تکراری پس از اتصال مجدد
  if (clientId) {
    const existing = await db.message.findUnique({ where: { clientId } })
    if (
      existing &&
      existing.kind === 'DIRECT' &&
      (existing.recipientId === userId ||
        (existing.senderId === userId && existing.recipientId === session.uid))
    ) {
      const s = await serializeMessage(existing.id)
      return NextResponse.json({ message: s, duplicate: true }, { status: 200 })
    }
  }

  // پاسخ باید در همین گفتگو باشد
  if (replyToId) {
    const target = await db.message.findFirst({
      where: { id: replyToId, ...threadWhere(session.uid, userId) },
    })
    if (!target) return jsonError('پیام مورد پاسخ یافت نشد', 400)
  }

  let attachment: {
    name: string
    key: string
    mime: string
    size: number
    type: string
    meta: string | null
  } | null = null
  if (att) {
    const key = String(att.key ?? '')
    if (!key || key.includes('..') || key.startsWith('/')) {
      return jsonError('پیوست نامعتبر است')
    }
    const meta = await db.upload.findUnique({ where: { key } }).catch(() => null)
    if (!meta) return jsonError('فایل آپلودشده یافت نشد؛ دوباره تلاش کنید', 400)
    // فراداده پیام ویس فقط برای پیوست صوتی پذیرفته می‌شود
    const voiceMeta =
      meta.type === 'AUDIO' ? sanitizeVoiceMeta(att.duration, att.waveform) : null
    attachment = {
      key: meta.key,
      name: meta.name,
      mime: meta.mime,
      size: meta.size,
      type: meta.type,
      meta: voiceMeta,
    }
  }

  const created = await db.message.create({
    data: {
      kind: 'DIRECT',
      senderId: session.uid,
      recipientId: userId,
      type: attachment ? attachment.type : 'TEXT',
      body: text,
      attachmentName: attachment?.name,
      attachmentKey: attachment?.key,
      attachmentMime: attachment?.mime,
      attachmentSize: attachment?.size,
      attachmentMeta: attachment?.meta ?? null,
      replyToId,
      clientId,
    },
  })

  // ردیف Upload به‌عنوان کتابخانه رسانه پلتفرم باقی می‌ماند (گالری مدیر کل + شمارش دانلود)
  // — حذف رسانه فقط از پنل مدیر کل انجام می‌شود

  const serialized = await serializeMessage(created.id)
  await notifySocket({
    rooms: [roomForUser(session.uid), roomForUser(userId)],
    event: 'message:new',
    data: serialized,
  })

  // اعلان پیام خصوصی — برای گیرنده فقط یک‌بار (بی‌صدایی گیرنده احترام می‌شود)
  const recipient = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  })
  if (recipient?.isActive) {
    const muted = await filterMutedUsers([userId], 'DIRECT', session.uid)
    if (!muted.has(userId)) {
      await pushNotifications([
        {
          userId,
          type: 'PRIVATE_MESSAGE',
          title: session.fullName,
          body: previewOf(created),
          link: `/chats/dm/${session.uid}`,
          dedupeKey: `msg:${created.id}`,
        },
      ])
    }
  }

  return NextResponse.json({ message: serialized }, { status: 201 })
}
