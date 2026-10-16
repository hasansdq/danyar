import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole } from '@/lib/api-auth'
import { maybeSweepPushQueue } from '@/lib/push'

/**
 * GET /api/notifications — فهرست اعلان‌های کاربر + شمارنده نخوانده‌ها
 * همین مسیر به‌عنوان ضربان صف پوش هم عمل می‌کند (کارهای معوق/تلاش مجدد)
 */
export async function GET(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  // اسکن فرصت‌طلبانه صف پوش (درون‌آن محدودساز زمانی دارد؛ مسیر را کند نمی‌کند)
  maybeSweepPushQueue()

  const sp = req.nextUrl.searchParams
  const onlyCount = sp.get('count') === '1'

  const unreadCount = await db.notification.count({
    where: { userId: session.uid, readAt: null },
  })

  if (onlyCount) {
    return NextResponse.json({ unreadCount })
  }

  const items = await db.notification.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({
    unreadCount,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  })
}
