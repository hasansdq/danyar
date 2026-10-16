import { NextRequest, NextResponse } from 'next/server'
import { requireAppRole } from '@/lib/api-auth'
import {
  assignmentsEnabled,
  getAssignmentAccess,
  getAssignmentById,
} from '@/lib/assignment-access'
import { serveStoredFile } from '@/lib/serve-file'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/** سرو فایل پیوست تکلیف با کنترل دسترسی سمت سرور */
export async function GET(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) {
    return NextResponse.json({ error: 'تکالیف برای این مدرسه غیرفعال است' }, { status: 403 })
  }

  const assignment = await getAssignmentById(id)
  if (!assignment || !assignment.attachmentKey || !assignment.attachmentName) {
    return NextResponse.json({ error: 'فایل یافت نشد' }, { status: 404 })
  }

  const access = await getAssignmentAccess(session, assignment)
  if (!access) {
    return NextResponse.json({ error: 'تکلیف یافت نشد یا دسترسی ندارید' }, { status: 404 })
  }

  return serveStoredFile(
    req,
    assignment.attachmentKey,
    assignment.attachmentMime || 'application/octet-stream',
    assignment.attachmentName,
  )
}
