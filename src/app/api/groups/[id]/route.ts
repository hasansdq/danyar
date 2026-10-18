import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { getAccessibleGroup, type GroupWithContext } from '@/lib/chat-access'
import { notifySocket } from '@/lib/notify'
import { viceHasPermission } from '@/lib/vice-permissions'

type Params = { params: Promise<{ id: string }> }

const POLICIES = ['ALL', 'STAFF', 'ADMINS']
/** سیاست‌هایی که معلم گروه می‌تواند انتخاب کند (ADMINS فقط از پنل مدیر مدرسه) */
const TEACHER_POLICIES = ['ALL', 'STAFF']

type ManagerSession = { uid: string; role: string; schoolId: string }

/**
 * دسترسی مدیریت گروه:
 * - مدیر مدرسه: گروه‌های مدرسه خودش
 * - معاون: مانند مدیر — فقط با مجوز مدیریت گروه‌ها (سوییچ مدیر مدرسه)
 * - معلم: فقط گروه‌هایی که واقعاً به او منتسب شده‌اند
 */
function getManageableGroup(
  groupId: string,
  session: ManagerSession,
): Promise<GroupWithContext | null> {
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'TEACHER' && session.role !== 'SCHOOL_VICE') {
    return Promise.resolve(null)
  }
  return getAccessibleGroup(
    session as unknown as Parameters<typeof getAccessibleGroup>[0],
    groupId,
  )
}

/** ویرایش گروه: نام، سیاست ارسال پیام، بایگانی/خروج از بایگانی، قفل دانش‌آموزان، تصویر پروفایل */
export async function PATCH(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  // معاون: مانند مدیر مدرسه — فقط با مجوز مدیریت گروه‌ها (سوییچ مدیر)
  if (session.role === 'SCHOOL_VICE' && !(await viceHasPermission(session, 'groups'))) {
    return jsonError('این دسترسی برای شما توسط مدیر مدرسه محدود شده است', 403)
  }

  const group = await getManageableGroup(id, session)
  if (!group) return jsonError('گروه یافت نشد یا اجازه ویرایش ندارید', 404)
  // گروه‌های عمومی مدرسه فقط توسط مدیر/معاون مدرسه قابل ویرایش‌اند
  if (group.scope !== 'CLASS' && session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') {
    return jsonError('ویرایش گروه‌های عمومی مدرسه فقط برای مدیر مدرسه مجاز است', 403)
  }

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const data: {
    name?: string
    messagePolicy?: string
    archivedAt?: Date | null
    lockedForStudents?: boolean
    avatarKey?: string | null
    avatarMime?: string | null
    avatarUpdatedAt?: Date | null
  } = {}

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (name.length < 2) return jsonError('نام گروه باید حداقل ۲ کاراکتر باشد')
    if (name.length > 80) return jsonError('نام گروه حداکثر ۸۰ کاراکتر است')
    // تکراری نبودن نام در همان دامنه (کلاس یا مجموعه گروه‌های عمومی مدرسه)
    const duplicate = await db.subjectGroup.findFirst({
      where:
        group.scope === 'CLASS'
          ? { classroomId: group.classroomId, name, NOT: { id } }
          : { schoolId: group.schoolId, scope: { not: 'CLASS' }, name, NOT: { id } },
    })
    if (duplicate)
      return jsonError(
        group.scope === 'CLASS'
          ? 'گروهی با این نام در این کلاس وجود دارد'
          : 'گروهی با این نام در مدرسه وجود دارد',
        409,
      )
    data.name = name
  }

  if (body.messagePolicy !== undefined) {
    const policy = String(body.messagePolicy)
    if (!POLICIES.includes(policy)) return jsonError('سیاست ارسال نامعتبر است')
    // معلم گروه اجازه تغییر به ADMINS (فقط مدیر مدرسه) ندارد
    if (session.role === 'TEACHER' && !TEACHER_POLICIES.includes(policy)) {
      return jsonError('تغییر به این سیاست فقط برای مدیر مدرسه مجاز است', 403)
    }
    data.messagePolicy = policy
    // هماهنگی دو روش قفل (درخواست کاربر): سیاست STAFF/ADMINS یعنی گروه برای
    // دانش‌آموزان قفل است — پرچم lockedForStudents هم‌زمان هم‌خوان می‌شود تا
    // هر دو روش (هدر گروه و فهرست گروه‌های پنل مدیریت) وضعیت یکسانی ببینند
    data.lockedForStudents = policy === 'STAFF' || policy === 'ADMINS'
  }

  if (body.archived !== undefined) {
    // بایگانی/خروج از بایگانی فقط از پنل مدیریت مدرسه — معلم اجازه ندارد
    if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') {
      return jsonError('بایگانی گروه فقط برای مدیر مدرسه مجاز است', 403)
    }
    data.archivedAt = body.archived === true ? new Date() : null
  }

  if (body.lockedForStudents !== undefined) {
    // قفل/بازکردن قفل گروه برای دانش‌آموزان — فقط مدیر/معاون مدرسه؛ گروه مخفی/حذف نمی‌شود و
    // فقط ارسال پیام/فایل دانش‌آموز بسته می‌شود (مشاهده و بقیه اعضا عادی)
    if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') {
      return jsonError('قفل گروه فقط برای مدیر مدرسه مجاز است', 403)
    }
    const lock = body.lockedForStudents === true
    data.lockedForStudents = lock
    // هماهنگی دو روش قفل (درخواست کاربر): قفل از پنل مدیریت، سیاست ارسال را هم
    // هم‌زمان تغییر می‌دهد تا هدر گروه و تنظیمات گروه همان وضعیت را نشان دهند.
    // سیاست ADMINS (سخت‌گیرتر) هنگام قفل حفظ می‌شود؛ باز کردن قفل → همه اعضا
    const currentPolicy = data.messagePolicy ?? group.messagePolicy
    data.messagePolicy = lock
      ? currentPolicy === 'ADMINS'
        ? 'ADMINS'
        : 'STAFF'
      : 'ALL'
  }

  // تصویر پروفایل گروه — آپلود باید از قبل انجام شده باشد
  if (body.avatarKey !== undefined) {
    if (body.avatarKey === null) {
      data.avatarKey = null
      data.avatarMime = null
      data.avatarUpdatedAt = new Date()
    } else {
      const key = String(body.avatarKey)
      const upload = await db.upload.findUnique({ where: { key } }).catch(() => null)
      if (!upload) return jsonError('فایل آپلودشده یافت نشد؛ دوباره تلاش کنید', 400)
      if (upload.type !== 'IMAGE') return jsonError('تصویر پروفایل باید فایل تصویری باشد', 415)
      data.avatarKey = upload.key
      data.avatarMime = upload.mime
      data.avatarUpdatedAt = new Date()
    }
  }

  const updated = await db.subjectGroup.update({ where: { id }, data })

  // اعضای گروه از تغییرات (بایگانی/سیاست/نام/تصویر) مطلع شوند
  await notifySocket({
    rooms: [`group:${id}`],
    event: 'group:updated',
    data: {
      id,
      archived: !!updated.archivedAt,
      lockedForStudents: updated.lockedForStudents,
      policy: updated.messagePolicy,
      name: updated.name,
      avatarVersion: updated.avatarUpdatedAt
        ? updated.avatarUpdatedAt.getTime()
        : 0,
    },
  })

  return NextResponse.json({
    group: {
      id: updated.id,
      name: updated.name,
      messagePolicy: updated.messagePolicy,
      archived: !!updated.archivedAt,
      lockedForStudents: updated.lockedForStudents,
      avatarVersion: updated.avatarUpdatedAt ? updated.avatarUpdatedAt.getTime() : 0,
    },
  })
}

/** حذف گروه — همراه با هشدار وابستگی‌ها (پیام‌ها) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  // معاون: مانند مدیر — فقط با مجوز مدیریت گروه‌ها (سوییچ مدیر)
  if (session.role === 'SCHOOL_VICE' && !(await viceHasPermission(session, 'groups'))) {
    return jsonError('این دسترسی برای شما توسط مدیر مدرسه محدود شده است', 403)
  }
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') {
    return jsonError('حذف گروه فقط برای مدیر مدرسه مجاز است', 403)
  }
  const { id } = await params

  const group = await db.subjectGroup.findFirst({
    where: {
      id,
      OR: [{ classroom: { schoolId: session.schoolId } }, { schoolId: session.schoolId }],
    },
  })
  if (!group) return jsonError('گروه یافت نشد', 404)

  const messageCount = await db.message.count({ where: { subjectGroupId: id } })
  const confirmed = req.nextUrl.searchParams.get('confirm') === 'true'

  if (messageCount > 0 && !confirmed) {
    return NextResponse.json(
      {
        error: 'این گروه پیام دارد؛ حذف گروه همه پیام‌های آن را نیز حذف می‌کند. برای حذف قطعی تأیید کنید',
        dependencies: { messages: messageCount },
      },
      { status: 409 },
    )
  }

  await notifySocket({
    rooms: [`group:${id}`],
    event: 'group:removed',
    data: { id },
  })
  await db.subjectGroup.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
