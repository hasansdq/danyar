import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { ensureSmsConfig, publicSmsConfig, mergeCredentials } from '@/lib/sms/config'
import { SMS_PROVIDERS } from '@/lib/sms/providers'

/** GET /api/admin/sms/config — پیکربندی ورود و پیامک (کلیدها ماسک‌شده) */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const row = await ensureSmsConfig()
  return NextResponse.json({ config: publicSmsConfig(row) })
}

const clamp = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** PUT /api/admin/sms/config — ذخیره پیکربندی؛ فیلدهای محرمانه فقط با مقدار جدید */
export async function PUT(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  if (!body?.config) return jsonError('داده پیکربندی ارسال نشده است')
  const c = body.config

  await ensureSmsConfig()

  const data: Record<string, unknown> = {}
  if (typeof c.passwordLoginEnabled === 'boolean') data.passwordLoginEnabled = c.passwordLoginEnabled
  if (typeof c.smsLoginEnabled === 'boolean') data.smsLoginEnabled = c.smsLoginEnabled
  if (typeof c.enabled === 'boolean') data.enabled = c.enabled
  if (c.provider !== undefined) {
    if (c.provider !== '' && !(SMS_PROVIDERS as readonly string[]).includes(String(c.provider))) {
      return jsonError('سرویس پیامکی نامعتبر است')
    }
    data.provider = String(c.provider)
  }
  if (c.codeTtlSeconds !== undefined) data.codeTtlSeconds = clamp(c.codeTtlSeconds, 30, 600, 120)
  if (c.resendCooldownSeconds !== undefined)
    data.resendCooldownSeconds = clamp(c.resendCooldownSeconds, 5, 600, 60)
  if (c.maxAttemptsPerCode !== undefined)
    data.maxAttemptsPerCode = clamp(c.maxAttemptsPerCode, 2, 10, 5)
  if (c.maxRequestsPerHour !== undefined)
    data.maxRequestsPerHour = clamp(c.maxRequestsPerHour, 1, 50, 5)
  if (c.credentials && typeof c.credentials === 'object') {
    const current = await db.smsConfig.findUnique({ where: { id: 1 } })
    data.credentials = mergeCredentials(current?.credentials ?? '{}', c.credentials)
  }

  const updated = await db.smsConfig.update({ where: { id: 1 }, data })
  return NextResponse.json({ config: publicSmsConfig(updated) })
}
