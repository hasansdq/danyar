import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import {
  assignmentsEnabled,
  effectiveGroupStudents,
  getAssignmentAccess,
  getAssignmentById,
  serializeSubmission,
} from '@/lib/assignment-access'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/assignments/[id]/submissions — فهرست کامل وضعیت دانش‌آموزان یک تکلیف
 * فقط برای معلم منتسب به گروه و مدیر مدرسه (فقط‌خواندنی).
 * هر دانش‌آموز دیگر هرگز به این فهرست دسترسی ندارد (پاسخ‌ها عمومی نمی‌شوند).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) return jsonError('تکالیف برای این مدرسه غیرفعال است', 403)

  const assignment = await getAssignmentById(id)
  if (!assignment) return jsonError('تکلیف یافت نشد', 404)

  const access = await getAssignmentAccess(session, assignment)
  if (!access) return jsonError('تکلیف یافت نشد یا دسترسی ندارید', 404)
  // دانش‌آموز هرگز فهرست پاسخ‌ها را نمی‌بیند (پاسخ‌ها عمومی نمی‌شوند)
  if (session.role === 'STUDENT') return jsonError('دسترسی غیرمجاز', 403)

  const students = await effectiveGroupStudents(
    assignment.subjectGroupId,
    assignment.subjectGroup.classroom.id,
  )
  const subs = await db.assignmentSubmission.findMany({
    where: { assignmentId: id },
    include: { student: { select: { fullName: true } } },
  })
  const byStudent = new Map(subs.map((s) => [s.studentId, s]))

  const roster = students.map((st) => {
    const sub = byStudent.get(st.id)
    return {
      studentId: st.id,
      fullName: st.fullName,
      isActive: st.isActive,
      submission: sub ? serializeSubmission(sub, assignment.dueAt) : null,
    }
  })

  return NextResponse.json({ roster })
}
