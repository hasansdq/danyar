'use client'

/**
 * اجزای مشترک صفحهٔ «مدیریت کلاس‌های آنلاین» — انواع دادهٔ API و نشان‌ها.
 * همهٔ انواع دقیقاً با پاسخ واقعی API هم‌خوان هستند؛ دادهٔ ساختگی وجود ندارد.
 */

import { cn } from '@/lib/utils'
import { faNum, roleLabel } from '@/lib/format'

// ─── انواع پاسخ API ───

export interface SchoolLiveRow {
  id: string
  name: string
  isActive: boolean
  onlineClass: boolean
  liveMaxParticipants: number | null
  liveMaxConcurrent: number | null
  activeSessions: number
  onlineUsers: number
  classroomsCount: number
  effectiveSessionCap: number
  effectiveMaxConcurrent: number
}

export interface SchoolsListData {
  rows: SchoolLiveRow[]
  total: number
  page: number
  pageSize: number
}

export interface SchoolDetailData {
  school: {
    id: string
    name: string
    isActive: boolean
    onlineClass: boolean
    liveMaxParticipants: number | null
    liveMaxConcurrent: number | null
  }
  limits: {
    globalMaxParticipants: number
    effectiveSessionCap: number
    effectiveMaxConcurrent: number
  }
  note: string
  classrooms: {
    id: string
    name: string
    capacity: number | null
    effectiveCapacity: number
    students: number
    groups: number
  }[]
  activeSessions: {
    id: string
    title: string
    classroom: { id: string; name: string }
    host: { id: string; name: string }
    startedAt: string
    announcedAt: string | null
    onlineCount: number
    onlineCountSource: string
    maxParticipants: number
    hostConnected: boolean | null
  }[]
  history: {
    total: number
    page: number
    pageSize: number
    sessions: {
      id: string
      title: string
      classroomName: string
      hostName: string
      startedAt: string
      endedAt: string | null
      durationMin: number | null
      participants: number
      chatMessages: number
      forceEnded: boolean
      forceEndReason: string | null
      enderName: string | null
      enderRole: string | null
    }[]
  }
  stats: StatsData
}

export interface StatsData {
  generatedAt: string
  period: { from: string | null; to: string | null; schoolId: string | null }
  activeSessions: number
  heldSessions: number
  presentUsers: number
  peakAttendance: { value: number; approximate: boolean } | null
  totalDurationMin: number | null
  avgDurationMin: number | null
  reconnects: number
  metricsNotAvailable: string[]
  sources: Record<string, string>
  notAvailableNote?: { quality?: string; resources?: string }
}

export interface SessionDetailData {
  session: {
    id: string
    title: string
    status: string
    startedAt: string
    announcedAt: string | null
    endedAt: string | null
    forceEndReason: string | null
    classroom: { id: string; name: string; capacity: number }
    school: { id: string; name: string }
    host: { id: string; name: string; username: string }
    ender: { name: string; role: string } | null
    chatMessages: number
  }
  presentUsers: {
    count: number
    source: string
    hostConnected: boolean | null
    maxParticipants: number
    participants: {
      userId: string
      name: string
      role: string
      micOn: boolean | null
      camOn: boolean | null
      sharing: boolean | null
      handRaised: boolean | null
    }[]
  }
  livekit: {
    reachable: boolean
    participants: {
      identity: string
      state: string
      isPublisher: boolean
      tracks: { type: string; source: string; muted: boolean }[]
    }[]
    note: string
  } | null
  participantLogs: {
    total: number
    distinctUsers: number
    reconnects: number
    reconnectsDefinition: string
    rows: {
      id: string
      userId: string
      name: string
      role: string
      joinedAt: string
      leftAt: string | null
      kicked: boolean
      reconnects: number
    }[]
  }
}

// ─── نشان‌ها و قالب‌بندی ───

export function OnlineClassBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        enabled
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
          : 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30',
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', enabled ? 'bg-emerald-500' : 'bg-neutral-400')}
        aria-hidden
      />
      {enabled ? 'فعال' : 'غیرفعال'}
    </span>
  )
}

export function SchoolActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        isActive
          ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/25'
          : 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25',
      )}
    >
      {isActive ? 'مدرسه فعال' : 'مدرسه غیرفعال'}
    </span>
  )
}

/** مقدار null را «نامحدود/پیش‌فرض» نشان می‌دهد — نه صفر ساختگی */
export function capLabel(v: number | null, fallback: string): string {
  return v === null ? fallback : `${faNum(v)} نفر`
}

export function concurrentLabel(v: number | null): string {
  if (v === null) return 'نامحدود'
  return `${faNum(v)} جلسه`
}

export function fmtDurationMin(min: number | null): string {
  if (min === null) return 'در دسترس نیست'
  if (min < 60) return `${faNum(Math.round(min * 10) / 10)} دقیقه`
  const h = Math.floor(min / 60)
  const m = Math.round(min - h * 60)
  return m > 0 ? `${faNum(h)} ساعت و ${faNum(m)} دقیقه` : `${faNum(h)} ساعت`
}

export function roleBadgeClass(role: string): string {
  if (role === 'TEACHER') return 'bg-primary/10 text-primary border-primary/25'
  if (role === 'STUDENT') return 'bg-secondary text-secondary-foreground border-border'
  return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25'
}

export { roleLabel }
