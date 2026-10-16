import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import {
  getAccessibleGroup,
  checkGroupSendPermission,
  groupSubtitle,
} from '@/lib/chat-access'
import {
  loadConversationMessages,
  serializeMessage,
  loadPinnedMessages,
  previewOf,
  sanitizeVoiceMeta,
} from '@/lib/messaging'
import {
  pushNotifications,
  filterMutedUsers,
  effectiveGroupAudience,
} from '@/lib/notifications'
import { notifySocket, roomForGroup } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

/** دریافت پیام‌های گروه با بارگذاری تدریجی قدیمی‌ها */
export async function GET(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const { id } = await params

  const group = await getAccessibleGroup(res.session, id)
  if (!group) return jsonError('گروه یافت نشد یا دسترسی ندارید', 404)

  const permission = await checkGroupSendPermission(res.session, group)
  const canSend = permission.ok

  const sp = req.nextUrl.searchParams
  const result = await loadConversationMessages(
    { subjectGroupId: id },
    { before: sp.get('before'), limit: Number(sp.get('limit') ?? 30) },
  )
  const pinned = await loadPinnedMessages({ subjectGroupId: id })

  return NextResponse.json({
    conversation: {
      key: `group:${group.id}`,
      type: 'GROUP' as const,
      id: group.id,
      title: group.name,
      subtitle: groupSubtitle(group),
      policy: group.messagePolicy,
      archived: !!group.archivedAt,
      lockedForStudents: group.lockedForStudents,
      avatarUrl: group.avatarKey
        ? `/api/groups/${group.id}/avatar?v=${group.avatarUpdatedAt?.getTime() ?? 0}`
        : null,
      canSend,
      cannotSendReason: canSend ? null : permission.reason ?? null,
    },
    ...result,
    pinned,
  })
}

const MAX_BODY = 4000

/** ارسال پیام متنی/پیوست به گروه (با dedupe بر اساس clientId) */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const { id } = await params
  const session = res.session

  const group = await getAccessibleGroup(session, id)
  if (!group) return jsonError('گروه یافت نشد یا دسترسی ندارید', 404)

  const permission = await checkGroupSendPermission(session, group)
  if (!permission.ok) return jsonError(permission.reason ?? 'ارسال مجاز نیست', 403)

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
    const existing = await db.message.findUnique({
      where: { clientId },
    })
    if (existing && existing.subjectGroupId === id) {
      const s = await serializeMessage(existing.id)
      return NextResponse.json({ message: s, duplicate: true }, { status: 200 })
    }
  }

  // پاسخ باید به پیامی در همین گروه باشد
  if (replyToId) {
    const target = await db.message.findFirst({
      where: { id: replyToId, subjectGroupId: id, kind: 'GROUP' },
    })
    if (!target) return jsonError('پیام مورد پاسخ یافت نشد', 400)
  }

  // اعتبارسنجی پیوست (فایل باید از قبل آپلود شده باشد)
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
      kind: 'GROUP',
      subjectGroupId: group.id,
      senderId: session.uid,
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
    rooms: [roomForGroup(group.id)],
    event: 'message:new',
    data: serialized,
  })

  // اعلان پیام گروهی — برای هر عضو فقط یک‌بار؛ پیام‌های خودکار تکلیف/جلسه/نمونه‌سؤال
  // اعلان جداگانه ندارند (اعلان مخصوص خودشان قبلاً ارسال شده است)
  if (!created.assignmentId && !created.liveSessionId && !created.sampleQuestionId) {
    const audience = await effectiveGroupAudience(group)
    const recipients = audience.filter(
      (u) => u.id !== session.uid && u.isActive,
    )
    const muted = await filterMutedUsers(
      recipients.map((u) => u.id),
      'GROUP',
      group.id,
    )
    await pushNotifications(
      recipients
        .filter((u) => !muted.has(u.id))
        .map((u) => ({
          userId: u.id,
          type: 'GROUP_MESSAGE',
          title: `${group.name}`,
          body: `${serialized?.sender.fullName ?? ''}: ${previewOf(created)}`,
          link: `/chats/group/${group.id}`,
          dedupeKey: `msg:${created.id}`,
        })),
    )
  }

  return NextResponse.json({ message: serialized }, { status: 201 })
}
