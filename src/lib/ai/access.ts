/**
 * موتور دسترسی دستیار — همه گیت‌ها سمت سرور:
 * پیکربندی سراسری → فعال بودن مدرسه → فعال بودن نقش → سهمیه مصرف روزانه
 */

import { db } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'
import type { ProviderName, AiServiceConfig } from './provider'

export type AiBlockCode =
  | 'NOT_CONFIGURED'
  | 'DISABLED_GLOBAL'
  | 'DISABLED_SCHOOL'
  | 'ROLE_NOT_ALLOWED'
  | 'SCHOOL_INACTIVE'
  | 'QUOTA_EXHAUSTED'

export const AI_BLOCK_MESSAGES: Record<AiBlockCode, string> = {
  NOT_CONFIGURED: 'سرویس هوش مصنوعی هنوز توسط مدیر کل پیکربندی نشده است.',
  DISABLED_GLOBAL: 'دستیار دانیار در کل پلتفرم توسط مدیر کل غیرفعال شده است.',
  DISABLED_SCHOOL: 'دستیار برای مدرسه شما فعال نیست. با مدیر کل پلتفرم تماس بگیرید.',
  ROLE_NOT_ALLOWED: 'دستیار فقط برای نقش مدیر مدرسه در دسترس است.',
  SCHOOL_INACTIVE: 'مدرسه شما غیرفعال است و دستیار در دسترس نیست.',
  QUOTA_EXHAUSTED: 'سهمیه مصرف روزانه شما برای دستیار به پایان رسیده است.',
}

export interface AiStatus {
  available: boolean
  code: AiBlockCode | 'OK'
  message: string
  limit: number | null
  usedToday: number
}

export interface AiSettings {
  provider: ProviderName
  baseUrl: string
  model: string
  apiKey: string
  enabled: boolean
  generalInstruction: string
  managerInstruction: string
  maxToolCalls: number
}

/** خواندن/ساخت تنظیمات سراسری (تک‌ردیف) */
export async function getAiConfig(): Promise<AiSettings> {
  let row = await db.aiConfig.findUnique({ where: { id: 1 } })
  if (!row) {
    row = await db.aiConfig.create({ data: { id: 1 } }).catch(async () => {
      // رقابت نادر در ساخت هم‌زمان
      return db.aiConfig.findUniqueOrThrow({ where: { id: 1 } })
    })
  }
  const provider: ProviderName = row.provider === 'anthropic' ? 'anthropic' : 'openai'
  return {
    provider,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: row.apiKey,
    enabled: row.enabled,
    generalInstruction: row.generalInstruction,
    managerInstruction: row.managerInstruction,
    maxToolCalls: Math.min(Math.max(row.maxToolCalls, 0), 8),
  }
}

/** کلید API هرگز بیرون نمی‌رود — فقط ماسک */
export function maskKey(key: string): { hasApiKey: boolean; apiKeyLast4: string | null } {
  if (!key) return { hasApiKey: false, apiKeyLast4: null }
  return { hasApiKey: true, apiKeyLast4: key.slice(-4) }
}

export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function countUserAiMessagesToday(userId: string): Promise<number> {
  return db.aiMessage.count({
    where: { conversation: { userId }, role: 'USER', createdAt: { gte: startOfToday() } },
  })
}

/**
 * وضعیت واقعی دستیار برای یک کاربر اپ — پایه تصمیم UI و گیت سرور
 */
export async function resolveAiStatus(session: SessionPayload): Promise<AiStatus> {
  const usedToday = await countUserAiMessagesToday(session.uid).catch(() => 0)

  const deny = (code: AiBlockCode, limit: number | null = null): AiStatus => ({
    available: false,
    code,
    message: AI_BLOCK_MESSAGES[code],
    limit,
    usedToday,
  })

  if (session.role !== 'SCHOOL_ADMIN') return deny('ROLE_NOT_ALLOWED')

  const cfg = await getAiConfig()
  if (!cfg.enabled) return deny('DISABLED_GLOBAL')
  if (!cfg.apiKey || !cfg.model) return deny('NOT_CONFIGURED')

  if (!session.schoolId) return deny('DISABLED_SCHOOL')
  const school = await db.school.findUnique({
    where: { id: session.schoolId },
    select: { isActive: true, aiSetting: { select: { enabled: true, managerEnabled: true, dailyMessageLimit: true } } },
  })
  if (!school || !school.isActive) return deny('SCHOOL_INACTIVE')
  const setting = school.aiSetting
  if (!setting || !setting.enabled) return deny('DISABLED_SCHOOL')
  if (!setting.managerEnabled) return deny('ROLE_NOT_ALLOWED')

  const limit = setting.dailyMessageLimit ?? null
  if (limit !== null && usedToday >= limit) return deny('QUOTA_EXHAUSTED', limit)

  return { available: true, code: 'OK', message: '', limit, usedToday }
}

/** گیت سرور پیش از تولید پاسخ — خطا با کد استاندارد */
export async function assertAiUsable(
  session: SessionPayload,
): Promise<{ ok: true; cfg: AiSettings; limit: number | null; usedToday: number } | { ok: false; code: AiBlockCode; message: string }> {
  const status = await resolveAiStatus(session)
  if (!status.available) {
    return { ok: false, code: status.code as AiBlockCode, message: status.message }
  }
  return { ok: true, cfg: await getAiConfig(), limit: status.limit, usedToday: status.usedToday }
}

/** ثبت آمار مصرف/خطا — بدون هیچ متن گفتگو */
export async function logAiUsage(entry: {
  userId: string
  schoolId: string | null
  ok: boolean
  errorType?: string | null
  provider?: string | null
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs?: number | null
}): Promise<void> {
  try {
    await db.aiUsageLog.create({
      data: {
        userId: entry.userId,
        schoolId: entry.schoolId,
        ok: entry.ok,
        errorType: entry.errorType ?? null,
        provider: entry.provider ?? null,
        model: entry.model ?? null,
        inputTokens: entry.inputTokens ?? null,
        outputTokens: entry.outputTokens ?? null,
        latencyMs: entry.latencyMs ?? null,
      },
    })
  } catch {
    // ثبت آمار هرگز جریان اصلی را نمی‌شکند
  }
}

/** قفل درحال‌تولید برای هر گفتگو (تک‌نمونه) */
const inFlight = new Set<number>()

export function acquireConversationLock(conversationId: number): boolean {
  if (inFlight.has(conversationId)) return false
  inFlight.add(conversationId)
  return true
}

export function releaseConversationLock(conversationId: number): void {
  inFlight.delete(conversationId)
}
