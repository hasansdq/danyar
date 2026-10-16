import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import {
  canAccessClassroom,
  canEndLiveSession,
  getLiveSessionById,
} from '@/lib/live-access'

const SOCKET_INTERNAL_URL =
  process.env.SOCKET_INTERNAL_URL ?? 'http://127.0.0.1:3003'
const INTERNAL_SECRET =
  process.env.SOCKET_INTERNAL_SECRET ?? 'daniar-internal-dev-secret'

/**
 * POST /api/live-sessions/[id]/end — پایان جلسه
 * فقط معلم میزبان یا مدیر همان مدرسه؛ همه شرکت‌کنندگان قطع و پیام دعوت به‌روز می‌شود
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const live = await getLiveSessionById(id)
  if (!live) return jsonError('جلسه یافت نشد', 404)

  // کاربر خارج از کلاس/مدرسه — اصلاً نباید بفهمد جلسه وجود دارد
  const canSee = await canAccessClassroom(session, live.classroom)
  if (!canSee) return jsonError('جلسه یافت نشد', 404)

  const allowed = await canEndLiveSession(session, live)
  if (!allowed) return jsonError('فقط معلم جلسه یا مدیر مدرسه می‌تواند جلسه را پایان دهد', 403)

  if (live.status === 'ENDED') {
    return NextResponse.json({
      ok: true,
      status: 'ENDED',
      message: 'جلسه قبلاً پایان یافته است',
    })
  }

  // پایان جلسه ترجیحاً توسط سرویس سوکت انجام می‌شود تا اتصال همه شرکت‌کنندگان
  // قطع و دکمه پیام دعوت در گروه به «جلسه پایان یافته» تغییر کند
  let viaSocket = false
  try {
    const r = await fetch(`${SOCKET_INTERNAL_URL}/internal/live-end`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({ sessionId: id, enderId: session.uid }),
      signal: AbortSignal.timeout(3000),
    })
    viaSocket = r.ok
  } catch {
    viaSocket = false
  }

  if (!viaSocket) {
    // اگر سرویس سوکت در دسترس نباشد، وضعیت در DB مستقیماً بسته می‌شود
    const now = new Date()
    await db.liveSession.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: now, enderId: session.uid },
    })
    await db.liveParticipantLog.updateMany({
      where: { sessionId: id, leftAt: null },
      data: { leftAt: now },
    })
  }

  return NextResponse.json({ ok: true, status: 'ENDED', message: 'جلسه پایان یافت' })
}
