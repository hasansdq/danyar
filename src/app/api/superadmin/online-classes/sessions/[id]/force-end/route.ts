import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { socketLiveEnd } from '@/lib/online-classes'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/superadmin/online-classes/sessions/[id]/force-end — پایان اجباری جلسه
 * توسط مدیر کل با «تأیید، دلیل و ثبت گزارش مدیریتی»:
 *
 * - بدنه: { reason } — دلیل الزامی است (در گزارش مدیریتی جلسه ذخیره می‌شود)
 * - پایان از طریق سرویس سوکت انجام می‌شود تا: اتصال همهٔ شرکت‌کنندگان قطع،
 *   اتاق LiveKit واقعاً حذف، وضعیت دیتابیس ENDED و دکمه/اعلان‌های کاربران
 *   همگام شود. اگر سوکت در دسترس نباشد، دیتابیس مستقیماً بسته می‌شود.
 * - گزارش مدیریتی = روی خود جلسه: enderId (مدیر کل)، endedAt و forceEndReason.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await guardSuperAdminApi('oc-force-end', 10, 60_000)
  if ('response' in guard) return guard.response
  const session = guard.session
  const { id } = await params

  const body = await req.json().catch(() => null)
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return infraJson({ error: 'ذکر دلیل پایان اجباری جلسه الزامی است' }, 400)
  }
  if (reason.length > 500) {
    return infraJson({ error: 'دلیل پایان بیش از حد بلند است (حداکثر ۵۰۰ نویسه)' }, 400)
  }

  const live = await db.liveSession.findUnique({
    where: { id },
    select: { id: true, status: true, title: true, classroomId: true },
  })
  if (!live) return infraJson({ error: 'جلسه یافت نشد' }, 404)

  if (live.status !== 'ACTIVE') {
    return infraJson({ ok: true, status: 'ENDED', message: 'جلسه قبلاً پایان یافته است' })
  }

  // پایان از طریق سرویس سوکت — هماهنگی DB + سوکت + حذف واقعی اتاق LiveKit
  const viaSocket = await socketLiveEnd(id, session.uid, reason)

  if (!viaSocket) {
    // سوکت در دسترس نیست — بستن مستقیم دیتابیس (اتاق LiveKit با خروج آخرین
    // شرکت‌کننده یا پاک‌سازی دوره‌ای بسته می‌شود؛ وضعیت مرجع DB است)
    const now = new Date()
    await db.liveSession.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: now, enderId: session.uid, forceEndReason: reason },
    })
    await db.liveParticipantLog.updateMany({
      where: { sessionId: id, leftAt: null },
      data: { leftAt: now },
    })
  }

  // راستی‌آزمایی نهایی از دیتابیس — وضعیت مرجع
  const after = await db.liveSession.findUnique({
    where: { id },
    select: { status: true, endedAt: true, forceEndReason: true, enderId: true },
  })

  // گزارش مدیریتی در لاگ سرور (بدون هیچ محرمانه‌ای)
  console.log(
    `[admin] live session ${id} («${live.title}») force-ended by superadmin ${session.uid} — reason: ${reason}${viaSocket ? ' (via socket service — LiveKit room deleted)' : ' (DB fallback)'}`,
  )

  return infraJson({
    ok: true,
    status: after?.status ?? 'ENDED',
    endedAt: after?.endedAt?.toISOString() ?? null,
    forceEndReason: after?.forceEndReason ?? reason,
    viaSocket,
    message: viaSocket
      ? 'جلسه پایان یافت؛ اتصال همهٔ شرکت‌کنندگان قطع و اتاق رسانه حذف شد'
      : 'جلسه در دیتابیس بسته شد (سرویس سوکت در دسترس نبود)',
  })
}
