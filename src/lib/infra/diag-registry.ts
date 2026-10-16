import type { DiagRoomRegistryEntry } from './types-diag'

/**
 * ثبت آزمون‌های رسانهٔ در جریان — فقط در حافظهٔ فرایند.
 * هدف: end فقط بتواند اتاقی را حذف کند که (۱) همین فرایند ساخت، (۲) با
 * پیشوند diag:infra: است و (۳) متعلق به همان مدیر است. حذف اتاق دلخواه
 * یا جلسهٔ واقعی (live:{sessionId}) از مسیر پاک‌سازی ممکن نیست.
 */

const g = globalThis as unknown as { __infraDiagRooms?: Map<string, DiagRoomRegistryEntry> }

export function diagRegistry(): Map<string, DiagRoomRegistryEntry> {
  if (!g.__infraDiagRooms) g.__infraDiagRooms = new Map()
  return g.__infraDiagRooms
}

/** حذف ورودی‌های کهنه‌تر از ۱۵ دقیقه — جلوگیری از رشد حافظه */
export function pruneDiagRegistry(): void {
  const r = diagRegistry()
  const cutoff = Date.now() - 15 * 60_000
  for (const [k, v] of r) if (v.at < cutoff) r.delete(k)
}

export function getDiagEntry(testId: string): DiagRoomRegistryEntry | undefined {
  return diagRegistry().get(testId)
}

export function deleteDiagEntry(testId: string): void {
  diagRegistry().delete(testId)
}
