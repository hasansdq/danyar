import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/api-auth'

/**
 * GET /api/admin/sms/logs — گزارش ارسال پیامک‌ها.
 * هرگز شامل کد ورود، کلید محرمانه یا شماره کامل نیست (فقط ماسک).
 */
export async function GET(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const take = Math.min(200, Math.max(10, Number(req.nextUrl.searchParams.get('take') ?? 60)))
  const [logs, total, okCount] = await Promise.all([
    db.smsSendLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    }),
    db.smsSendLog.count(),
    db.smsSendLog.count({ where: { ok: true } }),
  ])

  return NextResponse.json({
    total,
    okCount,
    failCount: total - okCount,
    logs: logs.map((l) => ({
      id: l.id,
      provider: l.provider,
      maskedPhone: l.maskedPhone,
      purpose: l.purpose,
      ok: l.ok,
      error: l.error,
      createdAt: l.createdAt.toISOString(),
    })),
  })
}
