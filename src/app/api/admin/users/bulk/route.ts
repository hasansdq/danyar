import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import {
  validateUserRows,
  commitValidRows,
  type RawUserRow,
} from '@/lib/user-admin'

/**
 * افزودن گروهی دانش‌آموزان توسط مدیر کل (درخواست کاربر):
 * مدیر کل مدرسه و کلاس را انتخاب می‌کند، لیست دانش‌آموزان را پر می‌کند
 * و با «ثبت کل لیست» همه ثبت می‌شوند. نام کاربری = کدملی، رمز = 123456.
 */
export async function POST(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  const rows: RawUserRow[] | null = Array.isArray(body?.rows) ? body.rows : null
  if (!rows || rows.length === 0) return jsonError('لیست دانش‌آموزان خالی است')
  if (rows.length > 500) return jsonError('حداکثر ۵۰۰ دانش‌آموز در هر بار قابل ثبت است')

  const schoolId = String(body?.schoolId ?? '')
  if (!schoolId) return jsonError('انتخاب مدرسه الزامی است')
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } })
  if (!school) return jsonError('مدرسه یافت نشد', 404)

  const classroomId = String(body?.classroomId ?? '')
  if (!classroomId) return jsonError('ابتدا کلاس موردنظر را انتخاب کنید')
  const classroom = await db.classroom.findFirst({
    where: { id: classroomId, schoolId },
    select: { id: true, name: true },
  })
  if (!classroom) return jsonError('کلاس انتخابی در این مدرسه یافت نشد', 404)

  const { results, valid } = await validateUserRows(rows, {
    fixedRole: 'STUDENT',
    schoolIdForMessage: schoolId,
  })

  const committed = await commitValidRows(valid, { schoolId, classroomId })

  const finalResults = results.map((r, idx) => {
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
      created,
      failed: rows.length - created,
      classroom: classroom.name,
      school: school.name,
    },
    message:
      created === rows.length
        ? `${created} دانش‌آموز در کلاس «${classroom.name}» ثبت شد`
        : `${created} دانش‌آموز ثبت شد؛ ${rows.length - created} ردیف خطا داشت`,
  })
}
