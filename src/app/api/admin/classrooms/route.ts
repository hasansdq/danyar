import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'

/** GET /api/admin/classrooms?schoolId= — کلاس‌های یک مدرسه برای فیلترها (فقط مدیر کل) */
export async function GET(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const schoolId = req.nextUrl.searchParams.get('schoolId') ?? ''
  if (!schoolId) return jsonError('شناسه مدرسه الزامی است')

  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { id: true, liveMaxParticipants: true },
  })
  if (!school) return jsonError('مدرسه یافت نشد', 404)

  const classrooms = await db.classroom.findMany({
    where: { schoolId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, capacity: true },
  })

  // سقف اختصاصی مدرسه هم برگردانده می‌شود تا فرم ظرفیت کلاس محدودهٔ مجاز را بداند
  return NextResponse.json({ classrooms, schoolLiveMaxParticipants: school.liveMaxParticipants })
}

/**
 * PATCH /api/admin/classrooms — تعیین ظرفیت کلاس آنلاین هر کلاس (فقط مدیر کل)
 * بدنه: { classroomId, capacity } — capacity خالی/۰ = حذف ظرفیت اختصاصی
 * (سقف جهانی LIVE_MAX_PARTICIPANTS یا سقف اختصاصی مدرسه اعمال می‌شود)
 *
 * اعتبارسنجی یکپارچه: ظرفیت کلاس هرگز نمی‌تواند از سقف اختصاصی جلسهٔ مدرسه
 * (School.liveMaxParticipants از پنل «مدیریت کلاس‌های آنلاین») بیشتر باشد.
 */
export async function PATCH(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  const classroomId = String(body?.classroomId ?? '')
  if (!classroomId) return jsonError('شناسه کلاس الزامی است')

  const classroom = await db.classroom.findUnique({
    where: { id: classroomId },
    select: { id: true, name: true, school: { select: { liveMaxParticipants: true } } },
  })
  if (!classroom) return jsonError('کلاس یافت نشد', 404)

  // ظرفیت معتبر: ۲ تا ۵۰۰؛ خالی/۰/مقدار نامعتبر = null (سقف مدرسه/سراسری)
  let capacity: number | null = null
  if (body?.capacity !== null && body?.capacity !== undefined && body?.capacity !== '') {
    const n = Number(body.capacity)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 2 || n > 500) {
      return jsonError('ظرفیت باید عددی صحیح بین ۲ تا ۵۰۰ باشد (خالی = سقف سراسری)')
    }
    // ظرفیت اختصاصی کلاس در محدودهٔ سقف مجاز مدرسه
    const schoolCap = classroom.school?.liveMaxParticipants ?? null
    if (schoolCap !== null && n > schoolCap) {
      return jsonError(
        `ظرفیت کلاس نمی‌تواند از سقف افراد هم‌زمان جلسات این مدرسه بیشتر باشد (حداکثر ${schoolCap})`,
      )
    }
    capacity = n
  }

  await db.classroom.update({
    where: { id: classroomId },
    data: { capacity },
  })

  return NextResponse.json({ ok: true, capacity })
}
