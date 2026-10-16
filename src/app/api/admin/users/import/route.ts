import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import {
  validateUserRows,
  commitValidRows,
  roleFa,
  type RawUserRow,
} from '@/lib/user-admin'

/**
 * ایمپورت اکسل توسط مدیر کل (درخواست کاربر):
 * مدیر کل مدرسه و کلاس را انتخاب می‌کند، فایل با ستون‌های
 * نام | نام خانوادگی | نقش | کدملی | شماره همراه را آپلود می‌کند.
 * کلاس به دانش‌آموزهای فایل اعمال می‌شود؛ رمز همه = 123456.
 * commit=false → پیش‌نمایش؛ commit=true → ثبت.
 */
export async function POST(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  const rows: RawUserRow[] | null = Array.isArray(body?.rows) ? body.rows : null
  if (!rows || rows.length === 0) return jsonError('هیچ ردیفی برای بررسی ارسال نشده است')
  if (rows.length > 500) return jsonError('حداکثر ۵۰۰ ردیف در هر بار قابل ثبت است')
  const commit = body?.commit === true

  const schoolId = String(body?.schoolId ?? '')
  if (!schoolId) return jsonError('انتخاب مدرسه الزامی است')
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } })
  if (!school) return jsonError('مدرسه یافت نشد', 404)

  const classroomId = String(body?.classroomId ?? '')
  if (!classroomId) return jsonError('قبل از آپلود فایل، کلاس موردنظر را انتخاب کنید')
  const classroom = await db.classroom.findFirst({
    where: { id: classroomId, schoolId },
    select: { id: true, name: true },
  })
  if (!classroom) return jsonError('کلاس انتخابی در این مدرسه یافت نشد', 404)

  const { results, valid } = await validateUserRows(
    // نقش خالی در اکسل = دانش‌آموز
    rows.map((r) => ({
      ...r,
      role:
        r?.role === undefined || r?.role === null || String(r.role).trim() === ''
          ? 'STUDENT'
          : r.role,
    })),
    { schoolIdForMessage: schoolId },
  )
  // شماره ردیف اکسل: ردیف ۱ سرستون است
  const labeled = results.map((r) => ({ ...r, row: r.row + 1, role: r.role ? roleFa(r.role) : '' }))

  if (!commit) {
    return NextResponse.json({
      results: labeled,
      summary: {
        total: rows.length,
        valid: results.filter((r) => r.status === 'ok').length,
        invalid: results.filter((r) => r.status === 'error').length,
      },
      committed: false,
    })
  }

  const committed = await commitValidRows(valid, { schoolId, classroomId })

  const finalResults = labeled.map((r, idx) => {
    const c = committed[String(idx)]
    if (r.status === 'ok' && c && !c.ok) {
      return { ...r, status: 'error' as const, error: c.error ?? 'خطا در ثبت' }
    }
    return r
  })
  const created = finalResults.filter((r) => r.status === 'ok').length

  return NextResponse.json({
    results: finalResults,
    summary: {
      total: rows.length,
      valid: created,
      invalid: rows.length - created,
      created,
      classroom: classroom.name,
      school: school.name,
    },
    committed: true,
  })
}
