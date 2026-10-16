import webpush from 'web-push'
import https from 'node:https'
import { db } from '@/lib/db'
import { parseFeatures } from '@/lib/features'
import { effectiveGroupAudience } from '@/lib/group-audience'
import {
  categoryOfNotificationType,
  parsePushEventTypes,
  type PushEventCategory,
} from '@/lib/push-types'

/**
 * هسته پوش نوتیفیکیشن واقعی مرورگر (Web Push).
 * - صف ارسال روی دیتابیس (PushDelivery) با ضدتکرار قطعی subscription×notification
 * - مسیر اصلی ثبت پیام/تکلیف را کند نمی‌کند (صف پس از پاسخ با after() پردازش می‌شود)
 * - تلاش مجدد محدود برای خطاهای موقت؛ پاک‌سازی اشتراک 404/410
 * - خطای پوش هرگز ثبت رویداد اصلی را شکست نمی‌دهد
 * - در لاگ‌ها فقط خطای غیرمحرمانه؛ بدون متن پیام/کلید/endpoint
 */

const RETRY_BASE_SECONDS = Math.max(1, Number(process.env.PUSH_RETRY_BASE_SECONDS ?? 45))
const MAX_ATTEMPTS = Math.max(1, Number(process.env.PUSH_MAX_ATTEMPTS ?? 3))
const TTL_MINUTES = Math.max(0.05, Number(process.env.PUSH_TTL_MINUTES ?? 15))
const QUEUE_BATCH = 200

// ─── وضعیت VAPID ───

export interface VapidStatus {
  configured: boolean
  /** فقط کلید عمومی — کلید خصوصی هرگز از این ماژول خارج نمی‌شود */
  publicKey: string | null
  subject: string | null
}

export function getVapidStatus(): VapidStatus {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? ''
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? ''
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost'
  const configured = publicKey.length > 0 && privateKey.length > 0
  return { configured, publicKey: configured ? publicKey : null, subject }
}

function vapidOptions() {
  const s = getVapidStatus()
  if (!s.configured) return null
  return {
    publicKey: s.publicKey!,
    privateKey: process.env.VAPID_PRIVATE_KEY!,
    subject: s.subject!,
  }
}

/**
 * گزینه‌های ارسال web-push.
 * PUSH_ALLOW_INSECURE_TLS=1 فقط برای شبیه‌ساز آزمون داخلی با گواهی خودامضا است —
 * در استقرار واقعی هرگز فعال نمی‌شود (کلاینت‌های پوش واقعی HTTPS معتبر دارند).
 */
function pushRequestOptions(
  vapid: NonNullable<ReturnType<typeof vapidOptions>>,
  extra: { TTL: number; urgency?: string },
) {
  const opts: Record<string, unknown> = { vapidDetails: vapid, ...extra }
  if (process.env.PUSH_ALLOW_INSECURE_TLS === '1') {
    opts.agent = new https.Agent({ rejectUnauthorized: false })
  }
  return opts as webpush.RequestOptions
}

// ─── کلیدهای سوییچ پلتفرم/مدرسه ───

export async function getPushConfig() {
  const existing = await db.pushConfig.findUnique({ where: { id: 1 } })
  if (existing) return existing
  try {
    return await db.pushConfig.create({ data: { id: 1 } })
  } catch {
    const again = await db.pushConfig.findUnique({ where: { id: 1 } })
    if (again) return again
    throw new Error('push config unavailable')
  }
}

/** پوش برای مدرسه فعال است؟ (مدرسه فعال + پرچم push در features) */
export async function schoolPushAllowed(schoolId: string | null): Promise<boolean> {
  if (!schoolId) return false
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { isActive: true, features: true },
  })
  if (!school || !school.isActive) return false
  return parseFeatures(school.features).push
}

// ─── صف: ثبت کار ارسال پس از ساخت اعلان ───

export interface EnqueueRow {
  notificationId: string
  userId: string
  type: string
}

/** برای هر ردیف اعلان تازه و هر اشتراک فعال کاربر، یک کار PENDING ثبت می‌کند */
export async function enqueuePushForNotifications(rows: EnqueueRow[]): Promise<number> {
  if (!rows.length) return 0
  if (!getVapidStatus().configured) return 0

  const userIds = [...new Set(rows.map((r) => r.userId))]
  const subs = await db.pushSubscription.findMany({
    where: { userId: { in: userIds }, enabled: true },
    select: { id: true, userId: true },
  })
  if (!subs.length) return 0

  const notificationIds = rows.map((r) => r.notificationId)
  const existing = await db.pushDelivery.findMany({
    where: { subscriptionId: { in: subs.map((s) => s.id) }, notificationId: { in: notificationIds } },
    select: { subscriptionId: true, notificationId: true },
  })
  const have = new Set(existing.map((e) => `${e.subscriptionId}:${e.notificationId}`))

  const data: { subscriptionId: string; notificationId: string; type: string }[] = []
  for (const s of subs) {
    for (const r of rows) {
      if (r.userId !== s.userId) continue
      if (have.has(`${s.id}:${r.notificationId}`)) continue
      data.push({ subscriptionId: s.id, notificationId: r.notificationId, type: r.type })
    }
  }
  if (!data.length) return 0
  await db.pushDelivery.createMany({ data }).catch(() => null)
  return data.length
}

// ─── محتوای اعلان ───

/** کلید گفتگو برای جلوگیری از اعلان وقتی همان گفتگو باز است + tag تجمیع */
export function conversationKeyOf(link: string | null | undefined): string | null {
  if (!link) return null
  const m = link.match(/^\/chats\/(dm|group)\/([A-Za-z0-9_-]+)/)
  if (m) return `${m[1] === 'dm' ? 'dm' : 'group'}:${m[2]}`
  return null
}

interface PushContent {
  title: string
  body: string
}

/**
 * ساخت محتوای اعلان با رعایت حریم خصوصی:
 * پیش‌فرض هیچ متن خصوصی (متن پیام، بازخورد، وضعیت حضور) روی صفحه قفل نمایش داده نمی‌شود؛
 * پیش‌نمایش فقط با انتخاب صریح کاربر فعال می‌شود.
 */
export function buildPushContent(type: string, title: string, body: string, preview: boolean): PushContent {
  switch (type) {
    case 'PRIVATE_MESSAGE':
      return {
        title: 'پیام خصوصی جدید',
        body: preview ? `${title}: ${body}`.slice(0, 200) : 'یک پیام خصوصی جدید دارید',
      }
    case 'GROUP_MESSAGE':
      return {
        title: `گروه «${title}»`,
        body: preview ? body.slice(0, 200) : 'یک پیام جدید در گروه منتشر شد',
      }
    case 'FEEDBACK_POSTED':
      return {
        title: 'بازخورد تکلیف',
        body: preview ? body.slice(0, 200) : 'بازخورد جدیدی برای تکلیف شما ثبت شد',
      }
    case 'ATTENDANCE_FINALIZED':
    case 'ATTENDANCE_CORRECTION':
      return {
        title: 'حضور و غیاب',
        body: preview ? body.slice(0, 200) : 'وضعیت حضور و غیاب شما به‌روزرسانی شد',
      }
    case 'SCHOOL_ANNOUNCEMENT':
      return {
        title: 'اطلاعیه مدرسه',
        body: preview ? body.slice(0, 200) : 'اطلاعیه جدیدی منتشر شد',
      }
    case 'ADMIN_BROADCAST':
      // اطلاع‌رسانی رسمی مدیر پلتفرم — محتوای عمومی است
      return { title: title.slice(0, 120), body: (body || 'پیام جدید از مدیر دانیار').slice(0, 200) }
    default:
      // تکلیف، کلاس آنلاین و نمونه‌سؤال محتوای عمومی کلاس دارند
      return { title: title.slice(0, 120), body: (body || 'برای مشاهده وارد دانیار شوید').slice(0, 200) }
  }
}

// ─── بررسی مجوز مخاطب در زمان ارسال ───

interface AuthzContext {
  platformOn: boolean
  userCache: Map<string, { ok: boolean; reason: string; schoolId: string | null }>
  audienceCache: Map<string, Set<string>>
  prefTypes: Map<string, Set<PushEventCategory>>
}

async function authorizeRecipient(
  n: { type: string; link: string | null; dedupeKey: string | null },
  userId: string,
  ctx: AuthzContext,
): Promise<{ ok: boolean; reason?: string }> {
  // ۱) کاربر و مدرسه
  let u = ctx.userCache.get(userId)
  if (!u) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { isActive: true, schoolId: true, school: { select: { isActive: true, features: true } } },
    })
    if (!user || !user.isActive) u = { ok: false, reason: 'USER_INACTIVE', schoolId: user?.schoolId ?? null }
    else if (!user.schoolId || !user.school) u = { ok: false, reason: 'NO_SCHOOL', schoolId: null }
    else if (!user.school.isActive) u = { ok: false, reason: 'SCHOOL_INACTIVE', schoolId: user.schoolId }
    else if (!parseFeatures(user.school.features).push)
      u = { ok: false, reason: 'SCHOOL_PUSH_OFF', schoolId: user.schoolId }
    else u = { ok: true, reason: '', schoolId: user.schoolId }
    ctx.userCache.set(userId, u)
  }
  if (!u.ok) return u

  // ۲) دسته رویداد انتخابی کاربر
  const cat = categoryOfNotificationType(n.type)
  if (!cat) return { ok: false, reason: 'UNKNOWN_TYPE' }
  let types = ctx.prefTypes.get(userId)
  if (!types) {
    const pref = await db.notificationPref.findUnique({ where: { userId }, select: { pushEventTypes: true } })
    types = parsePushEventTypes(pref?.pushEventTypes)
    ctx.prefTypes.set(userId, types)
  }
  if (!types.has(cat)) return { ok: false, reason: 'EVENT_TYPE_OFF' }

  // ۳) عضویت/دسترسی واقعی در لحظه ارسال (بر اساس لینک اعلان)
  const link = n.link ?? ''
  const idAt = (prefix: string): string | null => {
    if (!link.startsWith(prefix)) return null
    const rest = link.slice(prefix.length).split(/[?#]/)[0]
    return rest || null
  }

  const memberOfAudience = async (group: {
    id: string
    scope: string
    grade: string | null
    classroomId: string | null
    schoolId: string | null
    classroom?: { schoolId: string } | null
  }) => {
    const key = `${group.id}`
    let set = ctx.audienceCache.get(key)
    if (!set) {
      const audience = await effectiveGroupAudience(group)
      set = new Set(audience.map((a) => a.id))
      ctx.audienceCache.set(key, set)
    }
    return set.has(userId)
  }

  const dmPeer = idAt('/chats/dm/')
  if (n.type === 'PRIVATE_MESSAGE' && dmPeer) {
    // گیرنده و فرستنده باید هر دو فعال و هم‌مدرسه بمانند
    const peer = await db.user.findUnique({
      where: { id: dmPeer },
      select: { isActive: true, schoolId: true },
    })
    if (!peer || !peer.isActive) return { ok: false, reason: 'PEER_GONE' }
    const mySchool = ctx.userCache.get(userId)?.schoolId ?? null
    if (!mySchool || peer.schoolId !== mySchool) return { ok: false, reason: 'PEER_SCHOOL_CHANGED' }
    return { ok: true }
  }

  const groupId = idAt('/chats/group/')
  if (groupId && (n.type === 'GROUP_MESSAGE' || n.type === 'SCHOOL_ANNOUNCEMENT')) {
    const group = await db.subjectGroup.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        scope: true,
        grade: true,
        classroomId: true,
        schoolId: true,
        classroom: { select: { schoolId: true } },
      },
    })
    if (!group) return { ok: false, reason: 'GROUP_GONE' }
    const member = await memberOfAudience(group)
    return member ? { ok: true } : { ok: false, reason: 'NOT_MEMBER' }
  }

  const assignmentId = idAt('/assignments/')
  if (assignmentId && n.type === 'ASSIGNMENT_NEW') {
    const a = await db.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        subjectGroupId: true,
        subjectGroup: {
          select: {
            id: true,
            scope: true,
            grade: true,
            classroomId: true,
            schoolId: true,
            classroom: { select: { schoolId: true } },
          },
        },
      },
    })
    if (!a) return { ok: false, reason: 'ASSIGNMENT_GONE' }
    const member = await memberOfAudience(a.subjectGroup)
    return member ? { ok: true } : { ok: false, reason: 'NOT_MEMBER' }
  }

  if (assignmentId && n.type === 'FEEDBACK_POSTED') {
    const s = await db.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: userId } },
      select: { id: true },
    })
    return s ? { ok: true } : { ok: false, reason: 'SUBMISSION_GONE' }
  }

  const liveId = idAt('/live/')
  if (liveId && n.type === 'LIVE_SESSION_NEW') {
    const s = await db.liveSession.findUnique({
      where: { id: liveId },
      select: {
        status: true,
        notifyGroupId: true,
        classroomId: true,
        classroom: { select: { schoolId: true } },
      },
    })
    if (!s) return { ok: false, reason: 'SESSION_GONE' }
    if (s.status !== 'ACTIVE') return { ok: false, reason: 'SESSION_ENDED' }
    if (s.notifyGroupId) {
      const g = await db.subjectGroup.findUnique({
        where: { id: s.notifyGroupId },
        select: {
          id: true,
          scope: true,
          grade: true,
          classroomId: true,
          schoolId: true,
          classroom: { select: { schoolId: true } },
        },
      })
      if (g) {
        const member = await memberOfAudience(g)
        return member ? { ok: true } : { ok: false, reason: 'NOT_MEMBER' }
      }
    }
    const enrolled = await db.classroomEnrollment.findFirst({
      where: { classroomId: s.classroomId, studentId: userId },
      select: { id: true },
    })
    return enrolled ? { ok: true } : { ok: false, reason: 'NOT_MEMBER' }
  }

  const sampleqId = idAt('/sample-questions/')
  if (sampleqId && n.type === 'SAMPLEQ_NEW') {
    const q = await db.sampleQuestion.findUnique({
      where: { id: sampleqId },
      select: { status: true, classes: { select: { classroomId: true } } },
    })
    if (!q) return { ok: false, reason: 'SAMPLEQ_GONE' }
    if (q.status !== 'PUBLISHED') return { ok: false, reason: 'UNPUBLISHED' }
    const enrolled = await db.classroomEnrollment.findFirst({
      where: { studentId: userId, classroomId: { in: q.classes.map((c) => c.classroomId) } },
      select: { id: true },
    })
    return enrolled ? { ok: true } : { ok: false, reason: 'NOT_MEMBER' }
  }

  if (n.type === 'ATTENDANCE_FINALIZED' || n.type === 'ATTENDANCE_CORRECTION') {
    // شناسه جلسه از dedupeKey (att-final:{sessionId}:{userId} یا att-corr:{sessionId}:{userId}:{seq})
    const parts = (n.dedupeKey ?? '').split(':')
    const sessionId = parts.length >= 3 && parts[0].startsWith('att-') ? parts[1] : null
    if (sessionId) {
      const session = await db.attendanceSession.findUnique({
        where: { id: sessionId },
        select: { classroomId: true, status: true },
      })
      if (!session) return { ok: false, reason: 'SESSION_GONE' }
      if (session.status !== 'FINALIZED') return { ok: false, reason: 'NOT_FINALIZED' }
      const enrolled = await db.classroomEnrollment.findFirst({
        where: { classroomId: session.classroomId, studentId: userId },
        select: { id: true },
      })
      return enrolled ? { ok: true } : { ok: false, reason: 'NOT_MEMBER' }
    }
    return { ok: true } // بدون کلید قابل تحلیل، بررسی پایه کافی است
  }

  return { ok: true }
}

// ─── پردازش صف ───

export async function processPushQueue(limit = QUEUE_BATCH): Promise<void> {
  const vapid = vapidOptions()
  if (!vapid) return

  const now = new Date()
  const jobs = await db.pushDelivery.findMany({
    where: {
      status: 'PENDING',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    include: { notification: true, subscription: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  if (!jobs.length) return

  const ttlMs = TTL_MINUTES * 60_000
  const ctx: AuthzContext = {
    platformOn: true,
    userCache: new Map(),
    audienceCache: new Map(),
    prefTypes: new Map(),
  }

  for (const job of jobs) {
    const n = job.notification
    const sub = job.subscription

    // اعلان‌های قدیمی و نامرتبط پس از تأخیر طولانی ارسال نمی‌شوند
    if (now.getTime() - job.createdAt.getTime() > ttlMs) {
      await db.pushDelivery
        .update({ where: { id: job.id }, data: { status: 'EXPIRED', lastError: 'TTL_EXPIRED' } })
        .catch(() => null)
      continue
    }

    // کلید پلتفرم در هر کار دوباره خوانده می‌شود تا خاموشی فوری اعمال شود
    let platformOn: boolean
    try {
      platformOn = (await getPushConfig()).platformEnabled
    } catch {
      platformOn = true
    }
    if (!platformOn) continue // کار در صف می‌ماند تا فعال‌سازی

    const authz = await authorizeRecipient(n, sub.userId, ctx)
    if (!authz.ok) {
      await db.pushDelivery
        .update({
          where: { id: job.id },
          data: { status: 'SKIPPED', lastError: authz.reason ?? 'NOT_ALLOWED' },
        })
        .catch(() => null)
      continue
    }

    // پیش‌نمایش فقط با انتخاب کاربر
    const pref = await db.notificationPref.findUnique({
      where: { userId: sub.userId },
      select: { previewEnabled: true },
    })
    const preview = pref?.previewEnabled ?? false
    const content = buildPushContent(n.type, n.title, n.body, preview)
    const convKey = conversationKeyOf(n.link)
    const payload = JSON.stringify({
      title: content.title,
      body: content.body,
      link: n.link ?? '/notifications',
      tag: convKey ?? `daniar-${n.type}`,
      conversationKey: convKey,
    })

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        pushRequestOptions(vapid, {
          TTL: Math.max(60, Math.floor((ttlMs - (now.getTime() - job.createdAt.getTime())) / 1000)),
          urgency: 'normal',
        }),
      )
      await db.pushDelivery
        .update({ where: { id: job.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } })
        .catch(() => null)
    } catch (err) {
      const e = err as { statusCode?: number; message?: string }
      const sc = typeof e?.statusCode === 'number' ? e.statusCode : null
      // اشتراک منقضی/نامعتبر → پاک‌سازی
      if (sc === 404 || sc === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null)
        await db.pushDelivery
          .update({ where: { id: job.id }, data: { status: 'EXPIRED', lastError: `SUBSCRIPTION_GONE_${sc}` } })
          .catch(() => null)
        continue
      }
      // خطاهای دائمی
      if (sc === 400 || sc === 401 || sc === 402 || sc === 403 || sc === 405 || sc === 413) {
        await db.pushDelivery
          .update({
            where: { id: job.id },
            data: { status: 'FAILED', attempts: job.attempts + 1, lastError: `HTTP_${sc}` },
          })
          .catch(() => null)
        continue
      }
      // خطای موقت (429/5xx/شبکه) → تلاش مجدد محدود
      const attempts = job.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await db.pushDelivery
          .update({
            where: { id: job.id },
            data: { status: 'FAILED', attempts, lastError: sc ? `HTTP_${sc}` : 'NETWORK_ERROR' },
          })
          .catch(() => null)
      } else {
        const delaySec = RETRY_BASE_SECONDS * Math.pow(2, attempts - 1)
        await db.pushDelivery
          .update({
            where: { id: job.id },
            data: {
              attempts,
              nextAttemptAt: new Date(Date.now() + delaySec * 1000),
              lastError: sc ? `RETRY_HTTP_${sc}` : 'RETRY_NETWORK',
            },
          })
          .catch(() => null)
      }
    }
  }
}

// ─── اسکن فرصت‌طلبانه صف (توسط polling کلاینت‌ها فعال می‌شود) ───

let lastSweep = 0
let sweeping = false

/** قفل درون‌فرآیندی: هر لحظه فقط یک گذرِ پردازش صف فعال باشد (ضد ارسال دوباره) */
let queueRunning = false

export async function processPushQueueExclusive(): Promise<void> {
  if (queueRunning) return // گذر جاری همه کارهای معوق همین لحظه را می‌پوشاند؛ اسکن بعدی تکمیل می‌کند
  queueRunning = true
  try {
    await processPushQueue()
  } finally {
    queueRunning = false
  }
}

export function maybeSweepPushQueue(): void {
  const now = Date.now()
  if (sweeping || now - lastSweep < 10_000) return
  lastSweep = now
  sweeping = true
  processPushQueueExclusive()
    .catch(() => null)
    .finally(() => {
      sweeping = false
    })
}

// ─── اعلان آزمایشی — نتیجه واقعی ارسال برمی‌گردد ───

export interface TestPushResult {
  attempted: number
  sent: number
  errors: string[]
}

export async function sendTestPush(
  userId: string,
  opts: { deviceId?: string | null; subscriptionId?: string | null } = {},
): Promise<TestPushResult> {
  const vapid = vapidOptions()
  if (!vapid) return { attempted: 0, sent: 0, errors: ['VAPID_NOT_CONFIGURED'] }

  const subs = await db.pushSubscription.findMany({
    where: {
      userId,
      enabled: true,
      ...(opts.subscriptionId ? { id: opts.subscriptionId } : {}),
      ...(opts.deviceId ? { deviceId: opts.deviceId } : {}),
    },
  })
  if (!subs.length) return { attempted: 0, sent: 0, errors: ['NO_ACTIVE_SUBSCRIPTION'] }

  const payload = JSON.stringify({
    title: 'اعلان آزمایشی دانیار',
    body: 'اگر این اعلان را می‌بینید، پوش روی همین دستگاه کار می‌کند.',
    link: '/notifications',
    tag: 'daniar-test',
    conversationKey: null,
  })

  const result: TestPushResult = { attempted: subs.length, sent: 0, errors: [] }
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        pushRequestOptions(vapid, { TTL: 120, urgency: 'high' }),
      )
      result.sent++
    } catch (err) {
      const e = err as { statusCode?: number; message?: string }
      const sc = typeof e?.statusCode === 'number' ? e.statusCode : null
      if (sc === 404 || sc === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null)
        result.errors.push(`اشتراک منقضی بود و پاک شد (${sc})`)
      } else if (sc) {
        result.errors.push(`خطای سرویس پوش (کد ${sc})`)
      } else {
        result.errors.push('خطای شبکه در تماس با سرویس پوش')
      }
    }
  }
  return result
}
