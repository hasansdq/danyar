import { SignJWT } from 'jose'
import { livekitServerConfig, type LivekitServerConfig } from '@/lib/livekit'

/**
 * فراخوانی مدیریتی LiveKit (Twirp RoomService) از سمت Next.js — فقط برای
 * پایش زیرساخت و آزمون تشخیصی مدیر کل.
 *
 * امنیت:
 * - کلید/رمز فقط در سرور می‌ماند و در هیچ پاسخ/لاگی ظاهر نمی‌شود
 * - توکن مدیریتی کوتاه‌عمر (۹۰ ثانیه) و فقط با مجوزهای لازم برای همان عملیات
 * - همهٔ فراخوانی‌ها timeout صریح دارند؛ خرابی هر فراخوانی مستقل است
 */

const ADMIN_TOKEN_TTL_SEC = 90
const TWIRP_TIMEOUT_MS = 8000

async function adminToken(cfg: LivekitServerConfig, grants: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ video: grants })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(cfg.apiKey)
    .setSubject('daniar-infra-diag')
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + ADMIN_TOKEN_TTL_SEC)
    .sign(new TextEncoder().encode(cfg.apiSecret))
}

async function twirp<T = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>,
  grants: Record<string, unknown>,
): Promise<T> {
  const cfg = livekitServerConfig()
  if (!cfg.configured) throw new Error('LiveKit پیکربندی نشده است (کلید/رمز موجود نیست)')
  const res = await fetch(`${cfg.internalUrl}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await adminToken(cfg, grants)}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TWIRP_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // پیام خطا کوتاه و بی‌خطر — بدون هیچ هدر/کلیدی
    throw new Error(`RoomService.${method} → ${res.status} ${text.slice(0, 120)}`)
  }
  return (await res.json().catch(() => ({}))) as T
}

/** بررسی واقعی سرویس رسانه: فهرست اتاق‌ها با توکن مدیریتی معتبر */
export async function livekitListRooms(): Promise<{ rooms: { name: string }[] }> {
  return twirp<{ rooms: { name: string }[] }>('ListRooms', {}, { roomList: true })
}

/**
 * شرکت‌کنندگان واقعی یک اتاق LiveKit (RoomService.ListParticipants) —
 * فقط برای پنل «مدیریت کلاس‌های آنلاین» (جزئیات جلسه). هیچ محتوای رسانه‌ای
 * (صدا/تصویر/تخته) دریافت نمی‌شود — فقط وضعیت اتصال/انتشار.
 */
export async function livekitListParticipants(
  room: string,
): Promise<{
  participants: {
    identity: string
    name?: string
    state?: string
    isPublisher?: boolean
    joinedAt?: number
    tracks?: { type?: string; muted?: boolean; source?: string }[]
  }[]
}> {
  return twirp('ListParticipants', { room }, { roomList: true, roomAdmin: true })
}

/**
 * ساخت اتاق تشخیصی موقت و مجزا — «فقط» برای آزمون اتصال رسانهٔ مدیر کل:
 * - empty_timeout کوتاه: اتاق خالی حداکثر ۹۰ ثانیه بعد خودکار حذف می‌شود
 * - max_participants=2: هیچ‌گاه به جلسهٔ واقعی تبدیل نمی‌شود
 * - هیچ رکورد LiveSession/اعلان/حضورغیابی برای آن ساخته نمی‌شود
 */
export async function createDiagRoom(name: string): Promise<void> {
  await twirp(
    'CreateRoom',
    { name, empty_timeout: 90, max_participants: 2, depart_timeout: 20 },
    { roomCreate: true, roomList: true },
  )
}

/** حذف اتاق تشخیصی — پس از پایان/خطای آزمون؛ با تأیید حذف واقعی */
export async function deleteDiagRoom(name: string): Promise<{ deleted: boolean }> {
  try {
    await twirp('DeleteRoom', { room: name }, { roomCreate: true, roomList: true })
  } catch {
    // شاید از قبل حذف شده (empty_timeout) — با فهرست اتاق‌ها راستی‌آزمایی می‌کنیم
  }
  try {
    const list = await livekitListRooms()
    const still = list.rooms?.some((r) => r.name === name) ?? false
    return { deleted: !still }
  } catch {
    // خود بررسی فهرست هم ناموفق — وضعیت نامشخص اما تلاش حذف انجام شد
    return { deleted: false }
  }
}
