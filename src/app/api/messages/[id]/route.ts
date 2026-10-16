import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { serializeMessage } from '@/lib/messaging'
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

/** ویرایش پیام — فقط نویسنده */
export async function PATCH(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const message = await db.message.findUnique({ where: { id } })
  if (!message) return jsonError('پیام یافت نشد', 404)
  if (message.deletedAt) return jsonError('پیام حذف شده است', 400)
  if (message.senderId !== session.uid) {
    return jsonError('فقط نویسنده پیام می‌تواند آن را ویرایش کند', 403)
  }

  const body = await req.json().catch(() => null)
  const text = String(body?.body ?? '').trim()
  if (!text) return jsonError('متن پیام نمی‌تواند خالی باشد')
  if (text.length > 4000) return jsonError('متن پیام بیش از حد مجاز است')

  await db.message.update({
    where: { id },
    data: { body: text, editedAt: new Date() },
  })

  const serialized = await serializeMessage(id)
  await notifySocket({
    rooms: roomsForMessage(message),
    event: 'message:updated',
    data: serialized,
  })

  return NextResponse.json({ message: serialized })
}

/** حذف پیام — نویسنده یا مدیر مدرسه */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const message = await db.message.findUnique({
    where: { id },
    include: {
      subjectGroup: {
        select: {
          schoolId: true,
          classroom: { select: { schoolId: true } },
        },
      },
    },
  })
  if (!message) return jsonError('پیام یافت نشد', 404)
  if (message.deletedAt) return NextResponse.json({ ok: true })

  const groupSchool = message.subjectGroup
    ? (message.subjectGroup.classroom?.schoolId ?? message.subjectGroup.schoolId)
    : null

  const isAuthor = message.senderId === session.uid
  const isSchoolAdmin =
    session.role === 'SCHOOL_ADMIN' &&
    ((message.kind === 'GROUP' &&
      groupSchool === session.schoolId) ||
      (message.kind === 'DIRECT' &&
        (message.senderId === session.uid || message.recipientId === session.uid)))

  if (!isAuthor && !isSchoolAdmin) {
    return jsonError('اجازه حذف این پیام را ندارید', 403)
  }

  await db.message.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      body: '',
      attachmentKey: null,
      attachmentName: null,
      attachmentMime: null,
      attachmentSize: null,
    },
  })

  await notifySocket({
    rooms: roomsForMessage(message),
    event: 'message:deleted',
    data: { id, kind: message.kind, subjectGroupId: message.subjectGroupId },
  })

  return NextResponse.json({ ok: true })
}
