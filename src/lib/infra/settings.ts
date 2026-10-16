import { db } from '@/lib/db'
import type { InfraEvent, InfraThresholds } from './types'

/**
 * تنظیمات پایش + تاریخچهٔ رویدادها — با سیاست پاک‌سازی صریح تا مانیتورینگ
 * هرگز باعث رشد نامحدود دیتابیس نشود.
 *
 * - آستانه‌ها: رکورد یکتا (id='global')؛ فقط درصد ۱..۹۹
 * - رویدادها: فقط «تغییر وضعیت» ثبت می‌شود (نه هر poll) + پاک‌سازی دوره‌ای
 */

const EVENT_RETENTION_DAYS = 14
const EVENT_HARD_CAP = 400
const SWEEP_MIN_INTERVAL_MS = 10 * 60 * 1000

const DEFAULTS: InfraThresholds = {
  cpuThreshold: 85,
  ramThreshold: 85,
  diskThreshold: 90,
  sustainedCount: 3,
}

export async function getThresholds(): Promise<InfraThresholds> {
  try {
    const row = await db.infraSetting.findUnique({ where: { id: 'global' } })
    if (!row) return { ...DEFAULTS }
    return {
      cpuThreshold: clampPct(row.cpuThreshold),
      ramThreshold: clampPct(row.ramThreshold),
      diskThreshold: clampPct(row.diskThreshold),
      sustainedCount: clampSustained(row.sustainedCount),
    }
  } catch {
    // دیتابیس در دسترس نیست — پیش‌فرض‌ها؛ صفحه وضعیت نباید خودش خراب شود
    return { ...DEFAULTS }
  }
}

export async function saveThresholds(input: Partial<InfraThresholds>): Promise<InfraThresholds> {
  const current = await getThresholds()
  const next: InfraThresholds = {
    cpuThreshold: clampPct(input.cpuThreshold ?? current.cpuThreshold),
    ramThreshold: clampPct(input.ramThreshold ?? current.ramThreshold),
    diskThreshold: clampPct(input.diskThreshold ?? current.diskThreshold),
    sustainedCount: clampSustained(input.sustainedCount ?? current.sustainedCount),
  }
  await db.infraSetting.upsert({
    where: { id: 'global' },
    create: { id: 'global', ...next },
    update: next,
  })
  return next
}

function clampPct(v: number): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : DEFAULTS.cpuThreshold
}

function clampSustained(v: number): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : DEFAULTS.sustainedCount
}

// ─── رویدادها ───

const g = globalThis as unknown as { __infraLastSweep?: number }

/** ثبت رویداد — best-effort؛ خطای DB مانع پاسخ API نمی‌شود */
export async function logInfraEvent(
  kind: InfraEvent['kind'],
  service: string,
  message: string,
  detail?: string | null,
): Promise<void> {
  try {
    await db.infraEventLog.create({ data: { kind, service, message, detail: detail ?? null } })
  } catch {
    /* صفحه وضعیت هرگز به‌خاطر لاگ‌شکنی نپاید */
  }
}

/** رویدادهای اخیر — جدیدترین اول، حداکثر count */
export async function recentInfraEvents(count = 50): Promise<InfraEvent[]> {
  try {
    const rows = await db.infraEventLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, count)),
    })
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as InfraEvent['kind'],
      service: r.service,
      message: r.message,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    }))
  } catch {
    return []
  }
}

/**
 * پاک‌سازی دوره‌ای — حداکثر هر ۱۰ دقیقه یک‌بار اجرا می‌شود تا poll های
 * مکرر فشار DB نگذارند: رویدادهای کهنه‌تر از ۱۴ روز + سقف سخت ۴۰۰ رکورد.
 */
export async function sweepInfraEvents(): Promise<void> {
  const now = Date.now()
  if (g.__infraLastSweep && now - g.__infraLastSweep < SWEEP_MIN_INTERVAL_MS) return
  g.__infraLastSweep = now
  try {
    const cutoff = new Date(now - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    await db.infraEventLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
    // سقف سخت: قدیمی‌ترین‌ها تا زیر ۴۰۰ رکورد
    const total = await db.infraEventLog.count()
    if (total > EVENT_HARD_CAP) {
      const excess = total - EVENT_HARD_CAP
      const oldest = await db.infraEventLog.findMany({
        orderBy: { createdAt: 'asc' },
        take: excess,
        select: { id: true },
      })
      if (oldest.length > 0) {
        await db.infraEventLog.deleteMany({ where: { id: { in: oldest.map((o) => o.id) } } })
      }
    }
  } catch {
    /* بهترین تلاش */
  }
}

export const INFRA_EVENT_POLICY = {
  retentionDays: EVENT_RETENTION_DAYS,
  hardCap: EVENT_HARD_CAP,
}
