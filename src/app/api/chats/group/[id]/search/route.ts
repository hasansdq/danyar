import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { getAccessibleGroup } from '@/lib/chat-access'
import { serializeMessageShape, attachRefTitles } from '@/lib/messaging'

type Params = { params: Promise<{ id: string }> }

/**
 * جست‌وجوی متنی «درون» یک گروه درسی — بین پیام‌های غیرحذف‌شده.
 * نتیجه با refTitle (عنوان تکلیف/نمونه‌سؤال مرتبط) برمی‌گردد.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const { id } = await params

  const group = await getAccessibleGroup(res.session, id)
  if (!group) return jsonError('گروه یافت نشد یا دسترسی ندارید', 404)

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const rows = await db.message.findMany({
    where: {
      subjectGroupId: id,
      deletedAt: null,
      body: { contains: q },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      sender: { select: { id: true, fullName: true, role: true } },
    },
  })

  const results = await attachRefTitles(
    rows.map((m) =>
      serializeMessageShape({
        ...m,
        replyToId: null,
        replyTo: null,
      }),
    ),
  )

  return NextResponse.json({
    results: results.map((m) => ({
      id: m.id,
      type: m.type,
      body: m.body,
      refTitle: m.refTitle,
      createdAt: m.createdAt,
      pinnedAt: m.pinnedAt,
      senderName: m.sender.fullName,
    })),
  })
}
