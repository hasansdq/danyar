import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole } from '@/lib/api-auth'
import { listAccessibleGroupIds, getSchoolFeatures, groupSubtitle } from '@/lib/chat-access'
import { listDmCandidates } from '@/lib/dm-candidates'

/**
 * جست‌وجوی «نام» گفتگوها و گروه‌ها — فقط در نام گروه‌ها و نام افراد گفتگوی خصوصی؛
 * طبق درخواست کاربر، محتوای پیام‌های درون گفتگوها جست‌وجو نمی‌شود.
 */
export async function GET(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()

  if (q.length < 2) {
    return NextResponse.json({ conversations: [], messages: [] })
  }

  const groupIds = await listAccessibleGroupIds(session)

  // ─── گفتگوهای منطبق (فقط نام) ───
  const groups = groupIds.length
    ? await db.subjectGroup.findMany({
        where: { id: { in: groupIds }, name: { contains: q } },
        include: { classroom: { select: { name: true } } },
        take: 10,
      })
    : []

  const features = await getSchoolFeatures(session.schoolId)
  let userMatches: {
    id: string
    fullName: string
    role: string
    label: string
  }[] = []
  if (features.dm) {
    const candidates = await listDmCandidates(session)
    userMatches = candidates.candidates
      .filter((c) => c.fullName.includes(q))
      .slice(0, 10)
      .map((c) => ({ id: c.id, fullName: c.fullName, role: c.role, label: c.label }))
  }

  return NextResponse.json({
    conversations: [
      ...groups.map((g) => ({
        key: `group:${g.id}`,
        type: 'GROUP' as const,
        title: g.name,
        subtitle: groupSubtitle(g),
        archived: !!g.archivedAt,
      })),
      ...userMatches.map((u) => ({
        key: `dm:${u.id}`,
        type: 'DM' as const,
        title: u.fullName,
        subtitle: u.label,
        archived: false,
      })),
    ],
    // جست‌وجوی متن پیام‌ها حذف شد (فقط نام گفتگوها) — کلید برای سازگاری خالی نگه داشته شد
    messages: [],
  })
}
