import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { effectiveCapacity } from '@/lib/live-access'
import { livekitRoomFor } from '@/lib/livekit'
import { livekitListParticipants } from '@/lib/infra/livekit-admin'
import { fetchSocketLiveStats } from '@/lib/online-classes'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/superadmin/online-classes/sessions/[id] — جزئیات جلسه برای مدیر کل:
 * معلم، زمان شروع، افراد حاضر (حافظهٔ زندهٔ سوکت + تطبیق دیتابیس)، وضعیت
 * اتصال LiveKit و گزارش‌های حضور. فقط اطلاعات — بدون هیچ دسترسی به
 * محتوای صوتی/تصویری/تختهٔ کلاس (مشاهدهٔ مخفیانه وجود ندارد).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await guardSuperAdminApi('oc-session-detail', 60, 60_000)
  if ('response' in guard) return guard.response
  const { id } = await params

  const session = await db.liveSession.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      startedAt: true,
      announcedAt: true,
      endedAt: true,
      forceEndReason: true,
      classroom: {
        select: {
          id: true,
          name: true,
          capacity: true,
          school: { select: { id: true, name: true, liveMaxParticipants: true } },
        },
      },
      host: { select: { id: true, fullName: true, username: true } },
      ender: { select: { fullName: true, role: true } },
      _count: { select: { chatMessages: true } },
    },
  })
  if (!session) return infraJson({ error: 'جلسه یافت نشد' }, 404)

  const logs = await db.liveParticipantLog.findMany({
    where: { sessionId: id },
    orderBy: { joinedAt: 'asc' },
    select: {
      id: true,
      userId: true,
      user: { select: { fullName: true, role: true } },
      role: true,
      joinedAt: true,
      leftAt: true,
      kicked: true,
      reconnects: true,
    },
  })

  // وضعیت لحظه‌ای از حافظهٔ سرویس سوکت (فقط جلسات فعال و بارگذاری‌شده)
  const socketStats = session.status === 'ACTIVE' ? await fetchSocketLiveStats(id) : null

  // وضعیت اتصال شرکت‌کنندگان در LiveKit (SFU) — اگر سرویس در دسترس باشد
  let livekitState: {
    reachable: boolean
    participants: {
      identity: string
      state: string
      isPublisher: boolean
      tracks: { type: string; source: string; muted: boolean }[]
    }[]
  } | null = null
  if (session.status === 'ACTIVE') {
    try {
      const r = await livekitListParticipants(livekitRoomFor(id))
      livekitState = {
        reachable: true,
        participants: (r.participants ?? []).map((p) => ({
          identity: p.identity,
          state: p.state ?? 'UNKNOWN',
          isPublisher: !!p.isPublisher,
          tracks: (p.tracks ?? []).map((t) => ({
            type: t.type ?? 'UNKNOWN',
            source: t.source ?? 'UNKNOWN',
            muted: !!t.muted,
          })),
        })),
      }
    } catch {
      livekitState = { reachable: false, participants: [] }
    }
  }

  const presentUsers = logs.filter((l) => !l.leftAt)
  const reconnectTotal = logs.reduce((a, l) => a + (l.reconnects ?? 0), 0)
  const reentries = logs.length - new Set(logs.map((l) => l.userId)).size

  return infraJson({
    session: {
      id: session.id,
      title: session.title,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      announcedAt: session.announcedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      forceEndReason: session.forceEndReason,
      classroom: {
        id: session.classroom.id,
        name: session.classroom.name,
        capacity: effectiveCapacity(
          session.classroom.capacity,
          session.classroom.school?.liveMaxParticipants ?? null,
        ),
      },
      school: { id: session.classroom.school.id, name: session.classroom.school.name },
      host: {
        id: session.host.id,
        name: session.host.fullName,
        username: session.host.username,
      },
      ender: session.ender
        ? { name: session.ender.fullName, role: session.ender.role }
        : null,
      chatMessages: session._count.chatMessages,
    },
    presentUsers: {
      count: socketStats ? socketStats.participants.length : presentUsers.length,
      source: socketStats ? 'سرویس سوکت — حافظهٔ زندهٔ جلسه' : 'دیتابیس — گزارش حضور (سوکت در دسترس نیست)',
      hostConnected: socketStats ? socketStats.hostConnected : null,
      maxParticipants: socketStats
        ? socketStats.maxParticipants
        : effectiveCapacity(
            session.classroom.capacity,
            session.classroom.school?.liveMaxParticipants ?? null,
          ),
      participants: socketStats
        ? socketStats.participants.map((p) => ({
            userId: p.userId,
            name: p.name,
            role: p.role,
            micOn: p.micOn,
            camOn: p.camOn,
            sharing: p.sharing,
            handRaised: p.handRaised,
          }))
        : presentUsers.map((l) => ({
            userId: l.userId,
            name: l.user.fullName,
            role: l.role,
            micOn: null,
            camOn: null,
            sharing: null,
            handRaised: null,
          })),
    },
    livekit: livekitState
      ? {
          ...livekitState,
          note: 'وضعیت اتصال از API مدیریتی LiveKit — شاخص‌های نرخ بیت/packet loss/تأخیر در سمت کلاینت اندازه‌گیری می‌شوند و از این API قابل استخراج نیستند',
        }
      : null,
    participantLogs: {
      total: logs.length,
      distinctUsers: new Set(logs.map((l) => l.userId)).size,
      reconnects: reconnectTotal + reentries,
      reconnectsDefinition:
        'شمار قطع‌ووصل: جایگزینی اتصال سوکت برای همان کاربر + ورودهای مجدد پس از قطع (از گزارش‌های حضور دیتابیس)',
      rows: logs.map((l) => ({
        id: l.id,
        userId: l.userId,
        name: l.user.fullName,
        role: l.role,
        joinedAt: l.joinedAt.toISOString(),
        leftAt: l.leftAt?.toISOString() ?? null,
        kicked: l.kicked,
        reconnects: l.reconnects ?? 0,
      })),
    },
  })
}
