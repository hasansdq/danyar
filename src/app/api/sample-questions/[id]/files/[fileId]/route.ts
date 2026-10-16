import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole } from '@/lib/api-auth'
import {
  sampleQEnabled,
  getSampleQuestionAccess,
  getSampleQuestionById,
} from '@/lib/sampleq-access'
import { serveStoredFile } from '@/lib/serve-file'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; fileId: string }> }

/**
 * GET /api/sample-questions/[id]/files/[fileId] — سرو امن فایل با کنترل دسترسی سمت سرور:
 * - دسترسی به نمونه‌سؤال الزامی است (دانش‌آموز فقط منتشرشده کلاس خودش)
 * - فایل پاسخ‌نامه برای دانش‌آموز فقط در صورت فعال‌بودن نمایش پاسخ‌نامه
 * - شناسه فایل متعلق به نمونه‌سؤال دیگر → 404
 */
export async function GET(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const enabled = await sampleQEnabled(session.schoolId)
  if (!enabled) {
    return NextResponse.json({ error: 'نمونه‌سؤالات برای این مدرسه غیرفعال است' }, { status: 403 })
  }

  const { id, fileId } = await params
  const question = await getSampleQuestionById(id)
  if (!question) return NextResponse.json({ error: 'نمونه‌سؤال یافت نشد' }, { status: 404 })

  const access = await getSampleQuestionAccess(session, question)
  if (!access) {
    return NextResponse.json({ error: 'نمونه‌سؤال یافت نشد یا دسترسی ندارید' }, { status: 404 })
  }

  const file = await db.sampleQuestionFile.findFirst({
    where: { id: fileId, questionId: id },
  })
  if (!file) return NextResponse.json({ error: 'فایل یافت نشد' }, { status: 404 })

  if (file.role === 'ANSWER' && session.role === 'STUDENT' && !question.showAnswer) {
    return NextResponse.json({ error: 'پاسخ‌نامه توسط معلم فعال نشده است' }, { status: 404 })
  }

  return serveStoredFile(req, file.key, file.mime, file.name)
}
