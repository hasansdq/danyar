import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import {
  canAccessClassroom,
  getLiveSessionById,
  onlineClassEnabled,
} from '@/lib/live-access'
import { ONLINE_CLASS_DISABLED_MSG } from '@/lib/features'
import { effectiveGroupStudents } from '@/lib/assignment-access'
import { pushNotifications } from '@/lib/notifications'
import { notifySocket, roomForGroup, roomForUser } from '@/lib/notify'
import { serializeMessage } from '@/lib/messaging'

/**
 * POST /api/live-sessions/[id]/announce — اعلام رسمی شروع کلاس
 *
 * فقط پس از آماده‌شدن استریم معلم (ورود میزبان به جلسه + دسترسی واقعی
 * دوربین/میکروفون) از سمت اتاق جلسه فراخوانی می‌شود و یک‌بار برای همیشه:
 * - اعلام با claim اتمیک announcedAt انجام می‌شود؛ فراخوانی تکراری/موازی
 *   هرگز اعلان، پوش، پیام دعوت یا پاپ‌آپ تکراری نمی‌سازد
 * - پیام دعوت خودکار (LIVE_INVITE) در گروه اطلاع‌رسانی منتشر می‌شود
 * - اعلان درون‌برنامه‌ای + پوش مرورگر برای دانش‌آموزان عضو مؤثر گروه ارسال می‌شود
 *   (کلید ضدتکرار یکتا: live:{sessionId} — همان سیستم اعلان موجود، نه سیستم موازی)
 * - رویداد بلادرنگ live:class-started برای پاپ‌آپ دانش‌آموزان همان کلاس
 * - جلسه پایان‌یافته هرگز اعلام نمی‌شود
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const enabled = await onlineClassEnabled(session.schoolId)
  if (!enabled) return jsonError(ONLINE_CLASS_DISABLED_MSG, 403)

  const live = await getLiveSessionById(id)
  if (!live) return jsonError('جلسه یافت نشد', 404)

  // کاربر خارج از کلاس/مدرسه — اصلاً نباید بفهمد جلسه وجود دارد
  const canSee = await canAccessClassroom(session, live.classroom)
  if (!canSee) return jsonError('جلسه یافت نشد', 404)

  // فقط معلم میزبان همان جلسه اعلام شروع را می‌فرستد
  if (session.role !== 'TEACHER' || live.hostId !== session.uid) {
    return jsonError('فقط معلم میزبان می‌تواند شروع کلاس را اعلام کند', 403)
  }

  if (live.status !== 'ACTIVE') {
    return jsonError('این جلسه پایان یافته است؛ اعلام شروع ممکن نیست', 409)
  }

  // claim اتمیک: اگر هم‌زمان چند درخواست برسد فقط یکی announcedAt را ثبت می‌کند
  const now = new Date()
  const claimed = await db.liveSession.updateMany({
    where: { id, status: 'ACTIVE', announcedAt: null },
    data: { announcedAt: now },
  })
  if (claimed.count === 0) {
    // قبلاً اعلام شده (فراخوانی تکراری — بی‌اثر و بدون هیچ اعلان تکراری)
    const fresh = await db.liveSession.findUnique({
      where: { id },
      select: { announcedAt: true, status: true },
    })
    return NextResponse.json({
      ok: true,
      alreadyAnnounced: true,
      announcedAt: fresh?.announcedAt?.toISOString() ?? null,
    })
  }

  const title = live.title
  const teacherName = live.host.fullName
  const classroomName = live.classroom.name

  try {
    // مخاطبان: دانش‌آموزان عضو مؤثر گروه اطلاع‌رسانی همان کلاس
    const students = live.notifyGroupId
      ? await effectiveGroupStudents(live.notifyGroupId, live.classroomId)
      : []
    const audience = students.filter((s) => s.isActive && s.id !== session.uid)

    // پیام دعوت خودکار در گروه (در صورت فعال بودن پیام‌رسانی مدرسه)
    const school = await db.school.findUnique({
      where: { id: live.classroom.schoolId },
      select: { features: true, isActive: true },
    })
    const chatOn =
      !!school &&
      school.isActive &&
      (() => {
        try {
          return JSON.parse(school.features)?.chat === true
        } catch {
          return false
        }
      })()

    if (chatOn && live.notifyGroupId) {
      try {
        const invite = await db.message.create({
          data: {
            kind: 'GROUP',
            subjectGroupId: live.notifyGroupId,
            senderId: session.uid,
            type: 'LIVE_INVITE',
            body: `کلاس آنلاین «${title}» شروع شد.\nمعلم: ${teacherName} — کلاس: ${classroomName}`,
            liveSessionId: id,
            // شناسه قطعی برای جلوگیری از تکرار پیام دعوت
            clientId: `live-invite:${id}`,
          },
        })
        const serialized = await serializeMessage(invite.id)
        await notifySocket({
          rooms: [roomForGroup(live.notifyGroupId)],
          event: 'message:new',
          data: serialized,
        })
      } catch {
        // رقابتی: پیام دعوت قبلاً ساخته شده — تکرار نمی‌شود
      }
    }

    // اعلان درون‌برنامه‌ای + پوش مرورگر (یک‌بار برای هر کاربر با کلید یکتا)
    await pushNotifications(
      audience.map((s) => ({
        userId: s.id,
        type: 'LIVE_SESSION_NEW',
        title: `کلاس آنلاین شروع شد: ${title}`,
        body: `${classroomName} — معلم: ${teacherName}`,
        link: `/live/${id}`,
        dedupeKey: `live:${id}`,
      })),
    )

    // رویداد بلادرنگ پاپ‌آپ شروع کلاس — فقط برای دانش‌آموزان همان کلاس
    if (audience.length) {
      await notifySocket({
        rooms: audience.map((s) => roomForUser(s.id)),
        event: 'live:class-started',
        data: {
          sessionId: id,
          title,
          teacherName,
          classroomName,
          classroomId: live.classroomId,
          startedAt: now.toISOString(),
        },
      })
    }

    return NextResponse.json({
      ok: true,
      announcedAt: now.toISOString(),
      audience: audience.length,
    })
  } catch (e) {
    // خطا در انتشار — اعلام را پس می‌گیریم تا معلم بتواند دوباره تلاش کند
    await db.liveSession
      .updateMany({ where: { id, announcedAt: now }, data: { announcedAt: null } })
      .catch(() => null)
    console.error('live announce error', e)
    return jsonError('اعلام شروع کلاس ناموفق بود؛ دوباره تلاش کنید', 500)
  }
}
