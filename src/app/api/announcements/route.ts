import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { requireSchoolAdmin, jsonError } from '@/lib/api-auth'
import { getSchoolFeatures } from '@/lib/chat-access'
import { serializeMessage, previewOf } from '@/lib/messaging'
import {
  pushNotifications,
  effectiveGroupAudience,
} from '@/lib/notifications'
import { notifySocket, roomForGroup } from '@/lib/notify'

/**
 * ارسال اطلاعیه مدیر مدرسه به کلاس‌ها و/یا گروه‌های انتخاب‌شده.
 * اطلاعیه برای کلاس به همه گروه‌های فعال آن کلاس تحویل می‌شود.
 */
export async function POST(req: NextRequest) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const session = res.session

  const features = await getSchoolFeatures(session.schoolId)
  if (!features.chat) {
    return jsonError('پیام‌رسانی گروهی برای این مدرسه غیرفعال است', 403)
  }

  const body = await req.json().catch(() => null)
  const text = String(body?.body ?? '').trim()
  const classroomIds: string[] = Array.isArray(body?.classroomIds)
    ? body.classroomIds.map(String)
    : []
  const subjectGroupIds: string[] = Array.isArray(body?.subjectGroupIds)
    ? body.subjectGroupIds.map(String)
    : []

  if (text.length < 2) return jsonError('متن اطلاعیه باید حداقل ۲ کاراکتر باشد')
  if (text.length > 4000) return jsonError('متن اطلاعیه بیش از حد مجاز است')
  if (classroomIds.length === 0 && subjectGroupIds.length === 0) {
    return jsonError('حداقل یک کلاس یا گروه انتخاب کنید')
  }

  // اعتبارسنجی مالکیت
  const ownedClassrooms = await db.classroom.findMany({
    where: { id: { in: classroomIds }, schoolId: session.schoolId },
    select: { id: true },
  })
  const invalidClassrooms = classroomIds.filter(
    (id) => !ownedClassrooms.some((c) => c.id === id),
  )
  if (invalidClassrooms.length) {
    return jsonError('برخی کلاس‌ها به مدرسه شما تعلق ندارند', 403)
  }

  const ownedGroups = await db.subjectGroup.findMany({
    where: { id: { in: subjectGroupIds }, classroom: { schoolId: session.schoolId } },
    select: { id: true },
  })
  const invalidGroups = subjectGroupIds.filter(
    (id) => !ownedGroups.some((g) => g.id === id),
  )
  if (invalidGroups.length) {
    return jsonError('برخی گروه‌ها به مدرسه شما تعلق ندارند', 403)
  }

  // جمع‌آوری گروه‌های هدف: گروه‌های انتخابی + گروه‌های فعال کلاس‌های انتخابی
  const groupsFromClass = await db.subjectGroup.findMany({
    where: { classroomId: { in: classroomIds }, archivedAt: null },
    select: { id: true, classroomId: true },
  })
  const selectedGroups = await db.subjectGroup.findMany({
    where: { id: { in: subjectGroupIds } },
    select: { id: true, classroomId: true },
  })

  const targetGroupIds = [
    ...new Set([...groupsFromClass.map((g) => g.id), ...selectedGroups.map((g) => g.id)]),
  ]

  if (targetGroupIds.length === 0) {
    return jsonError(
      'گروه فعالی برای تحویل اطلاعیه پیدا نشد؛ ابتدا برای کلاس/گروه‌های انتخابی گروه درسی بسازید',
    )
  }

  // ایجاد پیام اطلاعیه در هر گروه هدف
  const createdIds: string[] = []
  for (const groupId of targetGroupIds) {
    const created = await db.message.create({
      data: {
        kind: 'GROUP',
        subjectGroupId: groupId,
        senderId: session.uid,
        type: 'ANNOUNCEMENT',
        body: text,
        isAnnouncement: true,
      },
    })
    createdIds.push(created.id)
  }

  // broadcast بلادرنگ به هر گروه
  for (const groupId of targetGroupIds) {
    const msg = createdIds[targetGroupIds.indexOf(groupId)]
    const serialized = await serializeMessage(msg)
    await notifySocket({
      rooms: [roomForGroup(groupId)],
      event: 'message:new',
      data: serialized,
    })
  }

  // اعلان «اطلاعیه مدرسه» — هر کاربر فقط یک‌بار برای هر رویداد اطلاعیه
  // (حتی اگر عضو چند گروه هدف باشد)؛ بی‌صدایی روی اطلاعیه رسمی اثر ندارد
  const eventId = `ann:${randomUUID()}`
  const notified = new Map<string, string>() // userId → لینک گروه
  const groupsWithClass = [
    ...groupsFromClass,
    ...selectedGroups.filter((g) => !groupsFromClass.some((x) => x.id === g.id)),
  ]
  for (const g of groupsWithClass) {
    const audience = await effectiveGroupAudience({
      id: g.id,
      scope: 'CLASS',
      grade: null,
      classroomId: g.classroomId,
      schoolId: session.schoolId,
    })
    for (const u of audience) {
      if (u.id === session.uid || !u.isActive) continue
      if (!notified.has(u.id)) {
        notified.set(u.id, `/chats/group/${g.id}`)
      }
    }
  }
  await pushNotifications(
    [...notified.entries()].map(([uid, link]) => ({
      userId: uid,
      type: 'SCHOOL_ANNOUNCEMENT',
      title: `اطلاعیه مدرسه از ${session.fullName}`,
      body: previewOf({ type: 'ANNOUNCEMENT', body: text, deletedAt: null }),
      link,
      dedupeKey: eventId,
    })),
  )

  return NextResponse.json(
    { ok: true, delivered: targetGroupIds.length },
    { status: 201 },
  )
}

/** فهرست کلاس‌ها و گروه‌های مدرسه برای انتخاب هدف اطلاعیه */
export async function GET() {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response

  const classrooms = await db.classroom.findMany({
    where: { schoolId: res.session.schoolId },
    orderBy: { createdAt: 'asc' },
    include: {
      subjectGroups: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, archivedAt: true },
      },
    },
  })

  return NextResponse.json({
    classrooms: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      groups: c.subjectGroups.map((g) => ({
        id: g.id,
        name: g.name,
        archived: !!g.archivedAt,
      })),
    })),
  })
}
