import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import {
  canCreateClassEvent,
  canViewClassCalendar,
  isValidEventType,
  validateRangeParams,
  CLASS_EVENT_TYPE_LABELS,
  type ClassEventType,
} from '@/lib/calendar-events'
import { parseDateKey } from '@/lib/jalali'

/** شکل رویداد برگشتی به کلاینت */
export interface CalendarEventDto {
  id: string
  dateKey: string
  type: string
  customTitle: string | null
  description: string
  /** CLASS | SCHOOL */
  scope: 'CLASS' | 'SCHOOL'
  classroomId: string | null
  createdById: string
  creatorName: string
  createdAt: string
  /** تکلیف درسی مرتبط — فقط نوع HOMEWORK ثبت‌شده از تقویم */
  assignmentId: string | null
  assignmentTitle: string | null
}

/**
 * GET /api/calendar/events?classroomId=…&from=1404-07-01&to=1404-07-30
 * رویدادهای تقویم یک کلاس در بازه داده‌شده (رویدادهای کلاس + رویدادهای کل مدرسه)
 */
export async function GET(request: Request) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const url = new URL(request.url)
  const classroomId = url.searchParams.get('classroomId') ?? ''
  const range = validateRangeParams(url.searchParams.get('from'), url.searchParams.get('to'))
  if (!classroomId) return jsonError('کلاس مشخص نشده است', 400)
  if (!range.ok) return jsonError(range.error, 400)

  const classroom = await db.classroom.findUnique({
    where: { id: classroomId },
    select: { id: true, schoolId: true, name: true },
  })
  if (!classroom) return jsonError('کلاس یافت نشد', 404)

  const canView = await canViewClassCalendar(session, classroom)
  if (!canView) return jsonError('به تقویم این کلاس دسترسی ندارید', 403)

  const events = await db.classEvent.findMany({
    where: {
      schoolId: classroom.schoolId,
      dateKey: { gte: range.from, lte: range.to },
      OR: [{ classroomId }, { classroomId: null }],
    },
    orderBy: [{ dateKey: 'asc' }, { createdAt: 'asc' }],
    include: {
      createdBy: { select: { fullName: true } },
      assignment: { select: { id: true, title: true } },
    },
  })

  const dto: CalendarEventDto[] = events.map((e) => ({
    id: e.id,
    dateKey: e.dateKey,
    type: e.type,
    customTitle: e.customTitle,
    description: e.description,
    scope: e.classroomId ? 'CLASS' : 'SCHOOL',
    classroomId: e.classroomId,
    createdById: e.createdById,
    creatorName: e.createdBy.fullName,
    createdAt: e.createdAt.toISOString(),
    assignmentId: e.assignmentId,
    assignmentTitle: e.assignment?.title ?? null,
  }))
  return NextResponse.json({ events: dto })
}

/**
 * POST /api/calendar/events — ثبت رویداد جدید
 * بدنه: { classroomId, dateKey, type, customTitle?, description?, scope? }
 * - دانش‌آموز: ممنوع (۴۰۳)
 * - معلم: فقط کلاس‌های منتسب خودش و بدون نوع «تعطیل»
 * - مدیر مدرسه: کلاس‌های مدرسه خودش + انتخابی «کل مدرسه» یا کلاس؛ تنها ثبت‌کننده «تعطیل»
 */
export async function POST(request: Request) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonError('درخواست نامعتبر است', 400)
  }

  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : ''
  const dateKeyRaw = typeof body.dateKey === 'string' ? body.dateKey : ''
  const parsedDate = parseDateKey(dateKeyRaw)
  const type = body.type
  if (!classroomId) return jsonError('کلاس مشخص نشده است', 400)
  if (!parsedDate) return jsonError('تاریخ رویداد نامعتبر است', 400)
  if (!isValidEventType(type)) return jsonError('نوع رویداد نامعتبر است', 400)

  // رویداد تعطیل فقط توسط مدیر مدرسه
  if (type === 'HOLIDAY' && session.role !== 'SCHOOL_ADMIN') {
    return jsonError('ثبت رویداد «تعطیل» فقط توسط مدیر مدرسه امکان‌پذیر است', 403)
  }

  // توضیحات اختیاری
  let description = ''
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') return jsonError('توضیحات نامعتبر است', 400)
    description = body.description.trim()
    if (description.length > 1000) return jsonError('توضیحات حداکثر ۱۰۰۰ کاراکتر است', 400)
  }

  // رویداد سفارشی: نام سفارشی الزامی است
  let customTitle: string | null = null
  if (type === 'CUSTOM') {
    if (typeof body.customTitle !== 'string' || !body.customTitle.trim()) {
      return jsonError('نام رویداد سفارشی را وارد کنید', 400)
    }
    customTitle = body.customTitle.trim()
    if (customTitle.length > 60) return jsonError('نام رویداد حداکثر ۶۰ کاراکتر است', 400)
  }

  // دامنه رویداد: مدیر می‌تواند «کل مدرسه» هم انتخاب کند؛ درخواست «کل مدرسه»
  // از سمت معلم/دانش‌آموز مطلقاً رد می‌شود (۴۰۳) — نه تغییر بی‌صدا به کلاس
  if (body.scope === 'SCHOOL' && session.role !== 'SCHOOL_ADMIN') {
    return jsonError('فقط مدیر مدرسه می‌تواند رویداد برای کل مدرسه ثبت کند', 403)
  }
  let scope: 'CLASS' | 'SCHOOL' =
    session.role === 'SCHOOL_ADMIN' && body.scope === 'SCHOOL' ? 'SCHOOL' : 'CLASS'

  // لینک تکلیف درسی — فقط نوع «تکلیف» و فقط معلمِ ایجادکنندهٔ همان تکلیف؛
  // رویداد «کل مدرسه» معنایی برای تکلیف گروه درسی ندارد
  let assignmentId: string | null = null
  if (body.assignmentId !== undefined && body.assignmentId !== null) {
    if (typeof body.assignmentId !== 'string' || !body.assignmentId.trim()) {
      return jsonError('شناسه تکلیف نامعتبر است', 400)
    }
    if (type !== 'HOMEWORK') {
      return jsonError('لینک تکلیف فقط برای رویداد نوع «تکلیف» مجاز است', 400)
    }
    if (scope !== 'CLASS') {
      return jsonError('تکلیف درسی فقط برای یک کلاس ثبت می‌شود', 400)
    }
    const assignment = await db.assignment.findUnique({
      where: { id: body.assignmentId.trim() },
      select: {
        id: true,
        createdById: true,
        subjectGroup: { select: { classroomId: true } },
      },
    })
    if (!assignment || assignment.subjectGroup.classroomId !== classroomId) {
      return jsonError('تکلیف مرتبط با این کلاس یافت نشد', 404)
    }
    if (assignment.createdById !== session.uid) {
      return jsonError('فقط ایجادکنندهٔ تکلیف می‌تواند آن را در تقویم ثبت کند', 403)
    }
    assignmentId = assignment.id
  }

  if (scope === 'CLASS') {
    const classroom = await db.classroom.findUnique({
      where: { id: classroomId },
      select: { id: true, schoolId: true },
    })
    if (!classroom) return jsonError('کلاس یافت نشد', 404)
    const can = await canCreateClassEvent(session, classroom)
    if (!can) {
      if (session.role === 'STUDENT') {
        return jsonError('دانش‌آموز اجازه ثبت رویداد ندارد', 403)
      }
      return jsonError('فقط می‌توانید برای کلاس‌های خودتان رویداد ثبت کنید', 403)
    }
  } else {
    // رویداد کل مدرسه — بررسی دسترسی معلم منتسب معنا ندارد؛ فقط مدیر
    if (session.role !== 'SCHOOL_ADMIN') {
      return jsonError('فقط مدیر مدرسه می‌تواند رویداد برای کل مدرسه ثبت کند', 403)
    }
  }

  const created = await db.classEvent.create({
    data: {
      schoolId: session.schoolId,
      classroomId: scope === 'CLASS' ? classroomId : null,
      dateKey: dateKeyRaw,
      type: type as ClassEventType,
      customTitle,
      description,
      createdById: session.uid,
      assignmentId,
    },
    include: {
      createdBy: { select: { fullName: true } },
      assignment: { select: { id: true, title: true } },
    },
  })

  const dto: CalendarEventDto = {
    id: created.id,
    dateKey: created.dateKey,
    type: created.type,
    customTitle: created.customTitle,
    description: created.description,
    scope: created.classroomId ? 'CLASS' : 'SCHOOL',
    classroomId: created.classroomId,
    createdById: created.createdById,
    creatorName: created.createdBy.fullName,
    createdAt: created.createdAt.toISOString(),
    assignmentId: created.assignmentId,
    assignmentTitle: created.assignment?.title ?? null,
  }
  return NextResponse.json(
    { event: dto, message: `رویداد «${type === 'CUSTOM' ? customTitle : CLASS_EVENT_TYPE_LABELS[type as ClassEventType]}» ثبت شد` },
    { status: 201 },
  )
}
