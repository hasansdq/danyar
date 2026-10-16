import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { serializeMessage } from '@/lib/messaging'
import { getAccessibleGroup, canDirectMessage } from '@/lib/chat-access'
import { notifySocket, roomForGroup, roomForUser } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

function roomsForMessage(m: {
  kind: string
  subjectGroupId: string | null
  senderId: string
  recipientId: string | null
}): string[] {
  if (m.kind === 'GROUP' && m.subjectGroupId) return [roomForGroup(m.subjectGroupId)]
  const rooms = [roomForUser(m.senderId)]
  if (m.recipientId) rooms.push(roomForUser(m.recipientId))
  return rooms
}

/**
 * سنجاق / برداشتن سنجاق پیام
 * فقط نقش معلم یا مدیر مدرسه — با بررسی دسترسی واقعی به گفتگوی پیام:
 * گروه: معلم فقط در صورت انتساب واقعی به همان گروه، مدیر فقط برای مدرسه خودش
 * خصوصی: فقط طرفین گفتگو
 */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  if (session.role !== 'TEACHER' && session.role !== 'SCHOOL_ADMIN') {
    return jsonError('سنجاق کردن پیام فقط برای معلم و مدیر مدرسه مجاز است', 403)
  }

  const message = await db.message.findUnique({
    where: { id },
    include: {
      subjectGroup: { select: { classroom: { select: { schoolId: true } } } },
    },
  })
  if (!message) return jsonError('پیام یافت نشد', 404)
  if (message.deletedAt) return jsonError('پیام حذف‌شده قابل سنجاق نیست', 400)

  // بررسی دسترسی واقعی به گفتگوی پیام
  if (message.kind === 'GROUP' && message.subjectGroupId) {
    const group = await getAccessibleGroup(session, message.subjectGroupId)
    if (!group) return jsonError('پیام یافت نشد یا دسترسی ندارید', 404)
  } else if (message.kind === 'DIRECT') {
    if (message.senderId !== session.uid && message.recipientId !== session.uid) {
      return jsonError('پیام یافت نشد یا دسترسی ندارید', 404)
    }
    // ماتریس گفتگوی خصوصی نیز باید معتبر بماند
    const peerId =
      message.senderId === session.uid ? message.recipientId : message.senderId
    if (peerId) {
      const allowed = await canDirectMessage(session, peerId)
      if (!allowed.ok) return jsonError('دسترسی به این گفتگو برقرار نیست', 403)
    }
  } else {
    return jsonError('پیام یافت نشد', 404)
  }

  const body = await req.json().catch(() => null)
  const pinned = body?.pinned !== false // پیش‌فرض: سنجاق

  if (pinned && message.pinnedAt) {
    // از قبل سنجاق‌شده — بدون تغییر همان پیام را برگردان
    const s = await serializeMessage(id)
    return NextResponse.json({ message: s, unchanged: true })
  }
  if (!pinned && !message.pinnedAt) {
    const s = await serializeMessage(id)
    return NextResponse.json({ message: s, unchanged: true })
  }

  await db.message.update({
    where: { id },
    data: pinned
      ? { pinnedAt: new Date(), pinnedById: session.uid }
      : { pinnedAt: null, pinnedById: null },
  })

  const serialized = await serializeMessage(id)
  await notifySocket({
    rooms: roomsForMessage(message),
    event: 'message:updated',
    data: serialized,
  })

  return NextResponse.json({ message: serialized })
}
