import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/api-auth'
import { getAiConfig, maskKey } from '@/lib/ai/access'

/** تنظیمات سرویس هوش مصنوعی — کلید API هرگز برگردانده نمی‌شود */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const cfg = await getAiConfig()
  return NextResponse.json({
    config: {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      enabled: cfg.enabled,
      generalInstruction: cfg.generalInstruction,
      managerInstruction: cfg.managerInstruction,
      maxToolCalls: cfg.maxToolCalls,
      ...maskKey(cfg.apiKey),
    },
  })
}

const MAX_INSTRUCTION = 4000

export async function PUT(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'بدنه درخواست نامعتبر است' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const provider = b.provider === 'anthropic' ? 'anthropic' : b.provider === 'openai' ? 'openai' : null
  if (!provider) return NextResponse.json({ error: 'ارائه‌دهنده باید openai یا anthropic باشد' }, { status: 400 })

  const baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.trim() : ''
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return NextResponse.json({ error: 'آدرس اتصال باید با http:// یا https:// شروع شود' }, { status: 400 })
  }
  if (baseUrl.length > 500) {
    return NextResponse.json({ error: 'آدرس اتصال بیش از حد بلند است' }, { status: 400 })
  }

  const model = typeof b.model === 'string' ? b.model.trim().slice(0, 120) : ''
  const enabled = b.enabled === true

  const generalInstruction =
    typeof b.generalInstruction === 'string' ? b.generalInstruction.slice(0, MAX_INSTRUCTION) : ''
  const managerInstruction =
    typeof b.managerInstruction === 'string' ? b.managerInstruction.slice(0, MAX_INSTRUCTION) : ''

  const maxToolCallsRaw = Number(b.maxToolCalls ?? 4)
  const maxToolCalls = Number.isFinite(maxToolCallsRaw)
    ? Math.min(Math.max(Math.trunc(maxToolCallsRaw), 0), 8)
    : 4

  // کلید API: فقط در صورت ارسال مقدار غیرخالی جایگزین می‌شود و هرگز لاگ/برگشت نمی‌شود
  let apiKey: string | undefined
  if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
    apiKey = b.apiKey.trim().slice(0, 400)
  }

  const data = {
    provider,
    baseUrl,
    model,
    enabled,
    generalInstruction,
    managerInstruction,
    maxToolCalls,
    ...(apiKey !== undefined ? { apiKey } : {}),
  }
  await db.aiConfig.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } })

  const cfg = await getAiConfig()
  return NextResponse.json({
    ok: true,
    config: {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      enabled: cfg.enabled,
      generalInstruction: cfg.generalInstruction,
      managerInstruction: cfg.managerInstruction,
      maxToolCalls: cfg.maxToolCalls,
      ...maskKey(cfg.apiKey),
    },
  })
}
