import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'
import {
  validateUserRows,
  commitValidRows,
  roleFa,
  type RawUserRow,
} from '@/lib/user-admin'
import { vicePermissionDenied } from '@/lib/vice-permissions'

type ImportRow = RawUserRow

/**
 * ایمپورت دانش‌آموزان از فایل اکسل (درخواست کاربر):
 * فرمت جدید: نام | نام خانوادگی | نقش | کدملی | شماره همراه
 * مدیر باید قبل از آپلود، کلاس موردنظر را انتخاب کند (کلاس به دانش‌آموزهای فایل اعمال می‌شود؛
 * ردیف‌های معلم بدون کلاس ثبت می‌شوند).
 * commit=false → فقط اعتبارسنجی و پیش‌نمایش (بدون هیچ ثبت)
 * commit=true → ثبت ردیف‌های سالم؛ ردیف‌های خطادار رد می‌شوند
 * رمز همه کاربران جدید = 123456 (پیش‌فرض پلتفرم)
 */
export async function POST(req: NextRequest) {
  const res = await requireSchoolManager()
  if ('response' in res) return res.response
  const schoolId = res.session.schoolId

  const body = await req.json().catch(() => null)
  const rows: ImportRow[] | null = Array.isArray(body?.rows) ? body.rows : null
  if (!rows || rows.length === 0) return jsonError('هیچ ردیفی برای بررسی ارسال نشده است')
  if (rows.length > 500) return jsonError('حداکثر ۵۰۰ ردیف در هر بار قابل ثبت است')
  const commit = body?.commit === true

  // کلاس انتخابی مدیر — الزامی
  const classroomId = String(body?.classroomId ?? '')
  if (!classroomId) return jsonError('قبل از آپلود فایل، کلاس موردنظر را انتخاب کنید')
  const classroom = await db.classroom.findFirst({
    where: { id: classroomId, schoolId },
    select: { id: true, name: true },
  })
  if (!classroom) return jsonError('کلاس انتخابی در مدرسه شما یافت نشد', 404)

  const { results, valid } = await validateUserRows(
    // نقش خالی در اکسل = دانش‌آموز (ایمپورت عمدتاً برای دانش‌آموزان است)
    rows.map((r) => ({
      ...r,
      role:
        r?.role === undefined || r?.role === null || String(r.role).trim() === ''
          ? 'STUDENT'
          : r.role,
    })),
    { allowedRoles: ['TEACHER', 'SCHOOL_VICE', 'STUDENT'], schoolIdForMessage: schoolId },
  )
  // شماره ردیف اکسل: ردیف ۱ سرستون است؛ نتایج کتابخانه از ۱ شروع می‌شود
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

  // معاون — مجوزهای ثبت‌نام بر اساس نقش ردیف‌های سالم (سوییچ مدیر مدرسه):
  // پیش‌نمایش آزاد است؛ ثبت واقعی نیازمند مجوز مربوطه است و ساختن معاون مجاز نیست
  if (res.session.role === 'SCHOOL_VICE') {
    if (valid.some((v) => v.role === 'SCHOOL_VICE')) {
      return jsonError('ایجاد حساب معاون فقط توسط مدیر مدرسه انجام می‌شود', 403)
    }
    if (valid.some((v) => v.role === 'TEACHER')) {
      const denied = await vicePermissionDenied(res.session, 'register_teachers')
      if (denied) return denied
    }
    if (valid.some((v) => v.role === 'STUDENT')) {
      const denied = await vicePermissionDenied(res.session, 'register_students')
      if (denied) return denied
    }
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
    },
    committed: true,
  })
}
