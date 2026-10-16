import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { serializeMessage, previewOf } from '@/lib/messaging'
import {
  getAccessibleGroup,
  checkGroupSendPermission,
  canDirectMessage,
  getSchoolFeatures,
} from '@/lib/chat-access'
import {
  pushNotifications,
  filterMutedUsers,
  effectiveGroupAudience,
} from '@/lib/notifications'
import { notifySocket, roomForGroup, roomForUser } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

interface ForwardTarget {
  kind: 'GROUP' | 'DIRECT'
  id: string
}

const MAX_TARGETS = 10
/** انواع قابل هدایت — پیام‌های خودکار سیستمی (تکلیف/جلسه/نمونه‌سؤال/اطلاعیه) هدایت نمی‌شوند */
const FORWARDABLE_TYPES = ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE']

/**
 * هدایت پیام به یک یا چند گفتگوی دیگر (گروه/خصوصی)
 * - دسترسی به پیام مبدأ سمت سرور بررسی می‌شود (عضویت واقعی/طرفین گفتگو)
 * - برای هر مقصد، مجوز ارسال همانند ارسال عادی کنترل می‌شود
 * - هر مقصد یک نسخه مستقل با برچسب «هدایت‌شده» دریافت می‌کند
 * - dedupe با clientId قطعی fwd:{source}:{target} — تلاش مجدد هرگز تکراری نمی‌سازد
 */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const source = await db.message.findUnique({
    where: { id },
    include: {
      sender: { select: { id: true, fullName: true } },
      subjectGroup: { select: { classroom: { select: { schoolId: true } } } },
    },
  })
  if (!source) return jsonError('پیام یافت نشد', 404)
  if (source.deletedAt) return jsonError('پیام حذف‌شده قابل هدایت نیست', 400)
  if (!FORWARDABLE_TYPES.includes(source.type)) {
    return jsonError('هدایت این نوع پیام امکان‌پذیر نیست', 400)
  }

  // دسترسی به گفتگوی مبدأ
  if (source.kind === 'GROUP' && source.subjectGroupId) {
    const originGroup = await getAccessibleGroup(session, source.subjectGroupId)
    if (!originGroup) return jsonError('پیام یافت نشد یا دسترسی ندارید', 404)
  } else if (source.kind === 'DIRECT') {
    if (source.senderId !== session.uid && source.recipientId !== session.uid) {
      return jsonError('پیام یافت نشد یا دسترسی ندارید', 404)
    }
  } else {
    return jsonError('پیام یافت نشد', 404)
  }

  const body = await req.json().catch(() => null)
  const rawTargets = Array.isArray(body?.targets) ? body.targets : []
  if (!rawTargets.length) return jsonError('حداقل یک گفتگوی مقصد انتخاب کنید')

  const targets: ForwardTarget[] = []
  for (const t of rawTargets.slice(0, MAX_TARGETS)) {
    const kind = t?.kind === 'DIRECT' ? 'DIRECT' : t?.kind === 'GROUP' ? 'GROUP' : null
    if (!kind || typeof t?.id !== 'string' || !t.id) continue
    targets.push({ kind, id: t.id })
  }
  if (!targets.length) return jsonError('مقاصد نامعتبر هستند')

  // مقاصد تکراری را حذف کن
  const seen = new Set<string>()
  const uniqueTargets = targets.filter((t) => {
    const k = `${t.kind}:${t.id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const results: Array<{
    kind: 'GROUP' | 'DIRECT'
    id: string
    ok: boolean
    error?: string
  }> = []

  for (const target of uniqueTargets) {
    const dedupeClientId = `fwd:${source.id}:${target.kind}:${target.id}`

    try {
      if (target.kind === 'GROUP') {
        const group = await getAccessibleGroup(session, target.id)
        if (!group) {
          results.push({ ...target, ok: false, error: 'گروه یافت نشد یا دسترسی ندارید' })
          continue
        }
        const permission = await checkGroupSendPermission(session, group)
        if (!permission.ok) {
          results.push({ ...target, ok: false, error: permission.reason ?? 'ارسال مجاز نیست' })
          continue
        }

        // dedupe — همان پیام قبلاً به همین گروه هدایت شده است
        const existing = await db.message.findUnique({ where: { clientId: dedupeClientId } })
        if (existing) {
          results.push({ ...target, ok: true })
          continue
        }

        const created = await db.message.create({
          data: {
            kind: 'GROUP',
            subjectGroupId: group.id,
            senderId: session.uid,
            type: source.type,
            body: source.body,
            attachmentName: source.attachmentName,
            attachmentKey: source.attachmentKey,
            attachmentMime: source.attachmentMime,
            attachmentSize: source.attachmentSize,
            attachmentMeta: source.attachmentMeta,
            isForwarded: true,
            forwardedFromName: source.sender.fullName,
            clientId: dedupeClientId,
          },
        })

        const serialized = await serializeMessage(created.id)
        await notifySocket({
          rooms: [roomForGroup(group.id)],
          event: 'message:new',
          data: serialized,
        })

        const audience = await effectiveGroupAudience(group)
        const recipients = audience.filter((u) => u.id !== session.uid && u.isActive)
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
              type: 'GROUP_MESSAGE' as const,
              title: group.name,
              body: `هدایت‌شده از ${source.sender.fullName}: ${previewOf(created)}`,
              link: `/chats/group/${group.id}`,
              dedupeKey: `msg:${created.id}`,
            })),
        )
        results.push({ ...target, ok: true })
      } else {
        // DIRECT
        const allowed = await canDirectMessage(session, target.id)
        if (!allowed.ok) {
          results.push({ ...target, ok: false, error: allowed.reason ?? 'گفتگوی خصوصی مجاز نیست' })
          continue
        }
        const features = await getSchoolFeatures(session.schoolId!)
        if (!features.chat) {
          results.push({ ...target, ok: false, error: 'پیام‌رسانی برای این مدرسه غیرفعال است' })
          continue
        }

        const existing = await db.message.findUnique({ where: { clientId: dedupeClientId } })
        if (existing) {
          results.push({ ...target, ok: true })
          continue
        }

        const created = await db.message.create({
          data: {
            kind: 'DIRECT',
            senderId: session.uid,
            recipientId: target.id,
            type: source.type,
            body: source.body,
            attachmentName: source.attachmentName,
            attachmentKey: source.attachmentKey,
            attachmentMime: source.attachmentMime,
            attachmentSize: source.attachmentSize,
            attachmentMeta: source.attachmentMeta,
            isForwarded: true,
            forwardedFromName: source.sender.fullName,
            clientId: dedupeClientId,
          },
        })

        const serialized = await serializeMessage(created.id)
        await notifySocket({
          rooms: [roomForUser(session.uid), roomForUser(target.id)],
          event: 'message:new',
          data: serialized,
        })

        const recipient = await db.user.findUnique({
          where: { id: target.id },
          select: { isActive: true },
        })
        if (recipient?.isActive) {
          const muted = await filterMutedUsers([target.id], 'DIRECT', session.uid)
          if (!muted.has(target.id)) {
            await pushNotifications([
              {
                userId: target.id,
                type: 'PRIVATE_MESSAGE' as const,
                title: session.fullName,
                body: `هدایت‌شده از ${source.sender.fullName}: ${previewOf(created)}`,
                link: `/chats/dm/${session.uid}`,
                dedupeKey: `msg:${created.id}`,
              },
            ])
          }
        }
        results.push({ ...target, ok: true })
      }
    } catch {
      results.push({ ...target, ok: false, error: 'خطای غیرمنتظره در هدایت' })
    }
  }

  return NextResponse.json({ results })
}
