import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import { vicePermissionDenied } from '@/lib/vice-permissions'

/**
 * DELETE /api/attendance/violations/[id] — حذف تخلف ثبت‌شده
 * فقط ثبت‌کنندهٔ خودش، مدیر مدرسه؛ معاون با مجوز attendance.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  if (session.role === 'STUDENT') return jsonError('دسترسی غیرمجاز', 403)
  const { id } = await params

  const violation = await db.studentViolation.findUnique({
    where: { id },
    include: { classroom: { select: { schoolId: true } } },
  })
  if (!violation) return jsonError('تخلف یافت نشد', 404)
  if (!session.schoolId || session.schoolId !== violation.classroom.schoolId) {
    return jsonError('دسترسی غیرمجاز', 403)
  }

  if (session.role === 'SCHOOL_VICE') {
    // معاون: فقط با مجوز مدیریت حضور و غیاب
    const denied = await vicePermissionDenied(session, 'attendance')
    if (denied) return denied
  } else if (session.role !== 'SCHOOL_ADMIN' && violation.creatorId !== session.uid) {
    // معلم فقط تخلف خودش را حذف می‌کند
    return jsonError('فقط ثبت‌کننده یا مدیر مدرسه می‌تواند حذف کند', 403)
  }

  await db.studentViolation.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
