import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

/** پیش‌نمایش متنی پیام برای فهرست گفتگوها */
export function previewOf(m: {
  type: string
  body: string
  deletedAt: Date | null
}): string {
  if (m.deletedAt) return 'این پیام حذف شد'
  switch (m.type) {
    case 'IMAGE':
      return '📷 تصویر' + (m.body ? ` — ${m.body}` : '')
    case 'AUDIO':
      return '🎤 پیام صوتی' + (m.body ? ` — ${m.body}` : '')
    case 'VIDEO':
      return '🎬 ویدئو' + (m.body ? ` — ${m.body}` : '')
    case 'FILE':
      return '📎 فایل' + (m.body ? ` — ${m.body}` : '')
    case 'ANNOUNCEMENT':
      return '📢 اطلاعیه' + (m.body ? ` — ${m.body}` : '')
    case 'ASSIGNMENT':
      return '📋 تکلیف' + (m.body ? ` — ${m.body}` : '')
    case 'LIVE_INVITE':
      return '🎥 کلاس آنلاین' + (m.body ? ` — ${m.body}` : '')
    case 'SAMPLEQ':
      return '📝 نمونه‌سؤال' + (m.body ? ` — ${m.body}` : '')
    default:
      return m.body
  }
}

const messageInclude = {
  sender: { select: { id: true, fullName: true, role: true } },
  replyTo: {
    select: {
      id: true,
      body: true,
      type: true,
      deletedAt: true,
      sender: { select: { fullName: true } },
    },
  },
} satisfies Prisma.MessageInclude

/**
 * تجزیه امن فراداده پیوست (پیام ویس): { duration, waveform }
 * خروجی فقط عدد/آرایه اعداد بین ۰ و ۱ است — داده خراب بی‌صدا نادیده گرفته می‌شود
 */
export function parseAttachmentMeta(
  raw: string | null,
): { duration: number | null; waveform: number[] | null } {
  if (!raw) return { duration: null, waveform: null }
  try {
    const obj = JSON.parse(raw) as { duration?: unknown; waveform?: unknown }
    const duration =
      typeof obj.duration === 'number' && isFinite(obj.duration) && obj.duration > 0
        ? Math.min(Math.round(obj.duration * 10) / 10, 3600)
        : null
    const waveform = Array.isArray(obj.waveform)
      ? obj.waveform
          .filter((v): v is number => typeof v === 'number' && isFinite(v) && v >= 0)
          .slice(0, 64)
          .map((v) => Math.min(1, Math.round(v * 100) / 100))
      : null
    return {
      duration,
      waveform: waveform && waveform.length >= 4 ? waveform : null,
    }
  } catch {
    return { duration: null, waveform: null }
  }
}

/**
 * اعتبارسنجی و ذخیره‌سازی امن فراداده پیام ویس از ورودی کلاینت
 * duration: ثانیه (۰ تا ۳۶۰۰) — waveform: حداکثر ۶۴ عدد ۰ تا ۱
 * خروجی: رشته JSON برای ستون attachmentMeta (null = بدون متا)
 */
export function sanitizeVoiceMeta(
  duration: unknown,
  waveform: unknown,
): string | null {
  const d =
    typeof duration === 'number' && isFinite(duration) && duration > 0
      ? Math.min(Math.round(duration * 10) / 10, 3600)
      : null
  const wf = Array.isArray(waveform)
    ? waveform
        .filter((v): v is number => typeof v === 'number' && isFinite(v) && v >= 0)
        .slice(0, 64)
        .map((v) => Math.min(1, Math.round(v * 100) / 100))
    : []
  if (d === null && wf.length < 4) return null
  return JSON.stringify({
    ...(d !== null ? { duration: d } : {}),
    ...(wf.length >= 4 ? { waveform: wf } : {}),
  })
}

/** پیش‌نمایش کوتاه پیام برای نوار سنجاق‌شده‌ها */
export function pinPreviewOf(m: {
  type: string
  body: string
  deletedAt: Date | null
}): string {
  if (m.deletedAt) return 'این پیام حذف شد'
  return previewOf(m)
}

export type SerializedMessage = ReturnType<typeof serializeMessageShape>

/**
 * عنوان مرجع پیام‌های خودکار (تکلیف/نمونه‌سؤال) — برای نوار سنجاق و جست‌وجو.
 * خروجی با فیلد refTitle به هر پیام افزوده می‌شود.
 */
async function refTitleMaps(
  rows: { assignmentId?: string | null; sampleQuestionId?: string | null }[],
): Promise<{ aMap: Map<string, string>; sMap: Map<string, string> }> {
  const aIds = [
    ...new Set(rows.map((r) => r.assignmentId).filter((v): v is string => !!v)),
  ]
  const sIds = [
    ...new Set(rows.map((r) => r.sampleQuestionId).filter((v): v is string => !!v)),
  ]
  const [assignments, sampleqs] = await Promise.all([
    aIds.length
      ? db.assignment.findMany({ where: { id: { in: aIds } }, select: { id: true, title: true } })
      : Promise.resolve([] as { id: string; title: string }[]),
    sIds.length
      ? db.sampleQuestion.findMany({ where: { id: { in: sIds } }, select: { id: true, title: true } })
      : Promise.resolve([] as { id: string; title: string }[]),
  ])
  return {
    aMap: new Map(assignments.map((a) => [a.id, a.title])),
    sMap: new Map(sampleqs.map((s) => [s.id, s.title])),
  }
}

/** افزودن refTitle به پیام‌های سریال‌شده (تکلیف/نمونه‌سؤال مرتبط) */
export async function attachRefTitles<
  T extends {
    assignmentId?: string | null
    sampleQuestionId?: string | null
    refTitle?: string | null
  },
>(list: T[]): Promise<T[]> {
  if (!list.length) return list
  const { aMap, sMap } = await refTitleMaps(list)
  return list.map((m) => ({
    ...m,
    refTitle: m.assignmentId
      ? (aMap.get(m.assignmentId) ?? null)
      : m.sampleQuestionId
        ? (sMap.get(m.sampleQuestionId) ?? null)
        : null,
  }))
}

export function serializeMessageShape(
  m: Prisma.MessageGetPayload<{ include: typeof messageInclude }>,
) {
  const reply = m.replyTo
  return {
    id: m.id,
    kind: m.kind,
    subjectGroupId: m.subjectGroupId,
    recipientId: m.recipientId,
    type: m.isAnnouncement ? 'ANNOUNCEMENT' : m.type,
    body: m.deletedAt ? '' : m.body,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    readAt: m.readAt?.toISOString() ?? null,
    isAnnouncement: m.isAnnouncement,
    assignmentId: m.assignmentId,
    liveSessionId: m.liveSessionId,
    sampleQuestionId: m.sampleQuestionId,
    clientId: m.clientId,
    isForwarded: m.isForwarded,
    forwardedFromName: m.forwardedFromName,
    pinnedAt: m.pinnedAt?.toISOString() ?? null,
    refTitle: null as string | null,
    sender: m.sender,
    replyTo: m.replyToId && reply
      ? {
          id: reply.id,
          body: reply.deletedAt ? '' : reply.body,
          type: reply.type,
          deletedAt: !!reply.deletedAt,
          senderName: reply.sender.fullName,
        }
      : null,
    attachment:
      m.attachmentKey && !m.deletedAt
        ? {
            url: `/api/attachments/${m.id}`,
            name: m.attachmentName ?? 'فایل',
            mime: m.attachmentMime ?? 'application/octet-stream',
            size: m.attachmentSize ?? 0,
            ...(m.type === 'AUDIO' ? parseAttachmentMeta(m.attachmentMeta) : {}),
          }
        : null,
  }
}

export async function serializeMessage(id: string) {
  const m = await db.message.findUnique({
    where: { id },
    include: messageInclude,
  })
  if (!m) return null
  const [s] = await attachRefTitles([serializeMessageShape(m)])
  return s
}

/**
 * پیام‌های سنجاق‌شده یک گفتگو (برای نوار بالای چت)
 * تا سقف ۲۰ مورد، جدیدترین سنجاق اول
 */
export async function loadPinnedMessages(
  where: Prisma.MessageWhereInput,
) {
  const rows = await db.message.findMany({
    where: { ...where, pinnedAt: { not: null }, deletedAt: null },
    orderBy: { pinnedAt: 'desc' },
    take: 20,
    include: messageInclude,
  })
  return attachRefTitles(rows.map(serializeMessageShape))
}

export type { Prisma }

/**
 * دریافت پیام‌های یک گفتگو با صفحه‌بندی تدریجی (پیام‌های قدیمی‌تر)
 * before: تاریخ ISO — فقط پیام‌های قدیمی‌تر از آن
 */
export async function loadConversationMessages(
  where: Prisma.MessageWhereInput,
  opts: { before?: string | null; limit?: number },
) {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 50)
  const beforeDate = opts.before ? new Date(opts.before) : null
  const validBefore = beforeDate && !isNaN(beforeDate.getTime()) ? beforeDate : null

  const rows = await db.message.findMany({
    where: {
      ...where,
      ...(validBefore ? { createdAt: { lt: validBefore } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: messageInclude,
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return {
    messages: page.reverse().map(serializeMessageShape),
    hasMore,
    oldestCreatedAt: page.length ? page[0].createdAt.toISOString() : null,
  }
}
