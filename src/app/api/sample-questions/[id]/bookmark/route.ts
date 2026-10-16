import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import {
  sampleQEnabled,
  getSampleQuestionAccess,
  getSampleQuestionById,
} from '@/lib/sampleq-access'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/sample-questions/[id]/bookmark — نشان‌گذاری نمونه‌سؤال (فقط دانش‌آموز با دسترسی واقعی)
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role !== 'STUDENT') {
    return jsonError('نشان‌گذاری فقط برای دانش‌آموز است', 403)
  }
  const enabled = await sampleQEnabled(session.schoolId)
  if (!enabled) return jsonError('نمونه‌سؤالات برای این مدرسه غیرفعال است', 403)

  const { id } = await params
  const question = await getSampleQuestionById(id)
  if (!question) return jsonError('نمونه‌سؤال یافت نشد', 404)
  const access = await getSampleQuestionAccess(session, question)
  if (!access) return jsonError('نمونه‌سؤال یافت نشد یا دسترسی ندارید', 404)

  const existing = await db.sampleQuestionBookmark.findUnique({
    where: { questionId_userId: { questionId: id, userId: session.uid } },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ bookmarked: true, duplicate: true })
  }
  await db.sampleQuestionBookmark.create({
    data: { questionId: id, userId: session.uid },
  })
  return NextResponse.json({ bookmarked: true }, { status: 201 })
}

/** DELETE — حذف نشان‌گذاری (idempotent) */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role !== 'STUDENT') {
    return jsonError('نشان‌گذاری فقط برای دانش‌آموز است', 403)
  }
  const enabled = await sampleQEnabled(session.schoolId)
  if (!enabled) return jsonError('نمونه‌سؤالات برای این مدرسه غیرفعال است', 403)

  const { id } = await params
  await db.sampleQuestionBookmark.deleteMany({
    where: { questionId: id, userId: session.uid },
  })
  return NextResponse.json({ bookmarked: false })
}
