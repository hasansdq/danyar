import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole } from '@/lib/api-auth'
import {
  listAccessibleGroupIds,
  getSchoolFeatures,
  groupSubtitle,
} from '@/lib/chat-access'
import { previewOf } from '@/lib/messaging'
import { resolveAiStatus } from '@/lib/ai/access'

const AI_STATUS_SUBTITLE: Record<string, string> = {
  OK: 'دستیار هوشمند مدرسه شما',
  NOT_CONFIGURED: 'سرویس پیکربندی نشده — مدیر کل باید تنظیم کند',
  DISABLED_GLOBAL: 'توسط مدیر کل غیرفعال شده',
  DISABLED_SCHOOL: 'برای مدرسه شما غیرفعال است',
  ROLE_NOT_ALLOWED: 'در دسترس نیست',
  SCHOOL_INACTIVE: 'مدرسه غیرفعال است',
  QUOTA_EXHAUSTED: 'سهمیه امروز تمام شده',
}

/** فهرست گفتگوها: گروه‌های درسی + گفتگوهای خصوصی با آخرین پیام و تعداد نخوانده */
type ChatLastMessage = {
  preview: string
  at: string
  senderName: string
  mine: boolean
  read?: boolean
} | null

type ChatListItem = {
  key: string
  type: 'GROUP' | 'DM' | 'ASSISTANT'
  id: string
  title: string
  subtitle?: string
  teachers?: string[]
  archived?: boolean
  policy?: string
  lastMessage: ChatLastMessage
  unread: number
}

export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const uid = session.uid

  const groupIds = await listAccessibleGroupIds(session)
  const features = await getSchoolFeatures(session.schoolId)

  const groups = groupIds.length
    ? await db.subjectGroup.findMany({
        where: { id: { in: groupIds } },
        include: {
          classroom: { select: { name: true } },
          teachingAssignments: {
            select: { teacher: { select: { fullName: true } } },
          },
          _count: { select: { readStates: true } },
        },
      })
    : []

  // آخرین پیام و تعداد نخوانده هر گروه
  const readStates = await db.groupReadState.findMany({
    where: { userId: uid, subjectGroupId: { in: groupIds } },
  })
  const readMap = new Map(readStates.map((r) => [r.subjectGroupId, r.lastReadAt]))

  const groupChats: ChatListItem[] = await Promise.all(
    groups.map(async (g) => {
      const last = await db.message.findFirst({
        where: { subjectGroupId: g.id },
        orderBy: { createdAt: 'desc' },
        include: { sender: { select: { id: true, fullName: true } } },
      })
      const lastReadAt = readMap.get(g.id) ?? new Date(0)
      const unread = await db.message.count({
        where: {
          subjectGroupId: g.id,
          senderId: { not: uid },
          deletedAt: null,
          createdAt: { gt: lastReadAt },
        },
      })
      return {
        key: `group:${g.id}`,
        type: 'GROUP' as const,
        id: g.id,
        title: g.name,
        subtitle: groupSubtitle(g),
        teachers: g.teachingAssignments.map((t) => t.teacher.fullName),
        archived: !!g.archivedAt,
        policy: g.messagePolicy,
        lastMessage: last
          ? {
              preview: previewOf(last),
              at: last.createdAt.toISOString(),
              senderName: last.sender.fullName,
              mine: last.senderId === uid,
            }
          : null,
        unread,
      }
    }),
  )

  // ─── گفتگوهای خصوصی ───
  const peersResult = (await db.$queryRawUnsafe(
    `SELECT DISTINCT "recipientId" AS peer FROM Message WHERE kind='DIRECT' AND "senderId" = ? AND "recipientId" IS NOT NULL
     UNION
     SELECT DISTINCT "senderId" AS peer FROM Message WHERE kind='DIRECT' AND "recipientId" = ?`,
    uid,
    uid,
  )) as { peer: string }[]

  const peerIds = peersResult.map((r) => r.peer)
  const peers = peerIds.length
    ? await db.user.findMany({
        where: { id: { in: peerIds } },
        select: { id: true, fullName: true, role: true, isActive: true },
      })
    : []

  const dmChats: ChatListItem[] = []
  for (const p of peers) {
    if (!p.isActive) continue
    const last = await db.message.findFirst({
      where: {
        kind: 'DIRECT',
        OR: [
          { senderId: uid, recipientId: p.id },
          { senderId: p.id, recipientId: uid },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { sender: { select: { id: true, fullName: true } } },
    })
    const unread = await db.message.count({
      where: {
        kind: 'DIRECT',
        senderId: p.id,
        recipientId: uid,
        readAt: null,
        deletedAt: null,
      },
    })
    dmChats.push({
      key: `dm:${p.id}`,
      type: 'DM' as const,
      id: p.id,
      title: p.fullName,
      subtitle: p.role === 'SCHOOL_ADMIN' ? 'مدیر مدرسه' : p.role === 'SCHOOL_VICE' ? 'معاون مدرسه' : p.role === 'TEACHER' ? 'معلم' : 'دانش‌آموز',
      lastMessage: last
        ? {
            preview: previewOf(last),
            at: last.createdAt.toISOString(),
            senderName: last.sender.fullName,
            mine: last.senderId === uid,
            read: last.senderId === uid ? !!last.readAt : true,
          }
        : null,
      unread,
    })
  }

  const conversations = [...groupChats, ...dmChats]
    .filter((c) => (c.type === 'DM' ? features.dm || c.lastMessage !== null : true))

  // ─── گفتگوی اختصاصی «دستیار دانیار» — فقط مدیر مدرسه ───
  if (session.role === 'SCHOOL_ADMIN') {
    const aiStatus = await resolveAiStatus(session)
    const lastConv = await db.aiConversation.findFirst({
      where: { userId: uid },
      orderBy: { updatedAt: 'desc' },
      select: {
        updatedAt: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { role: true, content: true, createdAt: true } },
      },
    })
    const lastAi = lastConv?.messages[0] ?? null
    conversations.push({
      key: 'assistant',
      type: 'ASSISTANT' as const,
      id: 'assistant',
      title: 'دستیار دانیار',
      subtitle: AI_STATUS_SUBTITLE[aiStatus.code] ?? 'دستیار هوشمند',
      unread: 0,
      lastMessage: lastAi
        ? {
            preview: (lastAi.role === 'ASSISTANT' ? '' : 'شما: ') + lastAi.content.replace(/\s+/g, ' ').slice(0, 70),
            at: lastAi.createdAt.toISOString(),
            senderName: 'دستیار دانیار',
            mine: lastAi.role === 'USER',
          }
        : null,
    })
  }

  conversations.sort((a, b) => {
    const ta = a.lastMessage ? Date.parse(a.lastMessage.at) : 0
    const tb = b.lastMessage ? Date.parse(b.lastMessage.at) : 0
    if (tb !== ta) return tb - ta
    return a.title.localeCompare(b.title, 'fa')
  })

  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0)

  return NextResponse.json({
    conversations,
    totalUnread,
    features,
    role: session.role,
  })
}
