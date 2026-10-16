import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole } from '@/lib/api-auth'
import { assignmentsEnabled } from '@/lib/assignment-access'
import { serveStoredFile } from '@/lib/serve-file'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * سرو فایل پاسخ دانش‌آموز — دسترسی فقط برای:
 * - خود دانش‌آموز (فایل پاسخ خودش)
 * - معلم منتسب به گروه همان تکلیف
 * - مدیر مدرسه همان مدرسه
 */
export async function GET(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) {
    return NextResponse.json({ error: 'تکالیف برای این مدرسه غیرفعال است' }, { status: 403 })
  }

  const sub = await db.assignmentSubmission.findUnique({
    where: { id },
    include: {
      student: { select: { id: true } },
      assignment: {
        select: {
          subjectGroupId: true,
          dueAt: true,
          subjectGroup: {
            select: { classroom: { select: { schoolId: true } } },
          },
        },
      },
    },
  })
  if (!sub || !sub.fileKey || !sub.fileName) {
    return NextResponse.json({ error: 'فایل یافت نشد' }, { status: 404 })
  }

  const schoolId = sub.assignment.subjectGroup.classroom?.schoolId
  if (session.schoolId !== schoolId) {
    return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 403 })
  }

  if (session.role === 'STUDENT') {
    if (sub.student.id !== session.uid) {
      return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 403 })
    }
  } else if (session.role === 'TEACHER') {
    const assigned = await db.teachingAssignment.findFirst({
      where: { teacherId: session.uid, subjectGroupId: sub.assignment.subjectGroupId },
      select: { id: true },
    })
    if (!assigned) {
      return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 403 })
    }
  }
  // مدیر مدرسه همان مدرسه مجاز است

  return serveStoredFile(req, sub.fileKey, sub.fileMime || 'application/octet-stream', sub.fileName)
}
