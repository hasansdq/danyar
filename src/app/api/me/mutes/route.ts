import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, jsonError } from '@/lib/api-auth'

/**
 * GET /api/me/mutes — فهرست گفتگوهای بی‌صدا با عنوان
 * PUT /api/me/mutes — بی‌صدا/صدادار کردن گروه یا گفتگوی خصوصی
 */

export async function GET() {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session

  const mutes = await db.mutedChat.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: 'desc' },
  })

  const groupIds = mutes.filter((m) => m.chatType === 'GROUP').map((m) => m.chatKey)
  const peerIds = mutes.filter((m) => m.chatType === 'DIRECT').map((m) => m.chatKey)

  const [groups, peers] = await Promise.all([
    groupIds.length
      ? db.subjectGroup.findMany({
          where: { id: { in: groupIds } },
          select: {
            id: true,
            name: true,
            scope: true,
            grade: true,
            schoolId: true,
            classroom: { select: { name: true, schoolId: true } },
          },
        })
      : Promise.resolve([]),
    peerIds.length
      ? db.user.findMany({
          where: { id: { in: peerIds }, schoolId: session.schoolId },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ])

  const items = mutes
    .map((m) => {
      if (m.chatType === 'GROUP') {
        const g = groups.find((x) => x.id === m.chatKey)
        if (!g) return null
        const school = g.classroom?.schoolId ?? g.schoolId
        if (school !== session.schoolId) return null
        const subtitle =
          g.scope === 'SCHOOL_STAFF'
            ? 'گروه همکاران مدرسه'
            : g.scope === 'SCHOOL_ALL'
              ? 'گروه عمومی مدرسه'
              : g.scope === 'GRADE'
                ? `گروه پایه ${g.grade ?? ''}`.trim()
                : g.classroom?.name ?? ''
        return {
          chatType: m.chatType,
          chatKey: m.chatKey,
          title: g.name,
          subtitle,
        }
      }
      const p = peers.find((x) => x.id === m.chatKey)
      if (!p) return null
      return { chatType: m.chatType, chatKey: m.chatKey, title: p.fullName, subtitle: 'گفتگوی خصوصی' }
    })
    .filter(Boolean)

  return NextResponse.json({ items })
}

export async function PUT(req: NextRequest) {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session

  const body = await req.json().catch(() => null)
  const chatType = body?.chatType === 'GROUP' ? 'GROUP' : body?.chatType === 'DIRECT' ? 'DIRECT' : null
  const chatKey = body?.chatKey ? String(body.chatKey) : null
  if (!chatType || !chatKey) return jsonError('نوع یا شناسه گفتگو نامعتبر است')

  // بررسی دسترسی واقعی به گفتگو پیش از بی‌صدا کردن
  if (chatType === 'GROUP') {
    const group = await db.subjectGroup.findUnique({
      where: { id: chatKey },
      select: { schoolId: true, classroom: { select: { schoolId: true } } },
    })
    const school = group ? (group.classroom?.schoolId ?? group.schoolId) : null
    if (!group || school !== session.schoolId) {
      return jsonError('گروه یافت نشد یا دسترسی ندارید', 404)
    }
  } else {
    const peer = await db.user.findUnique({ where: { id: chatKey }, select: { schoolId: true } })
    if (!peer || peer.schoolId !== session.schoolId) {
      return jsonError('کاربر یافت نشد یا دسترسی ندارید', 404)
    }
  }

  if (body.muted) {
    await db.mutedChat.upsert({
      where: { userId_chatType_chatKey: { userId: session.uid, chatType, chatKey } },
      create: { userId: session.uid, chatType, chatKey },
      update: {},
    })
  } else {
    await db.mutedChat.deleteMany({
      where: { userId: session.uid, chatType, chatKey },
    })
  }

  return NextResponse.json({ ok: true, muted: !!body.muted })
}
