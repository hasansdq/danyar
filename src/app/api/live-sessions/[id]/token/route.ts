import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import {
  canAccessClassroom,
  getLiveSessionById,
  iceServersConfig,
  onlineClassEnabled,
  effectiveCapacity,
} from '@/lib/live-access'
import { ONLINE_CLASS_DISABLED_MSG } from '@/lib/features'
import { livekitRoomFor, createLivekitToken, livekitClientUrl, publishSourcesForRole, LIVEKIT_TOKEN_TTL_SECONDS } from '@/lib/livekit'
import { ensureLivekitRuntime } from '@/lib/media-selfheal'

/**
 * POST /api/live-sessions/[id]/token — توکن ورود LiveKit برای اتاق همین جلسه
 *
 * - فقط پس از احراز هویت، فعال‌بودن امکان کلاس آنلاین و بررسی عضویت واقعی کلاس
 * - «بررسی عضویت/اخراج» نهایی از سرویس socket (حافظه جلسه) پرسیده می‌شود؛
 *   کاربر اخراج‌شده هرگز توکن نمی‌گیرد
 * - مجوز انتشار رسانه در توکن متناسب با نقش است؛ دانش‌آموز فقط با اجازه معلم
 *   (به‌روزرسانی RoomService از سرویس socket) و اقدام خودش منتشر می‌کند
 * - توکن فقط در سرور ساخته می‌شود؛ کلاینت هیچ کلید مدیریت LiveKit ندارد
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const live = await getLiveSessionById(id)
  if (!live) return jsonError('جلسه یافت نشد', 404)

  // کلاس آنلاین مدرسهٔ «جلسه» باید فعال باشد — استثنا: اتصال مجدد میزبان جلسهٔ
  // جاری پس از قطع موقت (غیرفعال‌سازی مدرسه ورود جدید را می‌بندد؛ اما جلسات
  // جاری را بدون اقدام صریح مدیر نمی‌کشد و مهلت اتصال مجدد معلم باید کار کند)
  const enabled = await onlineClassEnabled(live.classroom.schoolId)
  const isHostReconnect = live.hostId === session.uid && live.status === 'ACTIVE'
  if (!enabled && !isHostReconnect) return jsonError(ONLINE_CLASS_DISABLED_MSG, 403)

  const allowed = await canAccessClassroom(session, live.classroom)
  if (!allowed) return jsonError('جلسه یافت نشد', 404)

  if (live.status !== 'ACTIVE') {
    return jsonError('این جلسه پایان یافته است', 409)
  }

  // خودترمیم زیرساخت رسانه: کلیدهای غایب از .env/گیت بازگردانی و پروسهٔ
  // LiveKit در صورت نیاز بالا آورده می‌شود (ریشهٔ «پیکربندی نشده» در سندباکس)؛
  // ۵۰۳ فقط وقتی واقعاً هیچ راه بازیابی‌ای نبود به کاربر می‌رسد
  const cfg = await ensureLivekitRuntime()
  if (!cfg) {
    return jsonError('سرویس رسانه (LiveKit) پیکربندی نشده است — با مدیر سرور تماس بگیرید', 503)
  }

  // بررسی نهایی عضویت/اخراج از سرویس socket (حافظه واقعی جلسه)
  const socketUrl = (process.env.SOCKET_INTERNAL_URL?.trim() || 'http://127.0.0.1:3003').replace(/\/$/, '')
  const secret = process.env.SOCKET_INTERNAL_SECRET?.trim() ?? ''
  try {
    const check = await fetch(`${socketUrl}/internal/live-allowed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ sessionId: id, userId: session.uid }),
      signal: AbortSignal.timeout(8000),
    })
    if (!check.ok) {
      const d = (await check.json().catch(() => null)) as { error?: string } | null
      return jsonError(d?.error ?? 'ورود به جلسه رسانه‌ای مجاز نیست', check.status === 403 ? 403 : 503)
    }
  } catch {
    // سرویس socket در دسترس نیست → بدون تأیید عضویت هیچ توکنی صادر نمی‌شود
    return jsonError('سرویس جلسه در دسترس نیست؛ بعداً تلاش کنید', 503)
  }

  const identity = session.uid
  const room = livekitRoomFor(id)
  const { canPublish, sources } = publishSourcesForRole(session.role)
  // سقف مؤثر این جلسه — حداقلِ سقف جهانی، سقف اختصاصی مدرسه و ظرفیت اختصاصی کلاس
  // (معلم میزبان نیز جزو این ظرفیت است؛ در خود LiveKit هم اعمال می‌شود)
  const cap = effectiveCapacity(
    live.classroom.capacity,
    live.classroom.school?.liveMaxParticipants ?? null,
  )

  const token = await createLivekitToken(cfg, {
    identity,
    name: session.fullName,
    room,
    metadata: JSON.stringify({ name: session.fullName, role: session.role }),
    canPublish,
    canPublishSources: sources,
    canSubscribe: true,
    maxParticipants: cap,
    ttlSeconds: LIVEKIT_TOKEN_TTL_SECONDS,
  })

  const url = livekitClientUrl(
    req.headers.get('host'),
    req.headers.get('x-forwarded-proto'),
    req.headers.get('x-forwarded-host'),
    req.headers.get('origin'),
  )
  return NextResponse.json({
    token,
    url,
    identity,
    room,
    canPublish,
    iceServers: iceServersConfig(),
    maxParticipants: cap,
  })
}
