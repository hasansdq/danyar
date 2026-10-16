import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { ensureSmsConfig } from '@/lib/sms/config'
import { sendBulkTextViaProvider } from '@/lib/sms/providers'
import { maskPhone } from '@/lib/phone'
import { pushNotifications } from '@/lib/notifications'
import { APP_ROLES } from '@/lib/session'

/**
 * ارسال انبوه پیامک/اعلان به کاربران — فقط مدیر کل.
 * مخاطبان با فیلتر مدرسه/کلاس/نقش انتخاب می‌شوند؛ فقط کاربران فعال و
 * نقش‌های اپ (بدون مدیر کل). حداکثر ۱۰۰۰ گیرنده در هر ارسال.
 */

const MAX_RECIPIENTS = 1000

interface AudienceResult {
  users: { id: string; phone: string | null }[]
  byRole: Record<string, number>
}

async function resolveAudience(
  roles: string[],
  schoolId: string | null,
  classroomId: string | null,
): Promise<AudienceResult> {
  const baseWhere: Record<string, unknown> = {
    isActive: true,
    role: { in: roles },
  }
  if (schoolId) baseWhere.schoolId = schoolId

  if (!classroomId) {
    const users = await db.user.findMany({
      where: baseWhere,
      select: { id: true, phone: true, role: true },
      take: MAX_RECIPIENTS + 1,
      orderBy: { createdAt: 'asc' },
    })
    const byRole: Record<string, number> = {}
    for (const u of users) byRole[u.role] = (byRole[u.role] ?? 0) + 1
    return { users: users.map(({ id, phone }) => ({ id, phone })), byRole }
  }

  // فیلتر کلاس: دانش‌آموزان ثبت‌نام‌شده + معلمان منتسب به گروه‌های آن کلاس
  // + مدیران همان مدرسه (بسته به نقش‌های انتخابی)
  const classroom = await db.classroom.findUnique({
    where: { id: classroomId },
    select: { id: true, schoolId: true },
  })
  if (!classroom) throw new Error('CLASSROOM_NOT_FOUND')
  if (schoolId && classroom.schoolId !== schoolId) throw new Error('CLASSROOM_SCHOOL_MISMATCH')

  const ids = new Set<string>()
  const byRole: Record<string, number> = {}
  const addUsers = async (role: string, where: Record<string, unknown>) => {
    if (!roles.includes(role)) return
    const rows = await db.user.findMany({
      where: { ...where, isActive: true, role },
      select: { id: true, phone: true },
      take: MAX_RECIPIENTS,
    })
    for (const r of rows) ids.add(r.id)
    byRole[role] = rows.length
  }

  if (roles.includes('STUDENT')) {
    const enrollments = await db.classroomEnrollment.findMany({
      where: { classroomId: classroom.id, student: { isActive: true } },
      select: { studentId: true },
    })
    const studentRows = await db.user.findMany({
      where: { id: { in: enrollments.map((e) => e.studentId) }, isActive: true, role: 'STUDENT' },
      select: { id: true, phone: true },
    })
    for (const r of studentRows) ids.add(r.id)
    byRole.STUDENT = studentRows.length
  }
  await addUsers('TEACHER', {
    teachingAssignments: { some: { subjectGroup: { classroomId: classroom.id } } },
  })
  await addUsers('SCHOOL_ADMIN', { schoolId: classroom.schoolId })

  const users = await db.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, phone: true },
  })
  return { users, byRole }
}

/** POST /api/admin/bulk — dryRun=true فقط شمارش مخاطبان؛ false ارسال واقعی */
export async function POST(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const admin = res.session

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const channel = body.channel === 'sms' ? 'sms' : body.channel === 'push' ? 'push' : null
  if (!channel) return jsonError('کانال ارسال نامعتبر است')

  const roles = Array.isArray(body.roles) && body.roles.length
    ? body.roles.filter((r: unknown): r is string => typeof r === 'string' && (APP_ROLES as string[]).includes(r))
    : [...APP_ROLES]
  if (!roles.length) return jsonError('حداقل یک نقش باید انتخاب شود')

  const schoolId = body.schoolId ? String(body.schoolId) : null
  const classroomId = body.classroomId ? String(body.classroomId) : null
  const dryRun = body.dryRun === true

  if (schoolId) {
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true } })
    if (!school) return jsonError('مدرسه یافت نشد', 404)
  }

  // متن پیام‌ها — در حالت پیش‌شمارش الزامی نیست
  let text = ''
  let pushTitle = ''
  if (channel === 'sms') {
    text = String(body.text ?? '').trim()
    if (!dryRun) {
      if (text.length < 2) return jsonError('متن پیامک باید حداقل ۲ کاراکتر باشد')
      if (text.length > 500) return jsonError('متن پیامک حداکثر ۵۰۰ کاراکتر است')
    }
  } else {
    pushTitle = String(body.title ?? '').trim()
    text = String(body.body ?? '').trim()
    if (!dryRun) {
      if (pushTitle.length < 2) return jsonError('عنوان اعلان باید حداقل ۲ کاراکتر باشد')
      if (pushTitle.length > 100) return jsonError('عنوان اعلان حداکثر ۱۰۰ کاراکتر است')
      if (text.length > 1000) return jsonError('متن اعلان حداکثر ۱۰۰۰ کاراکتر است')
    }
  }

  let audience: AudienceResult
  try {
    audience = await resolveAudience(roles, schoolId, classroomId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'CLASSROOM_NOT_FOUND') return jsonError('کلاس یافت نشد', 404)
    if (msg === 'CLASSROOM_SCHOOL_MISMATCH') return jsonError('کلاس با مدرسه انتخابی هم‌خوان نیست', 400)
    throw e
  }

  if (audience.users.length > MAX_RECIPIENTS) {
    return jsonError(`تعداد مخاطبان بیش از سقف ${MAX_RECIPIENTS} نفر است؛ فیلتر را محدودتر کنید`, 400)
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      total: audience.users.length,
      byRole: audience.byRole,
      withPhone: audience.users.filter((u) => !!u.phone).length,
    })
  }

  if (audience.users.length === 0) {
    return jsonError('هیچ کاربری با این فیلترها یافت نشد', 400)
  }

  let sent = 0
  let failed = 0
  let skipped = 0
  const errors: string[] = []

  if (channel === 'sms') {
    const config = await ensureSmsConfig()
    if (!config.enabled || !config.provider) {
      return jsonError('سرویس پیامکی پیکربندی نشده است؛ ابتدا از بخش «ورود پیامکی» تنظیم کنید', 400)
    }
    let credentials: Record<string, string> = {}
    try {
      credentials = JSON.parse(config.credentials ?? '{}')
    } catch {
      credentials = {}
    }

    for (const u of audience.users) {
      const phone = u.phone
      if (!phone) {
        skipped++
        continue
      }
      const r = await sendBulkTextViaProvider(config.provider, credentials, phone, text)
      if (r.ok) {
        sent++
      } else {
        failed++
        if (errors.length < 5) errors.push(r.error ?? 'خطای نامشخص')
      }
      await db.smsSendLog.create({
        data: {
          provider: config.provider,
          maskedPhone: maskPhone(phone),
          purpose: 'BULK',
          ok: r.ok,
          error: r.ok ? null : (r.error ?? '').slice(0, 200) || null,
        },
      }).catch(() => null)
      // فاصله کوتاه بین ارسال‌ها (محدودیت نرخ سرویس‌ها)
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  } else {
    // اعلان: از همان خط لوله اعلان درون‌برنامه‌ای + پوش واقعی (ضدتکرار با dedupeKey)
    const eventId = `bulk:${randomUUID()}`
    await pushNotifications(
      audience.users.map((u) => ({
        userId: u.id,
        type: 'ADMIN_BROADCAST',
        title: pushTitle,
        body: text,
        link: '/notifications',
        dedupeKey: `${eventId}:${u.id}`,
      })),
    )
    sent = audience.users.length
  }

  const log = await db.bulkSendLog.create({
    data: {
      senderId: admin.uid,
      channel: channel === 'sms' ? 'SMS' : 'PUSH',
      schoolId,
      classroomId,
      roles: JSON.stringify(roles),
      text: channel === 'sms' ? text : `${pushTitle}\n${text}`.trim(),
      total: audience.users.length,
      sent,
      failed,
      skipped,
      ok: failed === 0,
      error: errors.length ? errors[0] : null,
    },
  })

  return NextResponse.json({
    ok: true,
    logId: log.id,
    total: audience.users.length,
    sent,
    failed,
    skipped,
    errors,
  })
}

/** GET /api/admin/bulk — گزارش ارسال‌های انبوه اخیر (بدون شماره کامل) */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const logs = await db.bulkSendLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      channel: true,
      schoolId: true,
      classroomId: true,
      roles: true,
      text: true,
      total: true,
      sent: true,
      failed: true,
      skipped: true,
      ok: true,
      error: true,
      createdAt: true,
    },
  })
  const schoolIds = [...new Set(logs.map((l) => l.schoolId).filter((s): s is string => !!s))]
  const schools = schoolIds.length
    ? await db.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true } })
    : []
  const classroomIds = [...new Set(logs.map((l) => l.classroomId).filter((s): s is string => !!s))]
  const classrooms = classroomIds.length
    ? await db.classroom.findMany({ where: { id: { in: classroomIds } }, select: { id: true, name: true } })
    : []

  return NextResponse.json({
    logs: logs.map((l) => ({
      ...l,
      schoolName: schools.find((s) => s.id === l.schoolId)?.name ?? null,
      classroomName: classrooms.find((c) => c.id === l.classroomId)?.name ?? null,
    })),
  })
}
