/**
 * سرویس مستقل Socket.IO دانیار — پیام‌رسان + کلاس آنلاین (WebRTC Signaling)
 *
 * پیام‌رسان:
 * - احراز هویت با همان کوکی JWT اپلیکیشن (daniar_session)
 * - اتاق‌ها: user:{id} برای هر کاربر و group:{id} برای هر گروه درسی قابل دسترس
 * - عضویت در اتاق‌ها فقط پس از بررسی واقعی در دیتابیس انجام می‌شود
 * - Next.js پیام‌ها را در DB می‌نویسد و از طریق /internal/emit خبر broadcast می‌دهد
 *
 * کلاس آنلاین (مرحله ۵):
 * - ورود به جلسه فقط با بررسی واقعی دسترسی در دیتابیس: معلم منتسب، دانش‌آموز
 *   ثبت‌نام‌شده همان کلاس، مدیر همان مدرسه — داشتن لینک/شناسه به‌تنهایی کافی نیست
 * - همه عملیات (سکوت، اجازه صحبت/اشتراک، اخراج، پایان جلسه) سمت سرور اعتبارسنجی می‌شود
 * - رویدادهای WebRTC (offer/answer/ICE/track-map) فقط بین اعضای همان جلسه رله می‌شود
 * - عضویت بر اساس شناسه کاربر است؛ اتصال مجدد باعث شرکت‌کننده تکراری نمی‌شود
 * - گفتگوی متنی جلسه در DB ذخیره و فقط برای اعضای همان جلسه ارسال می‌شود
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { readFileSync, statSync } from 'fs'
import { Server, type Socket } from 'socket.io'
import { jwtVerify } from 'jose'
import { PrismaClient } from '@prisma/client'
import {
  lkConfigured,
  livekitRoomFor,
  lkSyncPermissions,
  lkRemoveParticipant,
  lkDeleteRoom,
} from './livekit'

// ─── بارگذاری .env ریشه در صورت نبود متغیرها ───
if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  try {
    const raw = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    /* ignore */
  }
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:/home/z/my-project/db/custom.db'
}

const PORT = Number(process.env.SOCKET_PORT ?? 3003)
const SOCKET_PATH = process.env.SOCKET_PATH ?? '/socket.io'

// ─── گیت محیط عملیاتی: کلیدهای پیش‌فرض/فاقد → بلافاصله توقف با خطای واضح ───
const DEV_FALLBACK_SECRETS = new Set([
  'daniar-dev-secret-change-me-in-production',
  'daniar-internal-dev-secret',
  'please-change-this-secret-in-production',
  'change-this-internal-secret',
])
// خواندن غیرمستقیم — bun هنگام build مقدار NODE_ENV را این‌لاین نمی‌کند و
// بررسی در زمان اجرای واقعی انجام می‌شود (باندل تولیدی همیشه سخت‌گیر است)
const runtimeEnv = (key: string) => process.env[key]
if (runtimeEnv('NODE_ENV') === 'production') {
  const missing: string[] = []
  if (!process.env.SESSION_SECRET || DEV_FALLBACK_SECRETS.has(process.env.SESSION_SECRET)) {
    missing.push('SESSION_SECRET')
  }
  if (!process.env.SOCKET_INTERNAL_SECRET || DEV_FALLBACK_SECRETS.has(process.env.SOCKET_INTERNAL_SECRET)) {
    missing.push('SOCKET_INTERNAL_SECRET')
  }
  if (missing.length > 0) {
    console.error(
      `[danyar-socket] راه‌اندازی متوقف شد — متغیر(های) امن ${missing.join(' و ')} تنظیم نشده یا هنوز مقدار نمونه هستند.\n` +
        'در فایل .env سرور مقدار امن بسازید: openssl rand -base64 32',
    )
    process.exit(1)
  }
}

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? 'daniar-dev-secret-change-me-in-production',
)
const INTERNAL_SECRET =
  process.env.SOCKET_INTERNAL_SECRET ?? 'daniar-internal-dev-secret'

/** سقف شرکت‌کنندگان هر جلسه — پیش‌فرض ۳۲ (هماهنگ با کد/compose/.env.example)؛
 *  ظرفیت اختصاصی هر کلاس از Classroom.capacity (پنل مدیر کل) جایگزین می‌شود */
const MAX_PARTICIPANTS = Math.max(2, Number(process.env.LIVE_MAX_PARTICIPANTS ?? 32))

/**
 * سقف مؤثر یک جلسه: حداقلِ سقف جهانی، سقف اختصاصی مدرسه (School.liveMaxParticipants)
 * و ظرفیت اختصاصی کلاس (Classroom.capacity) — مقدار null/۰ = بدون سقف همان لایه.
 * معلم میزبان نیز جزو این ظرفیت شمرده می‌شود. سقف نرم‌افزاری ورود است؛
 * تضمین توان سخت‌افزاری برای این تعداد کاربر نیست.
 */
function effectiveCapacity(
  classroomCapacity: number | null | undefined,
  schoolLiveMaxParticipants: number | null | undefined,
): number {
  let cap = MAX_PARTICIPANTS
  const s = Number(schoolLiveMaxParticipants ?? 0)
  if (Number.isFinite(s) && s >= 2) cap = Math.min(cap, Math.floor(s))
  const c = Number(classroomCapacity ?? 0)
  if (Number.isFinite(c) && c >= 2) cap = Math.min(cap, Math.floor(c))
  return cap
}

/**
 * مهلت اتصال مجدد معلم (ثانیه) — قطع موقت اینترنت معلم به‌تنهایی پایان قطعی جلسه
 * نیست؛ پس از این مهلت بدون بازگشت معلم، جلسه در سرور پایان می‌یابد.
 */
const HOST_GRACE_SECONDS = Math.max(5, Number(process.env.LIVE_HOST_GRACE_SECONDS ?? 60))

/**
 * اتصال Prisma — با نگهبان inode دیتابیس (پایین) قابل نوسازی است
 */
let db = new PrismaClient()

// ─── محافظ inode دیتابیس (SQLite) ───
// اگر فایل دیتابیس هنگام کار سرویس حذف و از نو ساخته شود (مثلاً db:reset یا
// db push مخرب)، اتصال باز این پراسس به inode قدیمی (فایل حذف‌شده) چسبیده
// می‌ماند و داده‌های جدید سایر پراسس‌ها (مثل ساخت جلسه در Next.js) هرگز
// دیده نمی‌شود — نشانه‌اش ارور «جلسه فعال نیست یا یافت نشد» با وجود جلسه
// ACTIVE در دیتابیس. این نگهبان هر ۳۰ ثانیه inode فایل را مقایسه می‌کند و
// در صورت بازسازی، اتصال را با کلاینت تازه نوسازی می‌کند.
const DB_PATH = (() => {
  const raw = process.env.DATABASE_URL ?? ''
  return raw.startsWith('file:/') ? raw.slice('file:'.length) : null
})()
let dbStat: ReturnType<typeof statSync> | null = DB_PATH ? statSync(DB_PATH) : null
setInterval(() => {
  if (!DB_PATH) return
  try {
    const cur = statSync(DB_PATH)
    if (dbStat && (cur.ino !== dbStat.ino || cur.dev !== dbStat.dev)) {
      console.error(
        '[db-watch] فایل دیتابیس بازسازی شده بود (inode عوض شد) — اتصال Prisma نوسازی می‌شود',
      )
      const old = db
      db = new PrismaClient()
      old.$disconnect().catch(() => null)
      // جلسات درون‌حافظه در دیتابیس جدید وجود ندارند — به‌درستی «پایان» اعلام می‌شوند
      for (const sessionId of [...liveRooms.keys()]) {
        void endLiveSession(sessionId, null).catch(() => null)
      }
    }
    dbStat = cur
  } catch {
    /* فایل موقتاً در دسترس نیست — دور بعد بررسی می‌شود */
  }
}, 30_000)

interface SessionUser {
  id: string
  role: string
  schoolId: string | null
  fullName: string
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(
      part.slice(idx + 1).trim(),
    )
  }
  return out
}

/** اتاق‌های مجاز کاربر بر اساس عضویت واقعی در دیتابیس (گروه کلاسی + گروه‌های عمومی مدرسه) */
async function roomsForUser(u: SessionUser): Promise<string[]> {
  const rooms = [`user:${u.id}`]
  try {
    if (u.role === 'SCHOOL_ADMIN' && u.schoolId) {
      const groups = await db.subjectGroup.findMany({
        where: {
          OR: [{ classroom: { schoolId: u.schoolId } }, { schoolId: u.schoolId }],
        },
        select: { id: true },
      })
      rooms.push(...groups.map((g) => `group:${g.id}`))
    } else if (u.role === 'TEACHER' || u.role === 'SCHOOL_VICE') {
      const rows = await db.teachingAssignment.findMany({
        where: { teacherId: u.id },
        select: { subjectGroupId: true },
      })
      const ids = [...new Set(rows.map((r) => r.subjectGroupId))]
      if (u.schoolId) {
        // گروه‌های عمومی: همکاران/عمومی + پایه‌هایی که در آن‌ها تدریس می‌کند
        const grades = (
          await db.teachingAssignment.findMany({
            where: {
              teacherId: u.id,
              subjectGroup: { classroom: { schoolId: u.schoolId } },
            },
            select: { subjectGroup: { select: { classroom: { select: { grade: true } } } } },
          })
        )
          .map((r) => r.subjectGroup.classroom?.grade)
          .filter((g): g is string => !!g)
        const schoolGroups = await db.subjectGroup.findMany({
          where: {
            schoolId: u.schoolId,
            archivedAt: null,
            OR: [
              { scope: { in: ['SCHOOL_STAFF', 'SCHOOL_ALL'] } },
              { scope: 'GRADE', grade: { in: [...new Set(grades)] } },
            ],
          },
          select: { id: true },
        })
        ids.push(...schoolGroups.map((g) => g.id))
        // استثناهای عضویت گروه‌های عمومی: حذف‌شده‌ها بیرون، افزوده‌شده‌ها داخل
        const myOv = await db.groupMemberOverride.findMany({
          where: { userId: u.id },
          select: { subjectGroupId: true, action: true, subjectGroup: { select: { schoolId: true, scope: true } } },
        })
        for (const o of myOv) {
          if (o.subjectGroup.scope === 'CLASS') continue
          if (o.subjectGroup.schoolId !== u.schoolId) continue
          if (o.action === 'REMOVE') {
            const idx = ids.indexOf(o.subjectGroupId)
            if (idx >= 0) ids.splice(idx, 1)
          } else {
            ids.push(o.subjectGroupId)
          }
        }
      }
      rooms.push(...[...new Set(ids)].map((id) => `group:${id}`))
    } else if (u.role === 'STUDENT') {
      // دانش‌آموز بدون مدرسه (حساب ناقص) فقط اتاق شخصی دارد
      if (u.schoolId) {
        const groups = await db.subjectGroup.findMany({
          where: {
            classroom: {
              schoolId: u.schoolId,
              enrollments: { some: { studentId: u.id } },
            },
          },
          select: { id: true },
        })
        const added = await db.groupMemberOverride.findMany({
          where: { userId: u.id, action: 'ADD' },
          select: { subjectGroupId: true },
        })
        const removed = new Set(
          (
            await db.groupMemberOverride.findMany({
              where: { userId: u.id, action: 'REMOVE' },
              select: { subjectGroupId: true },
            })
          ).map((r) => r.subjectGroupId),
        )
        const ids = [
          ...new Set([
            ...groups.map((g) => g.id).filter((id) => !removed.has(id)),
            ...added.map((r) => r.subjectGroupId),
          ]),
        ]
        // گروه‌های عمومی: عمومی + پایهٔ کلاس‌های خودش
        const myGrades = (
          await db.classroomEnrollment.findMany({
            where: {
              studentId: u.id,
              classroom: { schoolId: u.schoolId },
            },
            select: { classroom: { select: { grade: true } } },
          })
        )
          .map((e) => e.classroom.grade)
          .filter((g): g is string => !!g)
        const schoolGroups = await db.subjectGroup.findMany({
          where: {
            schoolId: u.schoolId,
            archivedAt: null,
            OR: [
              { scope: 'SCHOOL_ALL' },
              { scope: 'GRADE', grade: { in: [...new Set(myGrades)] } },
            ],
          },
          select: { id: true },
        })
        ids.push(...schoolGroups.map((g) => g.id))
        // استثناهای عضویت گروه‌های عمومی (افزوده‌شده توسط مدیر/معلم یا حذف‌شده)
        const myOv = await db.groupMemberOverride.findMany({
          where: { userId: u.id },
          select: { subjectGroupId: true, action: true, subjectGroup: { select: { schoolId: true, scope: true } } },
        })
        for (const o of myOv) {
          if (o.subjectGroup.scope === 'CLASS') continue
          if (o.subjectGroup.schoolId !== u.schoolId) continue
          if (o.action === 'REMOVE') {
            const idx = ids.indexOf(o.subjectGroupId)
            if (idx >= 0) ids.splice(idx, 1)
          } else {
            ids.push(o.subjectGroupId)
          }
        }
        rooms.push(...[...new Set(ids)].map((id) => `group:${id}`))
      }
    }
  } catch (e) {
    console.error('roomsForUser error', e)
  }
  return rooms
}

async function refreshUserRooms(userId: string) {
  const sockets = await io.in(`user:${userId}`).fetchSockets()
  for (const s of sockets) {
    const u = s.data.user as SessionUser | undefined
    if (!u) continue
    const wanted = new Set(await roomsForUser(u))
    for (const r of s.rooms) {
      if (r !== s.id && !wanted.has(r)) s.leave(r)
    }
    for (const r of wanted) s.join(r)
  }
}

// ════════════════════════════════════════════════════════════════
//  کلاس آنلاین — حالت درون‌حافظه جلسات فعال
// ════════════════════════════════════════════════════════════════

interface LiveParticipant {
  userId: string
  name: string
  role: string
  /** فقط سوکت فعال کاربر؛ اتصال مجدد جایگزین می‌شود (بدون شرکت‌کننده تکراری) */
  socketId: string
  micOn: boolean
  camOn: boolean
  sharing: boolean
  handRaised: boolean
  canSpeak: boolean
  canShare: boolean
  /** مجوز روشن‌کردن دوربین — دانش‌آموز فقط با اجازه معلم */
  canCam: boolean
  mutedByTeacher: boolean
  logId: string
  joinedAt: number
}

/** عملیات تخته سفید — برداری و مختصات نرمال (۰ تا ۱) برای سازگاری اندازه‌ها */
export interface WbStrokeOp {
  type: 'stroke'
  tool: 'pen' | 'eraser' | 'line' | 'arrow' | 'rect' | 'ellipse'
  color: string
  width: number
  points: [number, number][]
}
export type WbOp = WbStrokeOp | { type: 'undo' } | { type: 'clear' }

/** حداکثر عملیات روی تخته — بعد از آن معلم باید پاک‌سازی کند */
const WB_MAX_OPS = 600

interface LiveRoom {
  sessionId: string
  classroomId: string
  schoolId: string
  hostId: string
  notifyGroupId: string | null
  /** سقف مؤثر این جلسه — ظرفیت اختصاصی کلاس یا سقف سراسری */
  maxParticipants: number
  participants: Map<string, LiveParticipant>
  /** کاربران اخراج‌شده از این جلسه — اجازه ورود مجدد ندارند */
  kicked: Set<string>
  /** تایمر مهلت اتصال مجدد معلم — با بازگشت معلم لغو می‌شود */
  hostGraceTimer: ReturnType<typeof setTimeout> | null
  /** تخته سفید معلم — فعال/غیرفعال + تاریخچه عملیات برای همگام‌سازی تازه‌واردها */
  wboard: { active: boolean; ops: WbOp[] }
}

/** جلسات فعال در حال اجرا */
const liveRooms = new Map<string, LiveRoom>()
/** نگاشت socketId → جلسه (برای پاک‌سازی هنگام قطع اتصال) */
const socketLive = new Map<string, { sessionId: string; userId: string }>()

function parseFeaturesRaw(raw: string | null | undefined): { onlineClass: boolean } {
  try {
    const obj = raw ? JSON.parse(raw) : {}
    return { onlineClass: obj?.onlineClass === true }
  } catch {
    return { onlineClass: false }
  }
}

function participantView(p: LiveParticipant) {
  return {
    userId: p.userId,
    name: p.name,
    role: p.role,
    socketId: p.socketId,
    micOn: p.micOn,
    camOn: p.camOn,
    sharing: p.sharing,
    handRaised: p.handRaised,
    canSpeak: p.canSpeak,
    canShare: p.canShare,
    canCam: p.canCam,
    mutedByTeacher: p.mutedByTeacher,
  }
}

function participantsView(room: LiveRoom) {
  return [...room.participants.values()].map(participantView)
}

function roomPath(sessionId: string) {
  return `live:${sessionId}`
}

/**
 * بارگذاری (lazy) حالت جلسه از دیتابیس — فقط جلسه ACTIVE با مدرسه فعال و امکان onlineClass
 */
async function getOrLoadRoom(sessionId: string): Promise<LiveRoom> {
  const existing = liveRooms.get(sessionId)
  if (existing) return existing

  const session = await db.liveSession.findUnique({
    where: { id: sessionId },
    include: {
      classroom: { select: { id: true, schoolId: true, capacity: true } },
    },
  })
  if (!session || session.status !== 'ACTIVE') {
    throw new Error('جلسه فعال نیست یا یافت نشد')
  }
  const school = await db.school.findUnique({
    where: { id: session.classroom.schoolId },
    select: { isActive: true, features: true, liveMaxParticipants: true },
  })
  if (!school || !school.isActive) throw new Error('مدرسه غیرفعال است')
  if (!parseFeaturesRaw(school.features).onlineClass) {
    throw new Error('قابلیت کلاس آنلاین ویدیویی برای مدرسه شما غیر فعال است!')
  }

  const room: LiveRoom = {
    sessionId,
    classroomId: session.classroomId,
    schoolId: session.classroom.schoolId,
    hostId: session.hostId,
    notifyGroupId: session.notifyGroupId,
    maxParticipants: effectiveCapacity(
      session.classroom.capacity,
      school.liveMaxParticipants,
    ),
    participants: new Map(),
    kicked: new Set(),
    hostGraceTimer: null,
    wboard: { active: false, ops: [] },
  }
  liveRooms.set(sessionId, room)
  return room
}

/** بررسی دسترسی ورود به جلسه — کامل سمت سرور */
async function canJoinSession(
  u: SessionUser,
  room: LiveRoom,
): Promise<boolean> {
  if (u.role === 'TEACHER') {
    if (room.hostId === u.id) return true
    const assigned = await db.teachingAssignment.findFirst({
      where: {
        teacherId: u.id,
        subjectGroup: { classroomId: room.classroomId },
      },
      select: { id: true },
    })
    return !!assigned
  }
  if (u.role === 'SCHOOL_VICE') {
    // معاون مدرسه — ستاد مدرسه: ورود به جلسات مدرسه خود برای نظارت
    return u.schoolId === room.schoolId
  }
  if (u.role === 'STUDENT') {
    const enrolled = await db.classroomEnrollment.findFirst({
      where: { studentId: u.id, classroomId: room.classroomId },
      select: { id: true },
    })
    return !!enrolled
  }
  if (u.role === 'SCHOOL_ADMIN') {
    return u.schoolId === room.schoolId
  }
  return false
}

/**
 * پایان جلسه: به‌روزرسانی DB + قطع همه + اطلاع به اتاق جلسه، گروه اطلاع‌رسانی و دانش‌آموزان کلاس
 * reason فقط برای «پایان اجباری مدیر کل» پر می‌شود (گزارش مدیریتی روی خود جلسه ثبت می‌شود)
 */
async function endLiveSession(
  sessionId: string,
  enderId: string | null,
  reason?: string | null,
) {
  const room = liveRooms.get(sessionId)

  const now = new Date()
  const trimmedReason =
    typeof reason === 'string' ? reason.trim().slice(0, 500) : null
  await db.liveSession.updateMany({
    where: { id: sessionId, status: 'ACTIVE' },
    data: {
      status: 'ENDED',
      endedAt: now,
      enderId,
      ...(trimmedReason ? { forceEndReason: trimmedReason } : {}),
    },
  })
  // ثبت خروج همه حاضرین
  await db.liveParticipantLog.updateMany({
    where: { sessionId, leftAt: null },
    data: { leftAt: now },
  })

  // لغو تایمر مهلت اتصال مجدد معلم (اگر در انتظار باشد)
  if (room?.hostGraceTimer) {
    clearTimeout(room.hostGraceTimer)
    room.hostGraceTimer = null
  }

  const notifyGroupId = room?.notifyGroupId ?? null
  let classroomId = room?.classroomId ?? null
  if (!classroomId) {
    const s = await db.liveSession.findUnique({
      where: { id: sessionId },
      select: { classroomId: true },
    })
    classroomId = s?.classroomId ?? null
  }
  liveRooms.delete(sessionId)
  for (const [sid, m] of [...socketLive.entries()]) {
    if (m.sessionId === sessionId) socketLive.delete(sid)
  }
  // حذف اتاق LiveKit — جداسازی کامل رسانه جلسات (اتاق مستقل هر جلسه بسته می‌شود)
  lkDeleteRoom(livekitRoomFor(sessionId))

  io.to(roomPath(sessionId)).emit('live:ended', { sessionId, at: now.toISOString() })
  const sockets = await io.in(roomPath(sessionId)).fetchSockets()
  for (const s of sockets) s.leave(roomPath(sessionId))

  // دکمه پیام دعوت در گروه اطلاع‌رسانی + پاپ‌آپ/سوییچ همه کاربران کلاس
  // (دانش‌آموزان کلاس + معلمان منتسب) به «جلسه پایان یافته» تغییر کند —
  // وضعیت واقعی برای همه همگام می‌شود
  if (notifyGroupId) {
    io.to(`group:${notifyGroupId}`).emit('live:session-status', {
      sessionId,
      status: 'ENDED',
    })
  }
  if (classroomId) {
    try {
      const [students, teachers] = await Promise.all([
        db.classroomEnrollment.findMany({
          where: { classroomId, student: { isActive: true } },
          select: { studentId: true },
        }),
        db.teachingAssignment.findMany({
          where: { subjectGroup: { classroomId } },
          select: { teacherId: true },
        }),
      ])
      const audience = new Set<string>([
        ...students.map((st) => st.studentId),
        ...teachers.map((t) => t.teacherId),
      ])
      for (const uid of audience) {
        io.to(`user:${uid}`).emit('live:session-status', {
          sessionId,
          status: 'ENDED',
        })
      }
    } catch (e) {
      console.error('endLiveSession audience error', e)
    }
  }
  console.log(`[live] session ${sessionId} ended by ${enderId ?? 'system'}`)
}

/**
 * شروع مهلت اتصال مجدد معلم — قطع موقت معلم پایان قطعی نیست؛
 * پس از مهلت، وضعیت جلسه در سرور تعیین می‌شود (پایان اگر معلم برنگردد)
 */
function startHostGrace(room: LiveRoom) {
  if (room.hostGraceTimer) return
  io.to(roomPath(room.sessionId)).emit('live:host-status', {
    sessionId: room.sessionId,
    hostConnected: false,
    graceSeconds: HOST_GRACE_SECONDS,
  })
  console.log(
    `[live] host of ${room.sessionId} disconnected — grace ${HOST_GRACE_SECONDS}s`,
  )
  room.hostGraceTimer = setTimeout(() => {
    room.hostGraceTimer = null
    // اگر جلسه قبلاً پایان یافته یا میزبان برگشته، کاری نکن
    const current = liveRooms.get(room.sessionId)
    if (!current || current.participants.has(current.hostId)) return
    void (async () => {
      try {
        const s = await db.liveSession.findUnique({
          where: { id: room.sessionId },
          select: { status: true },
        })
        if (s?.status === 'ACTIVE') {
          await endLiveSession(room.sessionId, null)
        }
      } catch (e) {
        console.error('host grace end error', e)
      }
    })()
  }, HOST_GRACE_SECONDS * 1000)
}

/** بازگشت معلم — لغو مهلت و اطلاع «اتصال برقرار شد» به اتاق */
function cancelHostGrace(room: LiveRoom) {
  if (room.hostGraceTimer) {
    clearTimeout(room.hostGraceTimer)
    room.hostGraceTimer = null
    io.to(roomPath(room.sessionId)).emit('live:host-status', {
      sessionId: room.sessionId,
      hostConnected: true,
    })
    console.log(`[live] host of ${room.sessionId} reconnected — grace cancelled`)
  }
}

function leaveSocketFromLive(socket: Socket, broadcastLeave = true) {
  const membership = socketLive.get(socket.id)
  if (!membership) return
  socketLive.delete(socket.id)
  const room = liveRooms.get(membership.sessionId)
  socket.leave(roomPath(membership.sessionId))
  if (!room) return
  const p = room.participants.get(membership.userId)
  if (!p || p.socketId !== socket.id) return
  // این سوکت، سوکت فعال کاربر بود → خروج واقعی
  room.participants.delete(membership.userId)
  db.liveParticipantLog
    .update({ where: { id: p.logId }, data: { leftAt: new Date() } })
    .catch(() => null)
  if (broadcastLeave) {
    io.to(roomPath(room.sessionId)).emit('live:participant-left', {
      sessionId: room.sessionId,
      userId: p.userId,
    })
  }
  // خروج/قطع اتصال معلم میزبان → مهلت اتصال مجدد شروع می‌شود
  // (قطع موقت اینترنت معلم به‌تنهایی پایان قطعی جلسه نیست)
  if (p.userId === room.hostId) startHostGrace(room)
}

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.url?.startsWith('/healthz')) {
      // healthcheck واقعی: پاسخ فقط با تأیید دسترسی به دیتابیس
      // (فیلدهای uptimeSec/clients برای پنل وضعیت زیرساخت اضافه شد —
      //  کاملاً سازگار با healthcheck موجود docker-compose که فقط r.ok را می‌سنجد)
      try {
        await db.$queryRaw`SELECT 1`
        return send(200, {
          ok: true,
          service: 'danyar-socket',
          db: 'ok',
          uptimeSec: Math.floor(process.uptime()),
          clients: io.engine?.clientsCount ?? 0,
        })
      } catch {
        return send(503, { ok: false, service: 'danyar-socket', db: 'error' })
      }
    }
    if (req.method === 'POST' && req.url?.startsWith('/internal/emit')) {
      if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
        // قابل تشخیص بدون افشای محرمانه — نشانهٔ کلاسیک: next با .env کهنه
        // (قبل از بازنشانی) بالا مانده و broadcast همه پیام‌ها بی‌صدا رد می‌شود
        console.error(
          `[internal] emit reject: secret_mismatch ip=${req.socket.remoteAddress} — next احتمالاً .env کهنه در حافظه دارد (dev-up.sh را اجرا کنید)`,
        )
        return send(403, { error: 'forbidden' })
      }
      let body = ''
      for await (const chunk of req) body += chunk
      try {
        const payload = JSON.parse(body) as {
          rooms?: string[]
          event?: string
          data?: unknown
          refreshUserIds?: string[]
        }
        let delivered = 0
        if (payload.rooms?.length && payload.event) {
          // ردیابی قابل‌تشخیص: فقط نام رویداد و اتاق‌ها — بدون محتوای پیام
          console.log(
            `[internal] emit event=${payload.event} rooms=${payload.rooms.length} [${payload.rooms.slice(0, 3).join(',')}]`,
          )
          for (const room of payload.rooms) {
            delivered += io.to(room).emit(payload.event, payload.data) ? 1 : 0
          }
          console.log(`[internal] emit delivered=${delivered}`)
        }
        if (payload.refreshUserIds?.length) {
          for (const uid of payload.refreshUserIds) {
            await refreshUserRooms(uid)
            io.to(`user:${uid}`).emit('rooms-refreshed', {})
          }
        }
        return send(200, { ok: true, delivered })
      } catch (e) {
        return send(400, { error: 'bad payload' })
      }
    }
    // پایان جلسه از سمت API (احراز هویت در Next.js انجام شده است)
    if (req.method === 'POST' && req.url?.startsWith('/internal/live-end')) {
      if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
        return send(403, { error: 'forbidden' })
      }
      let body = ''
      for await (const chunk of req) body += chunk
      try {
        const payload = JSON.parse(body) as {
          sessionId?: string
          enderId?: string
          reason?: string
        }
        if (!payload.sessionId) return send(400, { error: 'sessionId لازم است' })
        // reason فقط برای پایان اجباری مدیر کل — روی خود جلسه ذخیره می‌شود (گزارش مدیریتی)
        await endLiveSession(
          payload.sessionId,
          payload.enderId ?? null,
          typeof payload.reason === 'string' ? payload.reason : null,
        )
        return send(200, { ok: true })
      } catch (e) {
        return send(500, { error: 'خطا در پایان جلسه' })
      }
    }
    // وضعیت لحظه‌ای جلسه برای پنل «مدیریت کلاس‌های آنلاین» — فقط با راز داخلی؛
    // افراد حاضر از حافظهٔ واقعی جلسه؛ سقف مؤثر با خواندن تازه از دیتابیس
    // (کاهش سقف مدرسه/کلاس باید بلافاصله در پنل هم دیده شود)
    if (req.method === 'POST' && req.url?.startsWith('/internal/live-stats')) {
      if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
        return send(403, { error: 'forbidden' })
      }
      let body = ''
      for await (const chunk of req) body += chunk
      try {
        const payload = JSON.parse(body) as { sessionId?: string }
        const sessionId = String(payload?.sessionId ?? '')
        if (!sessionId) return send(400, { error: 'sessionId لازم است' })
        const room = liveRooms.get(sessionId)
        if (!room) return send(404, { error: 'not_active_in_memory' })
        // تازه‌سازی سقف مؤثر از دیتابیس (بدون تغییر وضعیت حاضرین)
        const fresh = await db.school.findUnique({
          where: { id: room.schoolId },
          select: {
            liveMaxParticipants: true,
            classrooms: { where: { id: room.classroomId }, select: { capacity: true } },
          },
        })
        room.maxParticipants = effectiveCapacity(
          fresh?.classrooms[0]?.capacity ?? null,
          fresh?.liveMaxParticipants ?? null,
        )
        return send(200, {
          ok: true,
          sessionId,
          maxParticipants: room.maxParticipants,
          hostConnected: room.participants.has(room.hostId),
          hostInGrace: room.hostGraceTimer !== null,
          participants: participantsView(room),
        })
      } catch {
        return send(500, { error: 'خطا در خواندن وضعیت جلسه' })
      }
    }
    // تأیید عضویت/عدم اخراج برای صدور توکن LiveKit (در Next.js احراز هویت شده است)
    if (req.method === 'POST' && req.url?.startsWith('/internal/live-allowed')) {
      if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
        return send(403, { error: 'forbidden' })
      }
      let body = ''
      for await (const chunk of req) body += chunk
      try {
        const payload = JSON.parse(body) as { sessionId?: string; userId?: string }
        const sessionId = String(payload?.sessionId ?? '')
        const userId = String(payload?.userId ?? '')
        if (!sessionId || !userId) return send(400, { error: 'sessionId/userId لازم است' })
        const room = liveRooms.get(sessionId)
        if (!room) return send(404, { error: 'ابتدا وارد جلسه شوید' })
        if (room.kicked.has(userId)) {
          return send(403, { error: 'شما توسط معلم از این جلسه خارج شده‌اید' })
        }
        const p = room.participants.get(userId)
        if (!p) {
          // استثنای اتصال مجدد میزبان در پنجرهٔ مهلت: میزبان پس از قطع موقت از
          // حافظهٔ حاضرین حذف شده ولی جلسه هنوز زنده است و او باید بتواند برگردد
          // (توکن رسانه برای بازگشت میزبان جلسهٔ جاری لازم است)
          if (userId === room.hostId && room.hostGraceTimer) {
            return send(200, { ok: true, identity: userId })
          }
          return send(404, { error: 'ابتدا وارد جلسه شوید' })
        }
        return send(200, { ok: true, identity: userId })
      } catch (e) {
        return send(500, { error: 'خطای بررسی دسترسی' })
      }
    }
    return send(404, { error: 'not found' })
  },
)

const io = new Server(httpServer, {
  path: SOCKET_PATH,
  cors: { origin: true, credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
  /** انتشار حداکثر اندازه پیام رله WebRTC */
  maxHttpBufferSize: 1e6,
})

/**
 * ساخت خطای رد احراز هویت با کد «قابل تشخیص ولی بی‌خطر» + لاگ کامل سمت سرور.
 *
 * کدی که به کلاینت می‌رسد هیچ اطلاعات محرمانه‌ای ندارد (نه توکن، نه محتوای
 * کوکی، نه شناسه کاربر)؛ جزئیات واقعی فقط در لاگ سرور نوشته می‌شود تا علت
 * (کوکی حذف‌شده در پراکسی، امضای ناسازگار SESSION_SECRET بین سرویس‌ها،
 * منقضی‌شدن نشست، خطای دیتابیس و…) بدون حدس قابل تشخیص باشد:
 *   auth:no_session        کوکی نشست اصلاً نرسید (ورود نکرده یا پراکسی حذفش کرده)
 *   auth:bad_token         توکن نامعتبر/منقضی/امضای ناسازگار
 *   auth:unknown_user      کاربرِ توکن در دیتابیس نیست (مثلاً دیتابیس بازنشسته شده)
 *   auth:inactive          حساب غیرفعال است
 *   auth:role_not_allowed  نقش مجاز به سوکت نیست (SUPER_ADMIN)
 *   auth:server_error      خطای داخلی (مثلاً دیتابیس در دسترس نیست) — نه مشکل احراز
 */
function rejectSocketAuth(
  socket: Socket,
  code: string,
  detail?: string,
): Error {
  const h = socket.handshake.headers
  const ip =
    (h['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    socket.handshake.address
  const transport = socket.handshake.query?.transport ?? '?'
  const origin = (h.origin as string | undefined) ?? '-'
  console.warn(
    `[socket-auth] reject code=${code}${detail ? ` detail=${detail}` : ''} ip=${ip} transport=${transport} origin=${origin}`,
  )
  return new Error(code)
}

io.use(async (socket, next) => {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie)
    const token = cookies['daniar_session']
    if (!token) return next(rejectSocketAuth(socket, 'auth:no_session'))
    try {
      const { payload } = await jwtVerify(token, SESSION_SECRET)
      const uid = String(payload.uid ?? '')
      if (!uid)
        return next(
          rejectSocketAuth(socket, 'auth:bad_token', 'payload_uid_missing'),
        )
      let user: {
        id: string
        isActive: boolean
        role: string
        schoolId: string | null
        fullName: string
      } | null = null
      try {
        user = await db.user.findUnique({
          where: { id: uid },
          select: {
            id: true,
            isActive: true,
            role: true,
            schoolId: true,
            fullName: true,
          },
        })
      } catch (dbErr) {
        // خطای زیرساخت (مثلاً دیتابیس) ≠ رد احراز هویت — باید جدا تشخیص داده شود
        return next(
          rejectSocketAuth(
            socket,
            'auth:server_error',
            dbErr instanceof Error ? dbErr.message.slice(0, 120) : 'db',
          ),
        )
      }
      if (!user) return next(rejectSocketAuth(socket, 'auth:unknown_user'))
      if (!user.isActive) return next(rejectSocketAuth(socket, 'auth:inactive'))
      if (user.role === 'SUPER_ADMIN') {
        // اتصال تشخیصی مدیر کل — پنل «وضعیت زیرساخت» (/superadmin/infrastructure):
        // احراز هویت واقعی همان کوکی اپ، اما «فقط diag:echo». هیچ اتاقی join
        // نمی‌شود، هیچ پیام/رویدادی دریافت نمی‌کند؛ پیام‌رسانی کاربران دست‌نخورده.
        socket.data.user = {
          id: user.id,
          role: user.role,
          schoolId: user.schoolId,
          fullName: user.fullName,
        } satisfies SessionUser
        socket.data.diagOnly = true
        return next()
      }
      socket.data.user = {
        id: user.id,
        role: user.role,
        schoolId: user.schoolId,
        fullName: user.fullName,
      } satisfies SessionUser
      next()
    } catch (jwtErr) {
      // کد خطای jose (مثل ERR_JWT_EXPIRED یا ERR_JWS_SIGNATURE_VERIFICATION_FAILED)
      // فقط در لاگ سرور؛ کلاینت فقط کد بی‌خطر auth:bad_token را می‌بیند
      const code =
        typeof jwtErr === 'object' && jwtErr && 'code' in jwtErr
          ? String((jwtErr as { code?: unknown }).code)
          : 'invalid_jwt'
      return next(rejectSocketAuth(socket, 'auth:bad_token', code))
    }
  } catch (e) {
    return next(
      rejectSocketAuth(
        socket,
        'auth:server_error',
        e instanceof Error ? e.message.slice(0, 120) : 'unknown',
      ),
    )
  }
})

type LiveAck = (res: { ok: boolean; error?: string; data?: unknown }) => void

function fail(ack: LiveAck | undefined, error: string) {
  ack?.({ ok: false, error })
}

io.on('connection', (socket: Socket) => {
  const u = socket.data.user as SessionUser
  // نکته حیاتی: همه هندلرها باید «هم‌زمان» (قبل از هر await) ثبت شوند؛
  // در غیر این صورت رویدادی که کلاینت بلافاصله پس از connect می‌فرستد
  // در فاصله کوئری‌های دیتابیس بدون listener می‌ماند و بی‌صدا drop می‌شود.

  // ─── اتصال تشخیصی مدیر کل (پنل وضعیت زیرساخت) ───
  // فقط رفت‌وبرگشت پیام تشخیصی با nonce — بدون هیچ دسترسی به اتاق‌ها/پیام‌های واقعی.
  // بعد از ثبت همین هندلر، اتصال diag هرگز به بقیهٔ هندلرها/اتاق‌ها نمی‌رسد.
  if (socket.data.diagOnly) {
    socket.on('diag:echo', (payload: { nonce?: unknown }, ack?: (res: unknown) => void) => {
      // محمول کوچک و بی‌خطر — هرگز بازتاب چیزی غیر از همان nonce کوتاه
      const nonce = typeof payload?.nonce === 'string' ? payload.nonce.slice(0, 64) : null
      ack?.({
        ok: true,
        nonce,
        serverTime: Date.now(),
        diag: true,
      })
    })
    return // هیچ عضویت/رویدادی برای اتصال تشخیصی ثبت نمی‌شود
  }

  // درخواست کلاینت برای بازسازی اتاق‌ها (پس از تغییر عضویت)
  socket.on('refresh-rooms', async () => {
    const wanted = new Set(await roomsForUser(u))
    for (const r of socket.rooms) {
      if (r !== socket.id && !wanted.has(r)) socket.leave(r)
    }
    for (const r of wanted) socket.join(r)
    socket.emit('rooms-refreshed', {})
  })

  // ─── ورود به جلسه کلاس آنلاین ───
  socket.on('live:join', async (payload: { sessionId?: string }, ack?: LiveAck) => {
    try {
      const sessionId = String(payload?.sessionId ?? '')
      if (!sessionId) return fail(ack, 'شناسه جلسه نامعتبر است')

      let room: LiveRoom
      try {
        room = await getOrLoadRoom(sessionId)
      } catch (e) {
        return fail(ack, e instanceof Error ? e.message : 'جلسه در دسترس نیست')
      }

      if (room.kicked.has(u.id)) {
        return fail(ack, 'شما توسط معلم از این جلسه خارج شده‌اید')
      }

      // ── بازخوانی وضعیت مدرسه و ظرفیت در «هر ورود» ──
      // غیرفعال‌شدن کلاس آنلاین یا خود مدرسه باید ورود جدید را فوراً مسدود کند؛
      // اما جلسات جاری بدون اقدام صریح مدیر قطع نمی‌شوند — بنابراین «اتصال مجدد
      // میزبانِ جلسهٔ جاری» (حاضر در جلسه یا در پنجرهٔ مهلت اتصال مجدد پس از قطع
      // موقت) استثنا می‌ماند تا جلسه نمرده باشد. کاهش ظرفیت نیز حاضرین را اخراج
      // نمی‌کند؛ فقط تا کاهش تعداد، ورود جدید مسدود می‌ماند (سقف با مقادیر فعلی
      // دیتابیس تازه می‌شود).
      const hostReconnect =
        u.id === room.hostId &&
        (room.participants.has(u.id) || room.hostGraceTimer !== null)
      {
        const fresh = await db.school.findUnique({
          where: { id: room.schoolId },
          select: {
            isActive: true,
            features: true,
            liveMaxParticipants: true,
            classrooms: { where: { id: room.classroomId }, select: { capacity: true } },
          },
        })
        const blocked =
          !fresh ||
          !fresh.isActive ||
          !parseFeaturesRaw(fresh.features).onlineClass
        if (blocked && !hostReconnect) {
          return fail(
            ack,
            !fresh || !fresh.isActive
              ? 'مدرسه غیرفعال است؛ ورود جدید مجاز نیست'
              : 'قابلیت کلاس آنلاین ویدیویی برای مدرسه شما غیر فعال است!',
          )
        }
        room.maxParticipants = effectiveCapacity(
          fresh?.classrooms[0]?.capacity ?? null,
          fresh?.liveMaxParticipants ?? null,
        )
      }

      // بازگشت معلم میزبان → مهلت اتصال مجدد لغو و اتصال برقرار اعلام می‌شود
      if (u.id === room.hostId) cancelHostGrace(room)
      const allowed = await canJoinSession(u, room)
      if (!allowed) {
        return fail(ack, 'شما اجازه ورود به این جلسه را ندارید')
      }

      const isNew = !room.participants.has(u.id)
      if (isNew && room.participants.size >= room.maxParticipants) {
        return fail(
          ack,
          `ظرفیت جلسه تکمیل است (حداکثر ${room.maxParticipants} شرکت‌کننده)`,
        )
      }

      // اتصال مجدد: سوکت قبلی کاربر جایگزین می‌شود (بدون شرکت‌کننده تکراری)
      let logId: string
      if (!isNew) {
        const p = room.participants.get(u.id)!
        if (p.socketId && p.socketId !== socket.id) {
          io.to(p.socketId).emit('live:replaced', { sessionId })
          const old = io.sockets.sockets.get(p.socketId)
          if (old) {
            socketLive.delete(old.id)
            old.leave(roomPath(sessionId))
          }
          // جایگزینی اتصال برای همان شرکت‌کننده — قطع‌ووصل واقعی ثبت می‌شود
          db.liveParticipantLog
            .update({ where: { id: p.logId }, data: { reconnects: { increment: 1 } } })
            .catch(() => null)
        }
        p.socketId = socket.id
        logId = p.logId
      } else {
        // مجوزهای پیش‌فرض: معلم همه‌چیز؛ دانش‌آموز باید از معلم اجازه بگیرد
        // (صحبت/اشتراک/دوربین — دوربین دانش‌آموز فقط با اجازه معلم روشن می‌شود)
        const canSpeak =
          u.role === 'TEACHER' || u.role === 'SCHOOL_ADMIN' || u.role === 'SCHOOL_VICE'
        const canShare = u.role === 'TEACHER' || u.role === 'SCHOOL_VICE'
        const canCam = u.role !== 'STUDENT'
        const log = await db.liveParticipantLog.create({
          data: {
            sessionId,
            userId: u.id,
            role: u.role,
          },
        })
        logId = log.id
        room.participants.set(u.id, {
          userId: u.id,
          name: u.fullName,
          role: u.role,
          socketId: socket.id,
          micOn: false,
          camOn: false,
          sharing: false,
          handRaised: false,
          canSpeak,
          canShare,
          canCam,
          mutedByTeacher: false,
          logId,
          joinedAt: Date.now(),
        })
      }

      socket.join(roomPath(sessionId))
      socketLive.set(socket.id, { sessionId, userId: u.id })

      const self = room.participants.get(u.id)!
      const chat = await db.liveChatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { sender: { select: { id: true, fullName: true, role: true } } },
      })

      ack?.({
        ok: true,
        data: {
          self: participantView(self),
          hostId: room.hostId,
          participants: participantsView(room),
          chat: chat.reverse().map((c) => ({
            id: c.id,
            senderId: c.senderId,
            senderName: c.sender.fullName,
            senderRole: c.sender.role,
            body: c.body,
            createdAt: c.createdAt.toISOString(),
          })),
          // تخته سفید — تازه‌واردها وضعیت کامل را می‌گیرند
          wboard: { active: room.wboard.active, ops: room.wboard.ops },
        },
      })

      if (isNew) {
        socket.to(roomPath(sessionId)).emit('live:participant-joined', {
          sessionId,
          participant: participantView(self),
        })
      } else {
        // اتصال مجدد — وضعیت سوکت جدید را به بقیه بده
        io.to(roomPath(sessionId)).emit('live:participant-update', {
          sessionId,
          participant: participantView(self),
        })
      }
    } catch (e) {
      console.error('live:join error', e)
      fail(ack, 'خطا در ورود به جلسه')
    }
  })

  socket.on('live:leave', (_payload: unknown, ack?: LiveAck) => {
    leaveSocketFromLive(socket, true)
    ack?.({ ok: true })
  })

  // ─── تغییر وضعیت رسانه خود کاربر (میکروفون/دوربین/اشتراک صفحه) ───
  socket.on(
    'live:media',
    (payload: { micOn?: boolean; camOn?: boolean; sharing?: boolean }, ack?: LiveAck) => {
      const m = socketLive.get(socket.id)
      if (!m) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
      const room = liveRooms.get(m.sessionId)
      const p = room?.participants.get(m.userId)
      if (!room || !p) return fail(ack, 'شما در جلسه‌ای حضور ندارید')

      if (payload.micOn !== undefined) {
        if (payload.micOn && (p.mutedByTeacher || !p.canSpeak)) {
          return fail(
            ack,
            p.mutedByTeacher
              ? 'میکروفون شما توسط معلم بسته شده است'
              : 'برای صحبت باید از معلم اجازه بگیرید (دست بلند کنید)',
          )
        }
        p.micOn = payload.micOn
      }
      if (payload.camOn !== undefined) {
        // دوربین دانش‌آموز فقط با اجازه معلم روشن می‌شود (خاموش‌کردن همیشه آزاد است)
        if (payload.camOn && !p.canCam) {
          return fail(ack, 'برای روشن‌کردن دوربین باید از معلم اجازه بگیرید')
        }
        p.camOn = payload.camOn
      }
      if (payload.sharing !== undefined) {
        if (payload.sharing && !p.canShare) {
          return fail(ack, 'برای اشتراک‌گذاری صفحه باید از معلم اجازه بگیرید')
        }
        p.sharing = payload.sharing
      }
      io.to(roomPath(room.sessionId)).emit('live:participant-update', {
        sessionId: room.sessionId,
        participant: participantView(p),
      })
      ack?.({ ok: true })
    },
  )

  // ─── بالا بردن دست (درخواست صحبت) — فقط دانش‌آموز ───
  socket.on('live:hand', (payload: { raised?: boolean }, ack?: LiveAck) => {
    const m = socketLive.get(socket.id)
    if (!m) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
    const room = liveRooms.get(m.sessionId)
    const p = room?.participants.get(m.userId)
    if (!room || !p) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
    if (p.role !== 'STUDENT') {
      return fail(ack, 'درخواست صحبت فقط برای دانش‌آموزان است')
    }
    p.handRaised = payload.raised !== false
    io.to(roomPath(room.sessionId)).emit('live:participant-update', {
      sessionId: room.sessionId,
      participant: participantView(p),
    })
    ack?.({ ok: true })
  })

  // ─── تخته سفید معلم — فعال/غیرفعال + همگام‌سازی عملیات ترسیم ───
  // فقط معلم میزبان تغییر می‌دهد؛ دانش‌آموزان فقط مشاهده می‌کنند.

  socket.on('live:wboard-toggle', (payload: { active?: boolean }, ack?: LiveAck) => {
    const m = socketLive.get(socket.id)
    const room = m ? liveRooms.get(m.sessionId) : undefined
    if (!m || !room) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
    if (room.hostId !== m.userId) return fail(ack, 'فقط معلم جلسه می‌تواند تخته سفید را کنترل کند')
    room.wboard.active = payload?.active !== false
    if (!room.wboard.active) {
      // خاموش‌کردن تخته = پایان نمایش؛ تاریخچه پاک می‌شود تا جلسه بعد تازه شروع شود
      room.wboard.ops = []
    }
    io.to(roomPath(room.sessionId)).emit('live:wboard-active', {
      sessionId: room.sessionId,
      active: room.wboard.active,
    })
    ack?.({ ok: true, data: { active: room.wboard.active } })
  })

  socket.on('live:wboard-op', (payload: { op?: WbOp }, ack?: LiveAck) => {
    const m = socketLive.get(socket.id)
    const room = m ? liveRooms.get(m.sessionId) : undefined
    if (!m || !room) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
    if (room.hostId !== m.userId) return fail(ack, 'فقط معلم جلسه می‌تواند روی تخته بنویسد')
    if (!room.wboard.active) return fail(ack, 'تخته سفید فعال نیست')
    const op = payload?.op
    if (!op || typeof op !== 'object') return fail(ack, 'عملیات نامعتبر است')

    if (op.type === 'stroke') {
      const tools = ['pen', 'eraser', 'line', 'arrow', 'rect', 'ellipse']
      if (!tools.includes(op.tool)) return fail(ack, 'ابزار نامعتبر است')
      if (!Array.isArray(op.points) || op.points.length < 2 || op.points.length > 4096) {
        return fail(ack, 'مختصات نامعتبر است')
      }
      for (const pt of op.points) {
        if (!Array.isArray(pt) || pt.length !== 2) return fail(ack, 'مختصات نامعتبر است')
        const [x, y] = pt as number[]
        if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) {
          return fail(ack, 'مختصات نامعتبر است')
        }
      }
      if (room.wboard.ops.length >= WB_MAX_OPS) {
        return fail(ack, 'تخته پر است؛ ابتدا پاک‌سازی کنید')
      }
      room.wboard.ops.push(op)
    } else if (op.type === 'undo') {
      // حذف آخرین ترسیم — به‌صورت عملیات پخش می‌شود تا همه هماهنگ بمانند
      room.wboard.ops.push(op)
    } else if (op.type === 'clear') {
      room.wboard.ops = []
      // پاک‌سازی به‌صورت رویداد مستقل ارسال می‌شود
      io.to(roomPath(room.sessionId)).emit('live:wboard-clear', { sessionId: room.sessionId })
      ack?.({ ok: true })
      return
    } else {
      return fail(ack, 'عملیات نامعتبر است')
    }

    // به بقیه اتاق (نه فرستنده که خودش ترسیم محلی دارد)
    socket.to(roomPath(room.sessionId)).emit('live:wboard-op', {
      sessionId: room.sessionId,
      op,
    })
    ack?.({ ok: true })
  })

  // ─── ابزارهای معلم: سکوت، اجازه صحبت/اشتراک، اخراج ───
  socket.on('live:mute-target', (payload: { userId?: string; unmute?: boolean }, ack?: LiveAck) => {
    const m = socketLive.get(socket.id)
    const room = m ? liveRooms.get(m.sessionId) : undefined
    if (!m || !room) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
    if (room.hostId !== m.userId) return fail(ack, 'فقط معلم جلسه می‌تواند این کار را انجام دهد')
    const target = room.participants.get(String(payload?.userId ?? ''))
    if (!target) return fail(ack, 'این شرکت‌کننده در جلسه نیست')
    if (target.userId === room.hostId) return fail(ack, 'میکروفون معلم جلسه قابل بستن نیست')

    if (payload?.unmute) {
      target.mutedByTeacher = false
    } else {
      target.mutedByTeacher = true
      target.micOn = false
      io.to(target.socketId).emit('live:you-are-muted', { sessionId: room.sessionId })
    }
    // میکروفون در سرور رسانه هم mute می‌شود (نه فقط UI) — و مجوزها همگام می‌مانند
    if (lkConfigured) {
      void lkSyncPermissions(livekitRoomFor(room.sessionId), {
        userId: target.userId,
        name: target.name,
        role: target.role,
        canSpeak: target.canSpeak,
        canCam: target.canCam,
        canShare: target.canShare,
        mutedByTeacher: target.mutedByTeacher,
      })
    }
    io.to(roomPath(room.sessionId)).emit('live:participant-update', {
      sessionId: room.sessionId,
      participant: participantView(target),
    })
    ack?.({ ok: true })
  })

  socket.on(
    'live:permit',
    (payload: { userId?: string; canSpeak?: boolean; canShare?: boolean; canCam?: boolean }, ack?: LiveAck) => {
      const m = socketLive.get(socket.id)
      const room = m ? liveRooms.get(m.sessionId) : undefined
      if (!m || !room) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
      if (room.hostId !== m.userId) return fail(ack, 'فقط معلم جلسه می‌تواند این کار را انجام دهد')
      const target = room.participants.get(String(payload?.userId ?? ''))
      if (!target) return fail(ack, 'این شرکت‌کننده در جلسه نیست')
      if (target.userId === room.hostId) return fail(ack, 'تغییر مجوز معلم جلسه ممکن نیست')

      if (payload?.canSpeak !== undefined) {
        target.canSpeak = payload.canSpeak
        target.handRaised = false
        if (!payload.canSpeak) target.micOn = false
      }
      if (payload?.canShare !== undefined) {
        target.canShare = payload.canShare
        if (!payload.canShare) target.sharing = false
      }
      if (payload?.canCam !== undefined) {
        target.canCam = payload.canCam
        // قطع اجازه دوربین → دوربین روشن فوراً خاموش می‌شود
        if (!payload.canCam) target.camOn = false
      }
      // الزام‌سازی مجوز در سرور رسانه (LiveKit SFU) — گیت انتشار دانش‌آموز سمت سرور
      if (lkConfigured) {
        void lkSyncPermissions(livekitRoomFor(room.sessionId), {
          userId: target.userId,
          name: target.name,
          role: target.role,
          canSpeak: target.canSpeak,
          canCam: target.canCam,
          canShare: target.canShare,
          mutedByTeacher: target.mutedByTeacher,
        })
      }
      io.to(target.socketId).emit('live:permission-changed', {
        sessionId: room.sessionId,
        canSpeak: target.canSpeak,
        canShare: target.canShare,
        canCam: target.canCam,
        canSpeakNow: target.canSpeak && !target.mutedByTeacher,
      })
      io.to(roomPath(room.sessionId)).emit('live:participant-update', {
        sessionId: room.sessionId,
        participant: participantView(target),
      })
      ack?.({ ok: true })
    },
  )

  socket.on('live:kick', (payload: { userId?: string }, ack?: LiveAck) => {
    const m = socketLive.get(socket.id)
    const room = m ? liveRooms.get(m.sessionId) : undefined
    if (!m || !room) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
    if (room.hostId !== m.userId) return fail(ack, 'فقط معلم جلسه می‌تواند این کار را انجام دهد')
    const target = room.participants.get(String(payload?.userId ?? ''))
    if (!target) return fail(ack, 'این شرکت‌کننده در جلسه نیست')
    if (target.userId === room.hostId) return fail(ack, 'معلم جلسه قابل اخراج نیست')

    room.kicked.add(target.userId)
    room.participants.delete(target.userId)
    db.liveParticipantLog
      .update({ where: { id: target.logId }, data: { leftAt: new Date(), kicked: true } })
      .catch(() => null)
    // رسانه اخراج‌شده هم از اتاق LiveKit حذف می‌شود
    lkRemoveParticipant(livekitRoomFor(room.sessionId), target.userId)
    const targetSocket = io.sockets.sockets.get(target.socketId)
    if (targetSocket) {
      socketLive.delete(targetSocket.id)
      targetSocket.leave(roomPath(room.sessionId))
      targetSocket.emit('live:kicked', { sessionId: room.sessionId })
    }
    io.to(roomPath(room.sessionId)).emit('live:participant-left', {
      sessionId: room.sessionId,
      userId: target.userId,
      kicked: true,
    })
    ack?.({ ok: true })
  })

  // ─── پایان جلسه — معلم جلسه یا مدیر همان مدرسه ───
  socket.on('live:end', async (_payload: unknown, ack?: LiveAck) => {
    const m = socketLive.get(socket.id)
    const room = m ? liveRooms.get(m.sessionId) : undefined
    if (!m || !room) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
    const isHost = room.hostId === m.userId
    const isSchoolAdmin =
      (u.role === 'SCHOOL_ADMIN' || u.role === 'SCHOOL_VICE') &&
      u.schoolId === room.schoolId
    if (!isHost && !isSchoolAdmin) {
      return fail(ack, 'فقط معلم جلسه یا مدیر مدرسه می‌تواند جلسه را پایان دهد')
    }
    try {
      await endLiveSession(room.sessionId, m.userId)
      ack?.({ ok: true })
    } catch (e) {
      console.error('live:end error', e)
      fail(ack, 'خطا در پایان جلسه')
    }
  })

  // ─── گفتگوی متنی جلسه (جدا از گروه عمومی) ───
  socket.on('live:chat', async (payload: { body?: string }, ack?: LiveAck) => {
    const m = socketLive.get(socket.id)
    const room = m ? liveRooms.get(m.sessionId) : undefined
    if (!m || !room) return fail(ack, 'شما در جلسه‌ای حضور ندارید')
    const body = String(payload?.body ?? '').trim()
    if (!body) return fail(ack, 'متن پیام خالی است')
    if (body.length > 2000) return fail(ack, 'پیام بیش از حد بلند است')
    try {
      const row = await db.liveChatMessage.create({
        data: { sessionId: room.sessionId, senderId: m.userId, body },
      })
      const msg = {
        id: row.id,
        senderId: m.userId,
        senderName: u.fullName,
        senderRole: u.role,
        body,
        createdAt: row.createdAt.toISOString(),
      }
      io.to(roomPath(room.sessionId)).emit('live:chat', msg)
      ack?.({ ok: true, data: { id: row.id } })
    } catch (e) {
      console.error('live:chat error', e)
      fail(ack, 'خطا در ثبت پیام')
    }
  })

  // ─── رله WebRTC — حذف شده: رسانه با SFU (LiveKit) منتقل می‌شود؛
  // سرویس socket فقط وضعیت اتاق/مجوزها/گفتگو/تخته را مدیریت می‌کند و
  // فشار رسانه کلاس‌ها هرگز به این سرویس و پیام‌رسان نمی‌رسد.

  socket.on('disconnect', () => {
    leaveSocketFromLive(socket, true)
  })

  // کارهای اولیه اتصال (کوئری اتاق‌ها) پس از ثبت همه هندلرها انجام می‌شود
  ;(async () => {
    const rooms = await roomsForUser(u)
    for (const r of rooms) socket.join(r)
    socket.emit('ready', { at: Date.now() })
  })().catch((e) => console.error('connection setup error', e))
})

httpServer.listen(PORT, () => {
  console.log(
    `[danyar-socket] listening on :${PORT} (path: ${SOCKET_PATH}) — live sessions max ${MAX_PARTICIPANTS}`,
  )
})

// هنگام hot-reload، سرور قدیمی باید کاملاً بسته شود تا فقط یک نمونه روی پورت بماند
// (در غیر این صورت اتصال‌های جدید بین نمونه‌های قدیمی/جدید تقسیم می‌شوند)
try {
  const hot = (import.meta as unknown as { hot?: { on: (e: string, fn: () => void) => void } }).hot
  hot?.on('beforeReload', () => {
    try {
      httpServer.closeAllConnections?.()
      httpServer.close()
    } catch {
      /* ignore */
    }
  })
} catch {
  /* ignore */
}
