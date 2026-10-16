import { SignJWT } from 'jose'

/**
 * یکپارچه‌سازی LiveKit SFU — سمت سرور Next.js
 *
 * رسانه کلاس آنلاین از معماری mesh (WebRTC هم‌تا به‌هم‌تا) به SFU منتقل شده است:
 * هر جلسه یک اتاق مستقل LiveKit با نام «live:{sessionId}» دارد و توکن ورود
 * فقط همین‌جا و پس از بررسی عضویت کلاس صادر می‌شود.
 *
 * امنیت:
 * - هیچ کلید پیش‌فرضی وجود ندارد؛ LIVEKIT_API_KEY / LIVEKIT_API_SECRET از تنظیمات مالک می‌آید
 * - مجوز انتشار توکن بر اساس نقش است (دانش‌آموز = بدون انتشار؛ اجازه‌های بعدی
 *   با RoomService از سرویس socket به LiveKit اعمال و در همان LiveKit enforce می‌شود)
 * - کلاینت هرگز به API/کلید مدیریت LiveKit دسترسی ندارد؛ فقط توکن کوتاه‌عمر می‌گیرد
 */

export const LIVEKIT_TOKEN_TTL_SECONDS = 60 * 60 * 4 // توکن ورود ۴ ساعت اعتبار دارد

/** نام اتاق LiveKit برای هر جلسه — جداسازی کامل بین جلسه‌ها */
export function livekitRoomFor(sessionId: string): string {
  return `live:${sessionId}`
}

export interface LivekitServerConfig {
  apiKey: string
  apiSecret: string
  /** آدرس LiveKit از داخل شبکه (RoomService/مدیریت) */
  internalUrl: string
  configured: boolean
}

/** پیکربندی سرور LiveKit — بدون هیچ مقدار پیش‌فرض امنیتی */
export function livekitServerConfig(): LivekitServerConfig {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim() ?? ''
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() ?? ''
  // مانند socket-server: wss:// (مثلاً LiveKit Cloud) به https:// نرمال می‌شود تا
  // آدرس مدیریتی (Twirp/RoomService) همیشه با fetch قابل فراخوانی باشد.
  const internalUrl = (process.env.LIVEKIT_INTERNAL_URL?.trim() || 'http://127.0.0.1:7880')
    .replace(/\/$/, '')
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://')
  return {
    apiKey,
    apiSecret,
    internalUrl,
    configured: apiKey.length > 0 && apiSecret.length > 0,
  }
}

export interface LivekitTokenGrants {
  identity: string
  name: string
  room: string
  /** متادیتا JSON — نام/نقش شرکت‌کننده برای کلاینت‌های اتاق */
  metadata?: string
  canPublish: boolean
  /** منابع مجاز انتشار — وقتی canPublish=false نادیده گرفته می‌شود */
  canPublishSources?: string[]
  canSubscribe?: boolean
  /** توکن مدیریتی برای فراخوانی RoomService (فقط سمت سرور) */
  roomAdmin?: boolean
  ttlSeconds?: number
  maxParticipants?: number
}

/**
 * ساخت AccessToken مربوط به LiveKit (JWT HS256 با grants ویدیو)
 * مطابق spec رسمی: https://docs.livekit.io/home/server/generating-tokens
 */
export async function createLivekitToken(cfg: LivekitServerConfig, g: LivekitTokenGrants): Promise<string> {
  const secret = new TextEncoder().encode(cfg.apiSecret)
  const grants: Record<string, unknown> = {
    room: g.room,
    roomJoin: true,
    canPublish: g.canPublish,
    canSubscribe: g.canSubscribe ?? true,
    canPublishData: false,
    roomAdmin: g.roomAdmin ?? false,
    ...(g.canPublish && g.canPublishSources?.length ? { canPublishSources: g.canPublishSources } : {}),
    roomCreate: false,
    roomList: false,
    roomRecord: false,
    ingressAdmin: false,
    hidden: false,
    recorder: false,
  }
  const now = Math.floor(Date.now() / 1000)
  const ttl = g.ttlSeconds ?? LIVEKIT_TOKEN_TTL_SECONDS
  return await new SignJWT({ video: grants, name: g.name, metadata: g.metadata ?? '' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(cfg.apiKey)
    .setSubject(g.identity)
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + ttl)
    .sign(secret)
}

/**
 * آدرس اتصال کلاینت LiveKit — «فقط مبدأ» بدون مسیر.
 * کلاینت livekit-client v2 خودش مسیر «/rtc/v1» (و فالبک «/rtc») را می‌سازد؛
 * اگر مبنا مسیر داشته باشد مسیر تکراری (/rtc/rtc/v1) و اتصال ناموفق می‌شود.
 *
 * - اگر NEXT_PUBLIC_LIVEKIT_WS_URL موقع بیلد تنظیم شده باشد (مثلاً سرور رسانه جدا) همان استفاده می‌شود
 * - در غیر این صورت همان‌مبدأ صفحه — از درگاه 3034 و SSL دامنه عبور می‌کند،
 *   بدون هیچ تغییری در پورت‌ها/تنظیمات DirectAdmin
 * - مرجع اول «هدر Origin» است: تنها منبع قابل‌اعتماد مبداء واقعی صفحه. پشت
 *   پروکسی‌های توکار (لبهٔ پیش‌نمایش)، Host/X-Forwarded-Host ممکن است به
 *   میزبان داخلی پروکسی اشاره کند (مثلاً *.fcapp.run) — آدرسی که مرورگر هرگز
 *   نمی‌تواند به آن WebSocket بزند (mixed-content/VPC) و نتیجه‌اش خطای
 *   «room connection has timed out (signal)» است. Origin همیشه مبداء صفحه است.
 * - در استقرار، هدر Origin همین دامنه است و nginx/Caddy مسیر /rtc* را به
 *   LiveKit می‌فرستد — پس رفتار تولید تغییری نمی‌کند.
 * - در توسعه سندباکس (NODE_ENV=development) مثل سوکت، با کوئری XTransformPort
 *   از درگاه :81 عبور می‌کند (همان الگوی socket-client.ts)
 */
export function livekitClientUrl(
  reqHost: string | null,
  proto: string | null,
  forwardedHost?: string | null,
  origin?: string | null,
): string {
  const override = process.env.NEXT_PUBLIC_LIVEKIT_WS_URL?.trim()
  if (override) return override.replace(/\/$/, '')
  let host: string | null = null
  let scheme: 'wss' | 'ws' | null = null
  if (origin) {
    try {
      const o = new URL(origin)
      if (o.protocol === 'https:' || o.protocol === 'http:') {
        host = o.host
        scheme = o.protocol === 'https:' ? 'wss' : 'ws'
      }
    } catch {
      /* Origin نامعتبر — منبع بعدی */
    }
  }
  const wsProto = scheme ?? (proto === 'https' || proto === 'wss' ? 'wss' : 'ws')
  if (!host) {
    const xf = forwardedHost?.split(',')[0]?.trim()
    host = xf || reqHost || 'localhost:3034'
  }
  const base = `${wsProto}://${host}`
  if (process.env.NODE_ENV === 'production') return base
  // توسعه: درگاه سندباکس با کوئری پورت مقصد (LiveKit بومی :7880)
  return `${base}/?XTransformPort=7880`
}

/** مجوزهای انتشار بر اساس نقش — دانش‌آموز هیچ‌گاه در توکن اولیه حق انتشار ندارد */
export function publishSourcesForRole(role: string): { canPublish: boolean; sources?: string[] } {
  if (role === 'TEACHER' || role === 'SCHOOL_ADMIN' || role === 'SCHOOL_VICE') {
    // نام منابع در grants توکن حروف کوچک است (مطابق auth/grants.go پروتکل LiveKit)
    return { canPublish: true, sources: ['microphone', 'camera', 'screen_share'] }
  }
  // دانش‌آموز: انتشار فقط بعداً و فقط با اجازه معلم (RoomService) + اقدام خودش فعال می‌شود
  return { canPublish: false, sources: [] }
}
