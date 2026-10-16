import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import {
  canAccessClassroom,
  getLiveSessionById,
  LIVE_MAX_PARTICIPANTS,
} from '@/lib/live-access'

/**
 * GET /api/live-sessions/[id] — جزئیات جلسه برای کاربران مجاز کلاس
 * (معلم منتسب، دانش‌آموز همان کلاس، مدیر همان مدرسه) — بقیه 404
 * رسانه با SFU (LiveKit) منتقل می‌شود؛ توکن و سرورهای ICE از /token گرفته می‌شوند
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const live = await getLiveSessionById(id)
  if (!live) return jsonError('جلسه یافت نشد', 404)

  const allowed = await canAccessClassroom(session, live.classroom)
  if (!allowed) return jsonError('جلسه یافت نشد', 404)

  return NextResponse.json({
    id: live.id,
    title: live.title,
    status: live.status,
    startedAt: live.startedAt.toISOString(),
    endedAt: live.endedAt?.toISOString() ?? null,
    // اعلام رسمی شروع — null یعنی هنوز استریم معلم آماده نشده و اعلانی ارسال نشده
    announcedAt: live.announcedAt?.toISOString() ?? null,
    classroom: { id: live.classroom.id, name: live.classroom.name },
    host: { id: live.host.id, fullName: live.host.fullName },
    isHost: live.hostId === session.uid,
    notifyGroup: live.notifyGroup ? { id: live.notifyGroup.id, name: live.notifyGroup.name } : null,
    myRole: session.role,
    maxParticipants: LIVE_MAX_PARTICIPANTS,
  })
}
