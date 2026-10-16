/**
 * الزام‌سازی مجوزهای رسانه در LiveKit SFU — از سرویس socket
 *
 * Socket.IO مرجع وضعیت اتاق (مجوز صحبت/دوربین/اشتراک، سکوت، اخراج) می‌ماند و
 * پس از هر تغییر، مجوزهای LiveKit همان شرکت‌کننده هم به‌روزرسانی می‌شود؛
 * یعنی گیت انتشار رسانه دانش‌آموز «در سرور رسانه» هم اعمال می‌شود، نه فقط UI.
 *
 * پیاده‌سازی بدون وابستگی SDK: توکن مدیریتی HS256 (jose) + فراخوانی Twirp
 * livekit.RoomService روی شبکه داخلی Docker (LIVEKIT_INTERNAL_URL).
 * اگر LiveKit پیکربندی نباشد/در دسترس نباشد، اتاق socket کار می‌کند و فقط
 * enforcement رسانه غیرفعال می‌ماند (لاگ هشدار یک‌بار) — بدون توقف سرویس.
 */
import { SignJWT } from 'jose'

const LK_API_KEY = (process.env.LIVEKIT_API_KEY ?? '').trim()
const LK_API_SECRET = (process.env.LIVEKIT_API_SECRET ?? '').trim()
// LIVEKIT_INTERNAL_URL ممکن است به شکل wss:// (مثلاً LiveKit Cloud) داده شود؛
// فراخوانی‌های Twirp با fetch هستند و اسکیم http(s) لازم دارند — نرمال‌سازی
// اسکیم در همین‌جا انجام می‌شود تا همان مقدار .env برای هر دو کاربرد جواب بدهد.
const LK_URL = (process.env.LIVEKIT_INTERNAL_URL ?? 'http://127.0.0.1:7880')
  .trim()
  .replace(/\/$/, '')
  .replace(/^wss:\/\//i, 'https://')
  .replace(/^ws:\/\//i, 'http://')
export const lkConfigured = LK_API_KEY.length > 0 && LK_API_SECRET.length > 0

/**
 * خطای الزام‌سازی را ثبت می‌کند — هر بار (نه فقط بار اول) و با پیام کوتاه،
 * تا عدم دسترسی سرور رسانه در لاگ‌ها قابل ردیابی بماند.
 * 404 «participant does not exist» رقابت طبیعی ورود است و سر و صدا ایجاد نمی‌کند.
 */
function lkLogErr(op: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('participant does not exist')) return // رقابت ورود — در sync بعدی اعمال می‌شود
  console.error(`[livekit] ${op} ناموفق: ${msg.slice(0, 160)}`)
}

/** آیا خطا به‌خاطر نبودن شرکت‌کننده در اتاق LiveKit است؟ (رقابت ورود) */
function isParticipantMissing(e: unknown): boolean {
  return e instanceof Error && e.message.includes('participant does not exist')
}

const RETRY_DELAY_MS = 2000
/**
 * همگام‌سازی مجوزها با یک تلاش مجدد — اگر شرکت‌کننده هنوز به SFU نرسیده بود
 * (404)، پس از ۲ ثانیه یک‌بار دیگر تلاش می‌شود؛ تلاش مجدد پس از خروج کاربر
 * دوباره 404 می‌شود و بی‌صدا رها می‌شود (sync بعدی هنگام تغییر مجوز انجام می‌شود).
 */
async function syncWithRetry(roomName: string, p: LkPerms): Promise<void> {
  try {
    await applyPermissions(roomName, p)
  } catch (e) {
    if (!isParticipantMissing(e)) throw e
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    await applyPermissions(roomName, p)
  }
}

/** اعمال یک‌باره‌ی مجوزهای نقش روی شرکت‌کننده در سرور رسانه */
async function applyPermissions(roomName: string, p: LkPerms): Promise<void> {
  const sources = sourcesOf(p)
  await twirp(roomName, 'UpdateParticipant', {
    room: roomName,
    identity: p.userId,
    metadata: JSON.stringify({ name: p.name, role: p.role }),
    permission: {
      can_subscribe: true,
      can_publish: sources.length > 0,
      can_publish_sources: sources,
      can_publish_data: false,
      hidden: false,
      recorder: false,
    },
  })
  if (p.mutedByTeacher) {
    await muteSourceTracks(roomName, p.userId, SRC_MIC)
  }
  if (!p.canCam) {
    // لغو اجازه دوربین — دوربین روشن باید از رسانه هم حذف/ساکت شود
    await muteSourceTracks(roomName, p.userId, SRC_CAM)
  }
}

export function livekitRoomFor(sessionId: string): string {
  return `live:${sessionId}`
}

async function adminToken(room: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({
    video: { room, roomAdmin: true, roomCreate: true, roomList: true, roomJoin: false },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(LK_API_KEY)
    .setSubject('daniar-socket-admin')
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(new TextEncoder().encode(LK_API_SECRET))
}

async function twirp<T = Record<string, unknown>>(room: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${LK_URL}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await adminToken(room)}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`RoomService.${method} → ${res.status} ${text.slice(0, 200)}`)
  }
  return (await res.json().catch(() => ({}))) as T
}

/** منابع انتشار مجاز از وضعیت مجوزهای اتاق — گیت واقعی رسانه در سرور LiveKit */
export interface LkPerms {
  userId: string
  name: string
  role: string
  canSpeak: boolean
  canCam: boolean
  canShare: boolean
  mutedByTeacher: boolean
}

function sourcesOf(p: LkPerms): string[] {
  const out: string[] = []
  if (p.canSpeak && !p.mutedByTeacher) out.push('MICROPHONE')
  if (p.canCam) out.push('CAMERA')
  if (p.canShare) out.push('SCREEN_SHARE')
  return out
}

interface LkTrack {
  sid: string
  type?: string | number
  source?: string | number
  muted?: boolean
}
interface LkParticipant {
  identity: string
  tracks?: LkTrack[]
}

const SRC_MIC = new Set(['MICROPHONE', 1, '1'])
const SRC_CAM = new Set(['CAMERA', 0, '0'])

/** سکوت اجباری ترک‌های یک منبع مشخص (تطبیق نام یا کد enum) */
async function muteSourceTracks(room: string, identity: string, source: Set<string | number>) {
  const list = await twirp<{ participants?: LkParticipant[] }>(room, 'ListParticipants', { room })
  const target = list.participants?.find((x) => x.identity === identity)
  for (const t of target?.tracks ?? []) {
    if (source.has(t.source as string | number) && !t.muted) {
      await twirp(room, 'MutePublishedTrack', { room, identity, track_sid: t.sid, muted: true })
    }
  }
}

/**
 * همگام‌سازی مجوزهای یک شرکت‌کننده با LiveKit:
 * - فقط منابع مجاز قابل انتشار می‌مانند (بقیه توسط LiveKit unpublish می‌شوند)
 * - سکوت معلم → میکروفون در سرور رسانه هم mute می‌شود
 */
export async function lkSyncPermissions(roomName: string, p: LkPerms): Promise<void> {
  if (!lkConfigured) return
  try {
    await syncWithRetry(roomName, p)
  } catch (e) {
    lkLogErr('UpdateParticipant', e)
  }
}

/** اخراج — اتصال رسانه شرکت‌کننده هم از اتاق LiveKit حذف می‌شود */
export function lkRemoveParticipant(roomName: string, identity: string): void {
  if (!lkConfigured) return
  twirp(roomName, 'RemoveParticipant', { room: roomName, identity }).catch((e) => lkLogErr('RemoveParticipant', e))
}

/** پایان جلسه — اتاق LiveKit کامل حذف می‌شود (جداسازی جلسات حفظ می‌ماند) */
export function lkDeleteRoom(roomName: string): void {
  if (!lkConfigured) return
  twirp(roomName, 'DeleteRoom', { room: roomName }).catch((e) => lkLogErr('DeleteRoom', e))
}
