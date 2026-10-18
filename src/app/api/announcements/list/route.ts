import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'
import { notifySocket, roomForGroup } from '@/lib/notify'

/**
 * لیست اطلاعیه‌های اخیر مدرسه + حذف اطلاعیه (درخواست کاربر: با کلیک روی آیکون
 * تنظیمات باکس اطلاعیه‌ها، لیست اطلاعیه‌های اخیر را ببیند و مدیریت کند).
 *
 * هر اطلاعیه برای هر گروه هدف یک کپی پیام ایجاد می‌کند؛ رویدادهای تکراری
 * (فرستنده + متن + بازه ۱۰ ثانیه‌ای) به‌عنوان یک اطلاعیه گروه‌بندی و یکجا حذف می‌شوند.
 */

/** گروه‌بندی کپی‌های یک اطلاعیه به یک رویداد واحد */
function isSameEvent(
  a: { senderId: string; body: string; at: number },
  b: { senderId: string; body: string; at: number },
) {
  return a.senderId === b.senderId && a.body === b.body && Math.abs(a.at - b.at) <= 10_000
}

export async function GET() {
  const res = await requireSchoolManager('announcements')
  if ('response' in res) return res.response
  const session = res.session

  const rows = await db.message.findMany({
    where: {
      isAnnouncement: true,
      deletedAt: null,
      subjectGroup: {
        OR: [{ classroom: { schoolId: session.schoolId } }, { schoolId: session.schoolId }],
      },
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      senderId: true,
      sender: { select: { fullName: true } },
      subjectGroup: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
          classroom: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 250,
  })

  // گروه‌بندی کپی‌ها: ردیف‌های متوالی با فرستنده+متن یکسان در بازه ۱۰ ثانیه
  const events: {
    id: string
    body: string
    createdAt: Date
    senderName: string
    targets: { messageId: string; groupId: string; groupName: string; classroomName: string | null; archived: boolean }[]
  }[] = []
  let last: { senderId: string; body: string; at: number } | null = null
  // از قدیمی به جدید پیمایش می‌کنیم (لیست desc → معکوس) تا رویدادها به‌ترتیب زمان ساخته شوند
  for (const m of [...rows].reverse()) {
    // فیلتر کوئری تضمین می‌کند همهٔ اطلاعیه‌ها گروه دارند (خودْ‌گارد تایپی)
    if (!m.subjectGroup) continue
    const t = m.createdAt.getTime()
    const cur = { senderId: m.senderId, body: m.body, at: t }
    if (last && isSameEvent(last, cur)) {
      // کپی همان اطلاعیه قبلی — فقط هدف جدید
      events[events.length - 1].targets.push({
        messageId: m.id,
        groupId: m.subjectGroup.id,
        groupName: m.subjectGroup.name,
        classroomName: m.subjectGroup.classroom?.name ?? null,
        archived: !!m.subjectGroup.archivedAt,
      })
    } else {
      events.push({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        senderName: m.sender.fullName,
        targets: [
          {
            messageId: m.id,
            groupId: m.subjectGroup.id,
            groupName: m.subjectGroup.name,
            classroomName: m.subjectGroup.classroom?.name ?? null,
            archived: !!m.subjectGroup.archivedAt,
          },
        ],
      })
    }
    last = cur
  }

  return NextResponse.json({
    announcements: events.reverse().map((e) => ({
      id: e.id,
      body: e.body,
      createdAt: e.createdAt,
      senderName: e.senderName,
      targets: e.targets,
    })),
  })
}

/** حذف اطلاعیه — همهٔ کپی‌های همان رویداد در همهٔ گروه‌ها یکجا حذف می‌شوند */
export async function DELETE(req: NextRequest) {
  const res = await requireSchoolManager('announcements')
  if ('response' in res) return res.response
  const session = res.session

  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return jsonError('شناسه اطلاعیه لازم است', 400)

  const rep = await db.message.findUnique({
    where: { id },
    include: {
      subjectGroup: {
        select: { id: true, schoolId: true, classroom: { select: { schoolId: true } } },
      },
    },
  })
  if (!rep || !rep.isAnnouncement) return jsonError('اطلاعیه یافت نشد', 404)

  const repSchool = rep.subjectGroup
    ? (rep.subjectGroup.classroom?.schoolId ?? rep.subjectGroup.schoolId)
    : null
  if (repSchool !== session.schoolId) {
    return jsonError('این اطلاعیه به مدرسه شما تعلق ندارد', 403)
  }

  // همهٔ کپی‌های همین رویداد (فرستنده + متن + بازه ۱۰ ثانیه) در همین مدرسه
  const from = new Date(rep.createdAt.getTime() - 10_000)
  const to = new Date(rep.createdAt.getTime() + 10_000)
  const copies = await db.message.findMany({
    where: {
      isAnnouncement: true,
      deletedAt: null,
      senderId: rep.senderId,
      body: rep.body,
      createdAt: { gte: from, lte: to },
      subjectGroup: {
        OR: [{ classroom: { schoolId: session.schoolId } }, { schoolId: session.schoolId }],
      },
    },
    select: { id: true, subjectGroupId: true },
  })

  const deletedAt = new Date()
  for (const c of copies) {
    await db.message.update({
      where: { id: c.id },
      data: {
        deletedAt,
        body: '',
        attachmentKey: null,
        attachmentName: null,
        attachmentMime: null,
        attachmentSize: null,
      },
    })
    if (c.subjectGroupId) {
      // به‌روزرسانی بلادرنگ گفتگوی گروه
      await notifySocket({
        rooms: [roomForGroup(c.subjectGroupId)],
        event: 'message:deleted',
        data: { id: c.id, kind: 'GROUP', subjectGroupId: c.subjectGroupId },
      })
    }
  }

  return NextResponse.json({ ok: true, deleted: copies.length })
}
