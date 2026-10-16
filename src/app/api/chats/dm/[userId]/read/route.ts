import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { canDirectMessage } from '@/lib/chat-access'
import { notifySocket, roomForUser } from '@/lib/notify'

type Params = { params: Promise<{ userId: string }> }

/** علامت‌گذاری گفتگوی خصوصی به‌عنوان خوانده‌شده + اطلاع به فرستنده */
export async function POST(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { userId } = await params

  const peer = await db.user.findFirst({
    where: { id: userId, schoolId: session.schoolId },
    select: { id: true },
  })
  if (!peer) return jsonError('کاربر یافت نشد', 404)

  const allowed = await canDirectMessage(session, userId)
  if (!allowed.ok) return jsonError(allowed.reason ?? 'دسترسی غیرمجاز', 403)

  const readAt = new Date()
  const updated = await db.message.updateMany({
    where: {
      kind: 'DIRECT',
      senderId: userId,
      recipientId: session.uid,
      readAt: null,
      deletedAt: null,
    },
    data: { readAt },
  })

  if (updated.count > 0) {
    await notifySocket({
      rooms: [roomForUser(userId)],
      event: 'dm:read',
      data: { readerId: session.uid, readAt: readAt.toISOString() },
    })
  }

  return NextResponse.json({ ok: true, count: updated.count })
}
