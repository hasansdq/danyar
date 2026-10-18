'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSocketStatus, getSocket } from '@/components/messenger/socket-client'
import { repairAndReload } from '@/lib/sw-repair'
import { alignSignalUrl } from '@/lib/livekit-signal-url'
import { Whiteboard, type WbOp } from './whiteboard'
import {
  Room,
  RoomEvent,
  Track,
  VideoQuality,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type LocalTrackPublication,
} from 'livekit-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  Hand,
  LogOut,
  MessageSquare,
  Users,
  X,
  MonitorPlay,
  Loader2,
  WifiOff,
  AlertTriangle,
  Ban,
  PhoneOff,
  ChevronLeft,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Lock,
  Presentation,
  SignalLow,
  SignalHigh,
  Maximize2,
  Minimize2,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { roleLabel } from '@/lib/format'
import { useFullscreenElement, usePortrait } from '@/lib/use-fullscreen'

// ─── تایپ‌ها ───

interface ParticipantView {
  userId: string
  name: string
  role: string
  socketId: string
  micOn: boolean
  camOn: boolean
  sharing: boolean
  handRaised: boolean
  canSpeak: boolean
  canShare: boolean
  /** مجوز دوربین — دانش‌آموز فقط با اجازه معلم */
  canCam: boolean
  mutedByTeacher: boolean
}

interface SessionDetail {
  id: string
  title: string
  status: 'ACTIVE' | 'ENDED' | string
  /** اعلام رسمی شروع — null یعنی استریم معلم هنوز آماده نشده و اعلانی ارسال نشده */
  announcedAt?: string | null
  classroom: { id: string; name: string }
  host: { id: string; fullName: string }
  isHost: boolean
  maxParticipants: number
}

interface ChatItem {
  id: string
  senderId: string
  senderName: string
  senderRole: string
  body: string
  createdAt: string
}

type Phase = 'loading' | 'error' | 'ended' | 'kicked' | 'in-room'
/** وضعیت سوییچ «شروع کلاس» — na=غیرمیزبان، off=آماده برای روشن‌کردن */
type AnnounceState = 'na' | 'off' | 'sending' | 'sent' | 'failed'
type LkStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

/**
 * دسته‌بندی خطای اتصال رسانه — پیام متمایز برای هر لایه تا کاربر (و پشتیبانی)
 * بداند مشکل از سیگنالینگ است یا مسیر WebRTC یا دستگاه:
 * - سیگنال: WebSocket سیگنالینگ برقرار نشد (توکن/درگاه/SSL)
 * - ICE/PC: سیگنال اوکی ولی هیچ مسیر رسانه‌ای قابل اتصال نبود (فایروال/UDP)
 * - دستگاه: مجوز/نبود دوربین/میکروفون ( جداگانه در ensureCam/ensureMic)
 */
function classifyConnectError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  if (msg.includes('signal') || msg.includes('websocket') || msg.includes('token') || msg.includes('توکن')) {
    return `اتصال سیگنال رسانه برقرار نشد: ${msg}`
  }
  if (
    msg.includes('pc connection') ||
    msg.includes('peer connection') ||
    msg.includes('ICE') ||
    msg.includes('طول کشید')
  ) {
    return 'اتصال رسانه (WebRTC) برقرار نشد — مسیر شبکه به سرور رسانه در دسترس نیست؛ اینترنت/فایروال را بررسی کنید و دوباره تلاش کنید.'
  }
  return `اتصال رسانه برقرار نشد: ${msg}`
}
/** کاربرد ترک در نمایش (نقش معادل Track.Source LiveKit) */
type TrackPurpose = 'mic' | 'camera' | 'screen'

/** پارامترهای انتشار رسانه — کیفیت تطبیقی با simulcast سه‌لایه LiveKit */
const CAM_ENCODING = { maxBitrate: 700_000, maxFramerate: 15 } // ≈ ۷۰۰kbps در بالاترین لایه
const SCREEN_ENCODING = { maxBitrate: 1_200_000, maxFramerate: 8 }
/** کلید localStorage حالت کم‌مصرف */
const LOW_DATA_KEY = 'daniar-live-lowdata'

/**
 * آیا صفحه داخل iframe است (پیش‌نمایش توکار)؟
 * مرورگرها مجوز دوربین/میکروفون/اشتراک صفحه را داخل iframe بدون
 * allow attributes از سوی صفحهٔ میزبان مسدود می‌کنند؛ در آن صورت راه
 * واقعی، باز کردن کلاس در پنجرهٔ مستقل است (دکمه در نوار خطای رسانه).
 */
function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    // دسترسی cross-origin به window.top مسدود است → حتماً توکار است
    return true
  }
}

/** پیام خطای قابل فهم برای هر دستگاه — جدا و مستقل؛ خطای هر دستگاه بقیه را مسدود نمی‌کند */
const MIC_ERRORS: Record<string, string> = {
  NotAllowedError: 'اجازه دسترسی به میکروفون داده نشد. از تنظیمات مرورگر اجازه بدهید و دوباره تلاش کنید.',
  NotFoundError: 'میکروفونی پیدا نشد؛ می‌توانید بدون میکروفون در جلسه بمانید.',
  NotReadableError: 'میکروفون در حال استفاده توسط برنامه دیگری است؛ آن را ببندید و دوباره تلاش کنید.',
  OverconstrainedError: 'تنظیمات میکروفون پشتیبانی نمی‌شود؛ دوباره تلاش کنید.',
}
const CAM_ERRORS: Record<string, string> = {
  NotAllowedError: 'اجازه دسترسی به دوربین داده نشد. از تنظیمات مرورگر اجازه بدهید و دوباره تلاش کنید — تا آن موقع میکروفون و اشتراک صفحه کار می‌کند.',
  NotFoundError: 'دوربینی پیدا نشد؛ می‌توانید با میکروفون یا اشتراک صفحه کلاس را ادامه دهید.',
  NotReadableError: 'دوربین در حال استفاده توسط برنامه دیگری است؛ آن را ببندید و دوباره تلاش کنید — میکروفون و اشتراک صفحه مستقل کار می‌کنند.',
  OverconstrainedError: 'تنظیمات دوربین پشتیبانی نمی‌شود؛ دوباره تلاش کنید.',
}
/** پیام مهلت مجوز — برای تشخیص در catch (به‌جای نگاشت خطای مرورگر) */
const MIC_TIMEOUT_MSG = 'دریافت مجوز میکروفون بیش از حد طول کشید (پنجره مجوز مرورگر را بررسی کنید).'
const CAM_TIMEOUT_MSG = 'دریافت مجوز دوربین بیش از حد طول کشید (پنجره مجوز مرورگر را بررسی کنید).'

/**
 * اجرای یک Promise با سقف زمانی — عبور از مهلت هیچ‌گاه نباید کاربر را در
 * «در حال ورود به جلسه…» برای همیشه نگه دارد؛ در محیط‌های شبکه‌ای ناپایدار
 * (پروکسی/گیت‌وی) هر مرحله ورود باید خطای شفاف و قابل تلاش مجدد بدهد.
 */
function withTimeout<T>(p: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(timeoutMsg)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/** سقف زمانی دریافت جزئیات جلسه */
const FETCH_TIMEOUT_MS = 20000
/** سقف زمانی انتظار برای مجوز دوربین/میکروفون — میزبان بیشتر (پنجره تأیید مرورگر) */
const MEDIA_TIMEOUT_HOST_MS = 45000
const MEDIA_TIMEOUT_OTHER_MS = 20000
/** سقف زمانی کل ورود سوکتی (اتصال + ack) */
const JOIN_TIMEOUT_MS = 30000
/** نظارت نهایی — اگر پس از این مدت هنوز «در حال ورود» بودیم، خطای شفاف نشان بده */
const WATCHDOG_MS = 75000

function chatClock(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

// ─── المان‌های کوچک ───

function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    if (!stream) return
    // پخش خودکار صدا ممکن است توسط سیاست autoplay مرورگر بلاک شود —
    // با اولین تعامل کاربر با صفحه (کلیک) دوباره تلاش می‌شود
    const retry = () => {
      document.removeEventListener('pointerdown', retry)
      el.play().catch(() => null)
    }
    let blocked = false
    el.play().catch(() => {
      blocked = true
      document.addEventListener('pointerdown', retry)
    })
    return () => {
      if (blocked) document.removeEventListener('pointerdown', retry)
    }
  }, [stream])
  return <audio ref={ref} autoPlay playsInline className="hidden" />
}

function VideoTile({
  name,
  role,
  isSelf,
  stream,
  showVideo,
  micOn,
  mutedByTeacher,
  handRaised,
  sharing,
  isHost,
  streamKind,
  className,
}: {
  name: string
  role: string
  isSelf?: boolean
  stream: MediaStream | null
  showVideo: boolean
  micOn: boolean
  mutedByTeacher?: boolean
  handRaised?: boolean
  sharing?: boolean
  isHost?: boolean
  streamKind?: 'camera' | 'screen'
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  // تمام‌صفحه برای همه نقش‌ها — اشتراک صفحه در موبایل عمودی می‌چرخد (نمای افقی)
  const { attach: fsAttach, active: fsActive, fake: fsFake, toggle: fsToggle } =
    useFullscreenElement<HTMLDivElement>(streamKind === 'screen')
  const portrait = usePortrait()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    if (!stream) return
    // پخش واقعی ویدیوی ریموت: autoplay صرفاً با attribute در همه مرورگرها تضمینی نیست —
    // play() صریح؛ اگر سیاست مرورگر بلاک کرد، المان muted می‌شود و دوباره تلاش می‌شود
    // (صدا از المان جداگانهٔ RemoteAudio پخش می‌شود، پس mute‌کردن ویدیو صدا را از دست نمی‌دهد)
    el.play().catch(() => {
      el.muted = true
      el.play().catch(() => null)
    })
  }, [stream])

  const rotateLandscape = fsActive && streamKind === 'screen' && portrait

  return (
    <div
      ref={fsAttach}
      data-tile-self={isSelf ? '1' : undefined}
      data-tile-kind={streamKind ?? 'camera'}
      data-tile-name={name}
      data-fs-active={fsActive ? '1' : undefined}
      className={cn(
        fsFake
          ? 'fixed inset-0 z-[100] overflow-hidden bg-black'
          : 'relative rounded-xl overflow-hidden border bg-black/90 min-h-36',
        streamKind === 'screen' && !fsFake && 'sm:min-h-64',
        fsActive && 'fs-active-tile border-0',
        className,
      )}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={isSelf}
        className={cn(
          'h-full w-full object-cover',
          streamKind === 'screen' && !rotateLandscape && 'object-contain',
          isSelf && !streamKind && 'scale-x-[-1]',
          !showVideo && 'invisible',
          rotateLandscape && 'fs-rotated-video',
        )}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
          <span className="h-14 w-14 rounded-full bg-white/10 flex items-center justify-center text-xl font-bold">
            {name.trim().charAt(0)}
          </span>
          <span className="text-xs opacity-80">دوربین خاموش است</span>
        </div>
      )}
      {/* تمام‌صفحه — همه نقش‌ها؛ در حالت تمام‌صفحه خروج با همین دکمه یا ESC */}
      <button
        type="button"
        onClick={fsToggle}
        aria-label={fsActive ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه'}
        title={fsActive ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه'}
        data-fs-toggle
        className={cn(
          'absolute top-2 end-2 h-8 w-8 rounded-full flex items-center justify-center transition-colors',
          'bg-black/50 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        )}
      >
        {fsActive ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
      {/* نشان‌های وضعیت */}
      <div className="absolute top-2 start-2 flex items-center gap-1">
        {sharing && (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-600/90 px-2 py-0.5 text-[10px] font-bold text-white">
            <MonitorPlay className="h-3 w-3" />
            اشتراک صفحه
          </span>
        )}
        {handRaised && (
          <span className="inline-flex items-center rounded-full bg-amber-500/90 px-1.5 py-0.5 text-white animate-bounce">
            <Hand className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className="absolute bottom-0 inset-x-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2.5 py-1.5">
        <span className="text-xs font-bold text-white truncate">
          {name}
          {isHost && <span className="ms-1 text-[10px] text-amber-300">(میزبان)</span>}
        </span>
        <span className="text-[10px] text-white/60">{roleLabel(role)}</span>
        <span className="flex-1" />
        {micOn ? (
          <Mic className="h-3.5 w-3.5 text-emerald-400" />
        ) : mutedByTeacher ? (
          <MicOff className="h-3.5 w-3.5 text-red-400" />
        ) : (
          <MicOff className="h-3.5 w-3.5 text-white/50" />
        )}
      </div>
    </div>
  )
}

// ─── اتاق جلسه ───

export function LiveRoomClient({
  sessionId,
  me,
}: {
  sessionId: string
  me: { id: string; fullName: string; role: string }
}) {
  const router = useRouter()
  const socketConnected = useSocketStatus((s) => s.connected)
  const connStatus = useSocketStatus((s) => s.status)

  const [phase, setPhase] = useState<Phase>('loading')
  const [errorInfo, setErrorInfo] = useState<{ title: string; msg: string } | null>(null)
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [participants, setParticipants] = useState<ParticipantView[]>([])
  const [hostId, setHostId] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatItem[]>([])
  const [panel, setPanel] = useState<'none' | 'chat' | 'people'>('none')
  const [mobilePanel, setMobilePanel] = useState<'none' | 'chat' | 'people'>('none')
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [sharing, setSharing] = useState(false)
  /** در حال گرفتن مجوز/آماده‌سازی دستگاه (پیشگیری از دوبارکلیک) */
  const [micBusy, setMicBusy] = useState(false)
  const [camBusy, setCamBusy] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [selfPerms, setSelfPerms] = useState({
    canSpeak: false,
    canShare: false,
    canCam: false,
    mutedByTeacher: false,
  })
  // تخته سفید معلم — فعال بودن + عملیات همگام‌شده
  const [wboardActive, setWboardActive] = useState(false)
  const [wboardOps, setWboardOps] = useState<WbOp[]>([])
  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, Partial<Record<TrackPurpose, MediaStream>>>
  >({})
  const [chatInput, setChatInput] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [endedBy, setEndedBy] = useState<'self' | 'other' | null>(null)
  /** ورود بیش از ۱۰ ثانیه طول کشیده — راهنمای پنجره مجوز مرورگر نمایش داده می‌شود */
  const [slowJoin, setSlowJoin] = useState(false)
  // اعلام شروع کلاس — فقط میزبان، فقط با سوییچ دستی بعد از انتشار رسانه واقعی
  // off = اعلام‌نشده (سوییچ خاموش) | sending | sent | failed
  const [announceState, setAnnounceState] = useState<AnnounceState>('na')
  const announceStateRef = useRef<AnnounceState>('na')
  /** آیا حداقل یک رسانه واقعی (صوت/دوربین/اشتراک صفحه) در SFU منتشر شده؟ شرط فعال‌شدن سوییچ */
  const [anyPublished, setAnyPublished] = useState(false)
  // وضعیت اتصال معلم میزبان (برای سایر شرکت‌کننده‌ها)
  const [hostStatus, setHostStatus] = useState<{ connected: boolean; graceSeconds: number | null } | null>(null)
  // وضعیت اتصال رسانه (SFU LiveKit) — جدا از سوکت پیام‌رسان؛
  // idle=هنوز تلاش نشده، connecting=در حال اتصال، connected=متصل،
  // reconnecting=اتصال مجدد خودکار، failed=شکست (قابل بازیابی با دکمه تلاش مجدد)
  const [lkStatus, setLkStatus] = useState<LkStatus>('idle')
  // حالت کم‌مصرف برای اینترنت ضعیف (کیفیت تطبیقی پایین در اشتراک‌ها)
  const [lowData, setLowData] = useState(false)
  // صفحه در پیش‌نمایش توکار (iframe) باز است؟ — برای دکمه «باز کردن در پنجره جدید»
  const [embedded, setEmbedded] = useState(false)
  useEffect(() => setEmbedded(isEmbedded()), [])

  /** ترک صوت خودم (مستقل از دوربین — کنترل‌ها مستقل‌اند) */
  const micTrackRef = useRef<MediaStreamTrack | null>(null)
  /** ترک دوربین خودم (مستقل از میکروفون) */
  const camTrackRef = useRef<MediaStreamTrack | null>(null)
  /** استریم نمایشی دوربین خودم (برای کاشی تصویر خود) */
  const camStreamRef = useRef<MediaStream | null>(null)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)
  /** اتاق SFU (LiveKit) — رسانه کاملاً جدا از سوکت پیام‌رسان.
   * فقط پس از موفقیت واقعی room.connect() مقدار می‌گیرد؛ اتاق شکست‌خورده هرگز
   * باقی نمی‌ماند (پیش‌شرط جلوگیری از «engine not connected» هنگام انتشار). */
  const roomRef = useRef<Room | null>(null)
  /** آیا اتصال SFU واقعاً برقرار است؟ (هم‌زمان با roomRef اعمال/پاک می‌شود) */
  const lkConnectedRef = useRef(false)
  /** شناسهٔ آخرین تلاش اتصال — تلاش منسوخ هیچ اثری روی وضعیت نمی‌گذارد */
  const connectAttemptRef = useRef(0)
  /** اتصال هم‌زمان تکراری را به یک Promise مشترک فرو می‌کاهد */
  const connectPromiseRef = useRef<Promise<Room | null> | null>(null)
  /** جداکردن شنونده‌های رویدادهای اتاق جاری */
  const roomDetachRef = useRef<(() => void) | null>(null)
  const lowDataRef = useRef(false)
  /** آیا حداقل یک رسانه واقعی در SFU منتشر شده؟ (شرط فعال‌شدن سوییچ شروع کلاس) */
  const publishedReadyRef = useRef(false)
  const joinedRef = useRef(false)
  const sessionRef = useRef<SessionDetail | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const hostIdRef = useRef<string | null>(null)

  const isHost = !!session && (hostId === me.id || session.isHost)
  /** نسخه‌ی همیشه‌تازه‌ی hostId برای رویدادهای داخل کالبک‌های ثبت‌شده */
  hostIdRef.current = hostId

  // ─── سوییچ «شروع کلاس» (فقط میزبان) ───
  // سوییچ پس از انتشار موفق حداقل یک رسانه واقعی (صوت/دوربین/اشتراک صفحه) فعال می‌شود؛
  // روشن‌کردن سوییچ = ارسال اعلان شروع برای دانش‌آموزان (claim اتمیک سمت سرور)
  const sendAnnounce = useCallback(async () => {
    const s = sessionRef.current
    if (!s || s.status !== 'ACTIVE') return
    const isHostNow = hostIdRef.current === me.id || s.isHost
    if (!isHostNow) return
    if (s.announcedAt || announceStateRef.current === 'sent' || announceStateRef.current === 'sending') return
    if (!publishedReadyRef.current) {
      toast.error('برای شروع کلاس، ابتدا حداقل یک رسانه (میکروفون، دوربین یا اشتراک صفحه) منتشر کنید')
      return
    }
    announceStateRef.current = 'sending'
    setAnnounceState('sending')
    try {
      const r = await withTimeout(
        fetch(`/api/live-sessions/${sessionId}/announce`, { method: 'POST' }),
        20000,
        'اعلام شروع کلاس بیش از حد طول کشید',
      )
      const d = await r.json().catch(() => null)
      if (r.ok) {
        announceStateRef.current = 'sent'
        setAnnounceState('sent')
        if (!d?.alreadyAnnounced) {
          toast.success('اعلان شروع کلاس برای دانش‌آموزان ارسال شد')
        }
      } else {
        announceStateRef.current = 'failed'
        setAnnounceState('failed')
        toast.error(d?.error ?? 'اعلام شروع کلاس ناموفق بود')
      }
    } catch {
      announceStateRef.current = 'failed'
      setAnnounceState('failed')
    }
  }, [me.id, sessionId])

  // ─── رسانه محلی مستقل — هر دستگاه فقط با اقدام خود کاربر و جدا از بقیه گرفته می‌شود؛
  // نبود یا رد مجوز یک دستگاه هرگز مانع دستگاه دیگر یا ادامه جلسه نیست ───

  /** گرفتن ترک میکروفون (اگر قبلاً گرفته شده همان برمی‌گردد) */
  const ensureMic = useCallback(async (): Promise<MediaStreamTrack> => {
    if (micTrackRef.current) return micTrackRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      const track = stream.getAudioTracks()[0]
      if (!track) throw new DOMException('no audio track', 'NotFoundError')
      micTrackRef.current = track
      return track
    } catch (e) {
      const name = (e as DOMException)?.name ?? ''
      let msg =
        e instanceof Error && MIC_TIMEOUT_MSG === e.message
          ? e.message
          : (MIC_ERRORS[name] ?? 'دسترسی به میکروفون ممکن نشد؛ می‌توانید بدون میکروفون در جلسه بمانید.')
      if (name === 'NotAllowedError' && isEmbedded()) {
        msg += ' این صفحه در قالب پیش‌نمایش توکار (iframe) باز است و مرورگر در iframe مجوز دستگاه نمی‌دهد — با دکمه «باز کردن در پنجره جدید» ادامه دهید.'
      }
      throw new Error(msg)
    }
  }, [])

  /** گرفتن ترک دوربین (اگر قبلاً گرفته شده همان برمی‌گردد) */
  const ensureCam = useCallback(async (): Promise<MediaStreamTrack> => {
    if (camTrackRef.current) return camTrackRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      })
      const track = stream.getVideoTracks()[0]
      if (!track) throw new DOMException('no video track', 'NotFoundError')
      camTrackRef.current = track
      camStreamRef.current = stream
      return track
    } catch (e) {
      const name = (e as DOMException)?.name ?? ''
      let msg =
        e instanceof Error && CAM_TIMEOUT_MSG === e.message
          ? e.message
          : (CAM_ERRORS[name] ?? 'دسترسی به دوربین ممکن نشد؛ میکروفون و اشتراک صفحه مستقل کار می‌کنند.')
      if (name === 'NotAllowedError' && isEmbedded()) {
        msg += ' این صفحه در قالب پیش‌نمایش توکار (iframe) باز است و مرورگر در iframe مجوز دستگاه نمی‌دهد — با دکمه «باز کردن در پنجره جدید» ادامه دهید.'
      }
      throw new Error(msg)
    }
  }, [])

  // ─── SFU (LiveKit) — اتصال، انتشار و اشتراک رسانه ───

  /** نگاشت منبع ترک LiveKit به کاربرد نمایشی */
  const purposeFromSource = (source: Track.Source): TrackPurpose | null =>
    source === Track.Source.Microphone
      ? 'mic'
      : source === Track.Source.Camera
        ? 'camera'
        : source === Track.Source.ScreenShare
          ? 'screen'
          : null

  /** اعمال کیفیت تطبیقی/کم‌مصرف روی اشتراک‌های ویدیویی */
  const applyLowDataQuality = useCallback((room: Room) => {
    const quality = lowDataRef.current ? VideoQuality.LOW : VideoQuality.HIGH
    for (const rp of room.remoteParticipants.values()) {
      for (const source of [Track.Source.Camera, Track.Source.ScreenShare]) {
        try {
          rp.getTrackPublication(source)?.setVideoQuality(quality)
        } catch {
          /* ترک هنوز subscribe نشده — بعد از TrackSubscribed دوباره اعمال می‌شود */
        }
      }
    }
  }, [])

  /** همگام‌سازی وضعیت واقعی ترک‌های منتشرشده با UI — پس از اتصال/اتصال مجدد:
   * livekit-client ترک‌های محلی را پس از reconnect خودکار دوباره منتشر می‌کند؛
   * اینجا UI (میکروفون/دوربین/اشتراک و سوییچ شروع کلاس) را با حقیقت SFU هم‌تراز می‌کنیم */
  const syncPublishedState = useCallback((room: Room) => {
    const lp = room.localParticipant
    if (!lp) return
    const micPub = lp.getTrackPublication(Track.Source.Microphone)
    const camPub = lp.getTrackPublication(Track.Source.Camera)
    const scrPub = lp.getTrackPublication(Track.Source.ScreenShare)
    setMicOn(!!micPub?.track && !micPub.isMuted)
    setCamOn(!!camPub?.track && !camPub.isMuted)
    setSharing(!!scrPub?.track)
    const any = !!(micPub?.track || camPub?.track || scrPub?.track)
    publishedReadyRef.current = any
    setAnyPublished(any)
  }, [])

  /** ثبت رویدادهای اتاق SFU — انتشار/اشتراک/قطع‌وصل/مجوزها.
   * تابع «جداکردن» برمی‌گرداند تا مسیر شکست/بستن، شنونده‌ها را کامل پاک کند.
   * همهٔ شنونده‌ها گارد «اتاقِ جاری» دارند: رویداد از اتاق منسوخ/بسته‌شده هرگز
   * وضعیت UI را تغییر نمی‌دهد (تلاش دیرهنگامِ قبلی پس از شکست/unmount بی‌اثر می‌ماند). */
  const registerRoomEvents = useCallback(
    (room: Room): (() => void) => {
      const isCurrent = () => roomRef.current === room
      const onTrackSubscribed = (track: RemoteTrack, pub: RemoteTrackPublication, rp: RemoteParticipant) => {
        const purpose = purposeFromSource(pub.source)
        if (!purpose) return
        const stream = track.mediaStream
        if (!stream) return
        setRemoteStreams((prev) => ({
          ...prev,
          [rp.identity]: { ...(prev[rp.identity] ?? {}), [purpose]: stream },
        }))
        if (lowDataRef.current && (purpose === 'camera' || purpose === 'screen')) {
          try {
            pub.setVideoQuality(VideoQuality.LOW)
          } catch {
            /* ignore */
          }
        }
      }
      const onTrackUnsubscribed = (_t: RemoteTrack, pub: RemoteTrackPublication, rp: RemoteParticipant) => {
        const purpose = purposeFromSource(pub.source)
        if (!purpose) return
        setRemoteStreams((prev) => {
          const forUser = { ...(prev[rp.identity] ?? {}) }
          delete forUser[purpose]
          return { ...prev, [rp.identity]: forUser }
        })
      }
      const onLocalTrackPublished = (pub: LocalTrackPublication) => {
        // انتشار واقعی رسانه در SFU برقرار شد → شرط فعال‌شدن سوییچ «شروع کلاس»
        // (صوت، دوربین یا اشتراک صفحه — هر کدام کافی است؛ صرف ورود کافی نیست)
        const src = pub?.source
        if (src !== Track.Source.Microphone && src !== Track.Source.Camera && src !== Track.Source.ScreenShare) return
        publishedReadyRef.current = true
        setAnyPublished(true)
      }
      const onLocalTrackUnpublished = (pub: LocalTrackPublication) => {
        // حذف انتشار (مثلاً لغو مجوز از سمت سرور) → آمادگی سوییچ دوباره محاسبه می‌شود
        const src = pub?.source
        if (src !== Track.Source.Microphone && src !== Track.Source.Camera && src !== Track.Source.ScreenShare) return
        syncPublishedState(room)
      }
      const onPermsChanged = (_prev: unknown, p: import('livekit-client').LocalParticipant | RemoteParticipant) => {
        if (p !== room.localParticipant) return
        const lp = room.localParticipant
        if (!lp.permissions?.canPublish) {
          // گیت سرور رسانه: اجازه انتشار لغو شد → رسانه‌ی خود فوراً ساکت می‌شود
          setMicOn(false)
          setCamOn(false)
          for (const source of [Track.Source.Microphone, Track.Source.Camera]) {
            const pub = lp.getTrackPublication(source)
            void pub?.track?.mute().catch(() => null)
          }
          toast.error('اجازه انتشار رسانه توسط معلم لغو شد')
        }
      }
      const onReconnecting = () => {
        if (!isCurrent()) return
        setLkStatus('reconnecting')
      }
      const onReconnected = () => {
        if (!isCurrent()) return
        setLkStatus('connected')
        applyLowDataQuality(room)
        // وضعیت واقعی ترک‌ها/مجوزها پس از اتصال مجدد دوباره همگام می‌شود
        syncPublishedState(room)
        toast.success('اتصال رسانه دوباره برقرار شد')
      }
      const onDisconnected = () => {
        if (!isCurrent()) return
        lkConnectedRef.current = false
        setLkStatus('failed')
      }
      room.on(RoomEvent.TrackSubscribed, onTrackSubscribed)
      room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
      room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished)
      room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished)
      room.on(RoomEvent.ParticipantPermissionsChanged, onPermsChanged)
      room.on(RoomEvent.Reconnecting, onReconnecting)
      room.on(RoomEvent.Reconnected, onReconnected)
      room.on(RoomEvent.Disconnected, onDisconnected)
      return () => {
        room.off(RoomEvent.TrackSubscribed, onTrackSubscribed)
        room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
        room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished)
        room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished)
        room.off(RoomEvent.ParticipantPermissionsChanged, onPermsChanged)
        room.off(RoomEvent.Reconnecting, onReconnecting)
        room.off(RoomEvent.Reconnected, onReconnected)
        room.off(RoomEvent.Disconnected, onDisconnected)
      }
    },
    [applyLowDataQuality, syncPublishedState],
  )

  /**
   * اتصال به SFU — توکن فقط از سرور (بررسی عضویت + مجوز نقش).
   *
   * چرخهٔ عمر صریح:
   * - roomRef «فقط پس از موفقیت واقعی room.connect() و state==='connected'» ست می‌شود؛
   *   اتاق شکست‌خورده هرگز باقی نمی‌ماند (ریشهٔ «publishing rejected as engine not connected»).
   * - اتصال هم‌زمان تکراری با Promise مشترک جلوگیری می‌شود؛ تلاش مجدد پس از شکست
   *   همیشه ممکن است (Room تازه برای هر تلاش).
   * - شکست/timeout: Room همان تلاش disconnect می‌شود (در جریانِ connect را لغو می‌کند)،
   *   شنونده‌ها جدا و وضعیت به «قابل بازیابی» برمی‌گردد؛ throw نمی‌کند تا گفتگو/تخته/
   *   کنترل جلسه (سرویس‌های جدا) هرگز از کار نیفتند.
   * - تلاش منسوخ (اتصال دیرهنگام قبلی پس از تلاش جدید/unmount) با شمارهٔ تلاش
   *   بی‌اثر می‌شود؛ iceServers فقط وقتی غیرخالی پاس داده می‌شود تا TURN خود سرور
   *   (مثل LiveKit Cloud) سرکوب نشود.
   */
  const connectLiveKit = useCallback(async (): Promise<Room | null> => {
    // اتصال سالم موجود → همان اتاق
    if (lkConnectedRef.current && roomRef.current?.state === 'connected') return roomRef.current
    // اتصال هم‌زمان تکراری → Promise مشترک همان تلاش
    if (connectPromiseRef.current) return connectPromiseRef.current

    const attempt = ++connectAttemptRef.current
    // به‌صورت صریح تایپ‌شده declare-then-assign — بدنهٔ async تنها پس از مقداردهی p اجرا نمی‌شود
    // مگر تا اولین await؛ finally همیشه بعد از انتساب اجرا می‌شود
    let p: Promise<Room | null> | undefined
    p = (async () => {
      setLkStatus('connecting')
      setMediaError(null)
      try {
        // ۱) توکن — فقط از سرور
        const fetchToken = () =>
          withTimeout(
            fetch(`/api/live-sessions/${sessionId}/token`, { method: 'POST' }),
            15000,
            'دریافت توکن رسانه بیش از حد طول کشید؛ اتصال خود را بررسی کنید و دوباره تلاش کنید.',
          )
        let r = await fetchToken()
        if (!r.ok && r.status >= 500) {
          // سرور رسانه شاید همین حالا توسط خودترمیم سمت سرور بالا آمده باشد —
          // یک تلاش مجدد کوتاه پیش از نمایش خطا به کاربر
          await new Promise((res) => setTimeout(res, 1500))
          try {
            r = await fetchToken()
          } catch {
            /* پاسخ نخست مرجع می‌ماند */
          }
        }
        if (!r.ok) {
          const d = (await r.json().catch(() => null)) as { error?: string } | null
          throw new Error(d?.error ?? 'دریافت توکن رسانه ناموفق بود')
        }
        const tk = (await r.json()) as {
          token: string
          url: string
          iceServers: { urls: string | string[]; username?: string; credential?: string }[]
        }

        // ۲) Room مخصوص «همین تلاش» — roomRef فقط پس از موفقیت
        const room = new Room({ adaptiveStream: true, dynacast: true })
        const detach = registerRoomEvents(room)
        // دیباگ توسعه: دسترسی بازرسی اتاق از کنسول/آزمون‌ها (در بیلد production حذف می‌شود)
        if (process.env.NODE_ENV !== 'production') {
          ;(window as unknown as { __lkRoom?: Room }).__lkRoom = room
        }
        try {
          // ۳) اتصال واقعی — با timeout؛ اسکیم با پروتکل واقعی صفحه هم‌تراز می‌شود
          // (پشت درگاه‌هایی که X-Forwarded-Proto را بازنویسی می‌کنند، سرور ws:// می‌دهد
          // و مرورگرِ صفحه‌ی HTTPS آن را مسدود می‌کند؛ میزبانِ سرور رسانه‌ی جداگانه دست‌نخورده می‌ماند)
          //
          // iceServers فقط وقتی غیرخالی پاس داده می‌شود — livekit-server سرویسِ
          // بیرونی (مثل LiveKit Cloud) STUN/TURN خود را در پاسخ join می‌فرستد و
          // SDK فقط وقتی کلاینت هیچ iceServers نفرستاده از آن‌ها استفاده می‌کند؛
          // فرستادن آرایهٔ صرفاً-STUN ناخواسته TURN سرور را حذف می‌کند.
          const connectOpts =
            tk.iceServers && tk.iceServers.length
              ? { rtcConfig: { iceServers: tk.iceServers as RTCIceServer[] } }
              : {}
          await withTimeout(
            room.connect(alignSignalUrl(tk.url), tk.token, connectOpts),
            25000,
            'اتصال به سرور رسانه (SFU) بیش از حد طول کشید؛ شبکه/فایروال UDP را بررسی کنید.',
          )
          // ۴) تأیید اتصال واقعی — فقط resolve شدن کافی نیست
          if (room.state !== 'connected') {
            throw new Error('اتصال رسانه پس از برقراری سیگنال تکمیل نشد')
          }
          // تلاش جدیدتری جایش را گرفته؟ (مثلاً کاربر روی «تلاش مجدد» زده) — این اتاق را ببند
          if (connectAttemptRef.current !== attempt) {
            detach()
            await room.disconnect().catch(() => undefined)
            return null
          }
          // ۵) موفقیت — refها فقط حالا ست می‌شوند
          roomRef.current = room
          lkConnectedRef.current = true
          roomDetachRef.current = detach
          setLkStatus('connected')
          applyLowDataQuality(room)
          syncPublishedState(room)
          return room
        } catch (e) {
          // ۶) شکست/timeout — پاک‌سازی کامل همین تلاش: Room بسته می‌شود (در جریانِ
          // connect را لغو می‌کند)، شنونده‌ها جدا و هیچ ref ای باقی نمی‌ماند؛
          // ترک محلیِ منتشرنشده هم خاموش می‌شود تا دستگاه بی‌دلیل روشن نماند
          detach()
          await room.disconnect().catch(() => undefined)
          if (connectAttemptRef.current === attempt) {
            if (roomRef.current === room) {
              roomRef.current = null
              lkConnectedRef.current = false
            }
            setLkStatus('failed')
            setMediaError(classifyConnectError(e))
          }
          return null
        }
      } catch (e) {
        // شکست در مرحلهٔ توکن/سیگنال — بدون Room
        if (connectAttemptRef.current === attempt) {
          setLkStatus('failed')
          setMediaError(classifyConnectError(e))
        }
        return null
      } finally {
        if (p !== undefined && connectPromiseRef.current === p) connectPromiseRef.current = null
      }
    })()
    connectPromiseRef.current = p
    return p
  }, [me.id, sessionId, registerRoomEvents, applyLowDataQuality, syncPublishedState])

  /**
   * پاک‌سازی کامل رسانه — بستن اتاق، جداکردن شنونده‌ها، ابطال تلاش در جریان
   * (اتصال دیرهنگام پس از unmount/خروج هرگز دوباره فعال نمی‌شود) و خاموش‌کردن
   * ترک‌های دستگاه تا دوربین/میکروفون/اشتراک صفحه بی‌دلیل روشن نماند.
   */
  const teardownMedia = useCallback(() => {
    // ابطال هر تلاش اتصال در جریان + قطع سادهٔ اتاق (در صورت وجود)
    connectAttemptRef.current++
    connectPromiseRef.current = null
    try {
      roomRef.current?.disconnect()
    } catch {
      /* ignore */
    }
    roomDetachRef.current?.()
    roomDetachRef.current = null
    roomRef.current = null
    lkConnectedRef.current = false
    screenTrackRef.current?.stop()
    screenTrackRef.current = null
    micTrackRef.current?.stop()
    micTrackRef.current = null
    camTrackRef.current?.stop()
    camTrackRef.current = null
    camStreamRef.current = null
    publishedReadyRef.current = false
    setAnyPublished(false)
    setRemoteStreams({})
    setLkStatus('idle')
  }, [])

  /**
   * تلاش مجدد اتصال رسانه — بدون رفرش کامل صفحه؛ اتاقِ شکست‌خورده/نیمه‌مرده
   * کامل بسته و پاک می‌شود و اتصال تازه با Room تازه برقرار می‌شود.
   * اگر موفق شود وضعیت ترک‌ها/مجوزها هم دوباره همگام می‌شود (داخل connect).
   */
  const retryMedia = useCallback(async () => {
    if (connectPromiseRef.current) {
      toast.info('در حال تلاش برای اتصال رسانه…')
      return
    }
    // بستن هر اتاق قبلی (موفق یا شکست‌خورده) — شنونده‌ها و refها پاک می‌شوند
    const old = roomRef.current
    if (old) {
      connectAttemptRef.current++ // رویدادهای اتاق قدیمی بی‌اثر
      try {
        await old.disconnect()
      } catch {
        /* ignore */
      }
      roomDetachRef.current?.()
      roomDetachRef.current = null
      roomRef.current = null
      lkConnectedRef.current = false
      setRemoteStreams({})
    }
    const room = await connectLiveKit()
    if (room) {
      setMediaError(null)
      toast.success('اتصال رسانه برقرار شد')
    }
  }, [connectLiveKit])

  // ─── اتصال و ورود به جلسه ───
  useEffect(() => {
    let alive = true
    const socket = getSocket()

    const handlers: [string, (...args: never[]) => void][] = []

    // راهنمای کندی ورود — پس از ۱۰ ثانیه، محتمل‌ترین علت (پنجره مجوز مرورگر) یادآوری می‌شود
    const slowTimer = setTimeout(() => {
      if (alive) setSlowJoin(true)
    }, 10000)
    // نظارت نهایی: هرگونه توقف پیش‌بینی‌نشده در «در حال ورود…» باید به خطای شفاف برسد
    let settled = false
    const watchdog = setTimeout(() => {
      if (!alive || settled || joinedRef.current) return
      settled = true
      setErrorInfo({
        title: 'ورود به جلسه بیش از حد طول کشید',
        msg: 'ارتباط بلادرنگ برقرار نشد. اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.',
      })
      setPhase('error')
    }, WATCHDOG_MS)

    const on = (event: string, fn: (...args: never[]) => void) => {
      socket.on(event, fn as never)
      handlers.push([event, fn])
    }

    on('live:participant-joined', ((data: { sessionId: string; participant: ParticipantView }) => {
      if (data.sessionId !== sessionId) return
      setParticipants((prev) => {
        const exists = prev.some((p) => p.userId === data.participant.userId)
        if (exists) return prev.map((p) => (p.userId === data.participant.userId ? data.participant : p))
        return [...prev, data.participant]
      })
    }) as never)

    on('live:participant-left', ((data: { sessionId: string; userId: string }) => {
      if (data.sessionId !== sessionId) return
      setParticipants((prev) => prev.filter((p) => p.userId !== data.userId))
      setRemoteStreams((prev) => {
        const next = { ...prev }
        delete next[data.userId]
        return next
      })
    }) as never)

    on('live:participant-update', ((data: { sessionId: string; participant: ParticipantView }) => {
      if (data.sessionId !== sessionId) return
      const p = data.participant
      if (p.userId === me.id) {
        setSelfPerms({
          canSpeak: p.canSpeak,
          canShare: p.canShare,
          canCam: p.canCam,
          mutedByTeacher: p.mutedByTeacher,
        })
        setHandRaised(p.handRaised)
      }
      setParticipants((prev) =>
        prev.some((x) => x.userId === p.userId)
          ? prev.map((x) => (x.userId === p.userId ? p : x))
          : [...prev, p],
      )
    }) as never)

    on('live:you-are-muted', (() => {
      setMicOn(false)
      if (micTrackRef.current) micTrackRef.current.enabled = false
      // میکروفون منتشرشده در SFU هم ساکت می‌شود (سرور هم موازی enforce می‌کند)
      const pub = roomRef.current?.localParticipant?.getTrackPublication(Track.Source.Microphone)
      void pub?.track?.mute().catch(() => null)
      toast.error('میکروفون شما توسط معلم بسته شد')
    }) as never)

    on('live:permission-changed', ((data: { sessionId: string; canSpeak: boolean; canShare: boolean; canCam?: boolean; canSpeakNow: boolean }) => {
      if (data.sessionId !== sessionId) return
      setSelfPerms((prev) => ({
        ...prev,
        canSpeak: data.canSpeak,
        canShare: data.canShare,
        canCam: typeof data.canCam === 'boolean' ? data.canCam : prev.canCam,
      }))
      if (data.canSpeak) toast.success('معلم به شما اجازه صحبت داد')
      if (data.canCam === true) toast.success('معلم به شما اجازه دوربین داد')
      if (data.canCam === false) {
        // گیت سرور رسانه (LiveKit) هم ترک دوربین را حذف/ساکت می‌کند؛ اینجا UI همگام می‌شود
        setCamOn(false)
        if (camTrackRef.current) camTrackRef.current.enabled = false
      }
      if (!data.canSpeak && !data.canShare) {
        setMicOn(false)
        if (micTrackRef.current) micTrackRef.current.enabled = false
      }
    }) as never)

    on('live:chat', ((msg: ChatItem) => {
      setChat((prev) => [...prev, msg])
    }) as never)

    on('live:kicked', (() => {
      joinedRef.current = false
      teardownMedia()
      setPhase('kicked')
    }) as never)

    on('live:replaced', (() => {
      joinedRef.current = false
      teardownMedia()
      setErrorInfo({
        title: 'اتصال جایگزین شد',
        msg: 'حساب شما از دستگاه یا پنجره دیگری به جلسه وارد شد؛ این اتصال بسته شد.',
      })
      setPhase('error')
    }) as never)

    on('live:ended', ((data: { sessionId: string }) => {
      if (data.sessionId !== sessionId) return
      joinedRef.current = false
      teardownMedia()
      setEndedBy((prev) => prev ?? 'other')
      setPhase('ended')
    }) as never)

    // وضعیت اتصال معلم میزبان — قطع موقت معلم پایان قطعی نیست؛ مهلت اتصال مجدد داریم
    on('live:host-status', ((data: {
      sessionId: string
      hostConnected: boolean
      graceSeconds?: number
    }) => {
      if (data.sessionId !== sessionId) return
      setHostStatus({
        connected: data.hostConnected,
        graceSeconds: data.graceSeconds ?? null,
      })
    }) as never)

    // ─── تخته سفید معلم — همگام‌سازی ───
    on('live:wboard-active', ((data: { sessionId: string; active: boolean }) => {
      if (data.sessionId !== sessionId) return
      setWboardActive(data.active)
      if (!data.active) setWboardOps([])
    }) as never)

    on('live:wboard-op', ((data: { sessionId: string; op: WbOp }) => {
      if (data.sessionId !== sessionId) return
      setWboardOps((prev) => [...prev, data.op])
    }) as never)

    on('live:wboard-clear', ((data: { sessionId: string }) => {
      if (data.sessionId !== sessionId) return
      setWboardOps([])
    }) as never)

    // رله WebRTC (offer/answer/ICE/track-map) حذف شد — رسانه با SFU (LiveKit) منتقل می‌شود

    // اتصال مجدد سوکت پیام‌رسان: ورود مجدد بدون شرکت‌کننده تکراری —
    // رسانه (SFU) مستقل است و خودش reconnect می‌شود؛ اینجا فقط وضعیت اتاق بازسازی می‌شود
    on('connect', (() => {
      if (!joinedRef.current) return
      socket.emit('live:join', { sessionId }, (res: { ok: boolean; error?: string; data?: unknown }) => {
        if (!res?.ok) {
          joinedRef.current = false
          teardownMedia()
          setErrorInfo({ title: 'ورود مجدد ناموفق بود', msg: res?.error ?? 'خطای ناشناخته' })
          setPhase('error')
          return
        }
        const d = res.data as {
          self: ParticipantView
          hostId: string
          participants: ParticipantView[]
          chat: ChatItem[]
          wboard?: { active: boolean; ops: WbOp[] }
        }
        setParticipants(d.participants)
        setChat(d.chat)
        setSelfPerms({
          canSpeak: d.self.canSpeak,
          canShare: d.self.canShare,
          canCam: d.self.canCam,
          mutedByTeacher: d.self.mutedByTeacher,
        })
        // همگام‌سازی تخته سفید پس از اتصال مجدد
        if (d.wboard) {
          setWboardActive(d.wboard.active)
          setWboardOps(d.wboard.ops as WbOp[])
        }
        // اتصال مجدد معلم: اگر اعلام شروع هنوز انجام نشده بود، پس از انتشار رسانه دوباره تلاش می‌شود
        setHostId(d.hostId)
        setHostStatus((prev) => (prev?.connected ? prev : { connected: true, graceSeconds: null }))
      })
    }) as never)

    ;(async () => {
      try {
      // ۱) جزئیات جلسه (احراز دسترسی سمت سرور) — با سقف زمانی؛ هنگ بی‌پایان ممنوع
      const r = await withTimeout(
        fetch(`/api/live-sessions/${sessionId}`, { cache: 'no-store' }),
        FETCH_TIMEOUT_MS,
        'دریافت اطلاعات جلسه بیش از حد طول کشید؛ اتصال خود را بررسی کنید و دوباره تلاش کنید.',
      )
      if (!alive) return
      if (r.status === 404) {
        settled = true
        setErrorInfo({
          title: 'جلسه در دسترس نیست',
          msg: 'این جلسه وجود ندارد یا شما اجازه ورود به آن را ندارید.',
        })
        setPhase('error')
        return
      }
      const d = (await r.json()) as SessionDetail
      if (!r.ok) {
        settled = true
        setErrorInfo({ title: 'خطا', msg: 'دریافت اطلاعات جلسه ناموفق بود' })
        setPhase('error')
        return
      }
      sessionRef.current = d
      setSession(d)
      setHostId(d.host.id)
      if (d.status !== 'ACTIVE') {
        settled = true
        setPhase('ended')
        return
      }

      // وضعیت اولیه سوییچ «شروع کلاس» (فقط میزبان):
      // اعلام‌شده = روشن و قفل؛ اعلام‌نشده = خاموش و تا انتشار رسانه واقعی غیرفعال
      const iAmHost = d.isHost || d.host.id === me.id
      if (d.announcedAt) {
        announceStateRef.current = 'sent'
        setAnnounceState('sent')
      } else if (iAmHost) {
        announceStateRef.current = 'off'
        setAnnounceState('off')
      }

      // ۲) هیچ رسانه‌ای در ورود گرفته نمی‌شود — معلم/دانش‌آموز بدون دوربین و
      // میکروفون هم وارد اتاق می‌شود؛ هر دستگاه فقط با اقدام خود کاربر و به‌صورت
      // مستقل فعال می‌شود (کنترل‌ها در نوار پایین)؛ خطای هر دستگاه بقیه را مسدود نمی‌کند

      // ۳) ورود به جلسه با بررسی دسترسی کامل سمت سرور —
      // اگر سوکت هنوز وصل نیست ابتدا (تا سقف مهلت) منتظر اتصال می‌مانیم و
      // ack ورود هم سقف زمانی دارد؛ در شبکه‌های ناپایدار خطای شفاف می‌دهیم نه هنگ
      const joinReply = await new Promise<{
        res: { ok: boolean; error?: string; data?: unknown } | null
        timedOut: boolean
      }>((resolve) => {
        let done = false
        const finish = (v: { res: { ok: boolean; error?: string; data?: unknown } | null; timedOut: boolean }) => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(v)
        }
        const timer = setTimeout(() => finish({ res: null, timedOut: true }), JOIN_TIMEOUT_MS)
        const emitJoin = () => {
          // اگر کامپوننت در میان انتظار unmount شد، ورود ارسال نشود
          if (!alive) return
          socket.emit('live:join', { sessionId }, (res: { ok: boolean; error?: string; data?: unknown }) =>
            finish({ res, timedOut: false }),
          )
        }
        if (socket.connected) emitJoin()
        else socket.once('connect', emitJoin)
      })
      if (!alive) return
      if (!joinReply.res) {
        settled = true
        setErrorInfo({
          title: 'ورود به جلسه ناموفق بود',
          msg: joinReply.timedOut
            ? 'اتصال بلادرنگ برقرار نشد؛ سرور جلسه در دسترس نیست یا اینترنت قطع است. دوباره تلاش کنید.'
            : 'پاسخ سرور جلسه دریافت نشد. دوباره تلاش کنید.',
        })
        setPhase('error')
        return
      }
      const res = joinReply.res
      {
        if (!res.ok) {
          settled = true
          const msg = res.error ?? 'ورود به جلسه ممکن نیست'
          if (msg.includes('پایان')) {
            setPhase('ended')
          } else {
            setErrorInfo({ title: 'ورود به جلسه ناموفق', msg })
            setPhase('error')
          }
          return
        }
        const data = res.data as {
          self: ParticipantView
          hostId: string
          participants: ParticipantView[]
          chat: ChatItem[]
          wboard?: { active: boolean; ops: WbOp[] }
        }
        joinedRef.current = true
        setHostId(data.hostId)
        setParticipants(data.participants)
        setChat(data.chat)
        setSelfPerms({
          canSpeak: data.self.canSpeak,
          canShare: data.self.canShare,
          canCam: data.self.canCam,
          mutedByTeacher: data.self.mutedByTeacher,
        })
        // وضعیت اولیه تخته سفید (تازه‌واردها تخته فعال را می‌بینند)
        if (data.wboard) {
          setWboardActive(data.wboard.active)
          setWboardOps(data.wboard.ops as WbOp[])
        }
        settled = true
        // ۴) اتصال رسانه به SFU (LiveKit) — پس از ورود سوکتی؛ خطای رسانه هرگز
        // گفتگو/تخته/کنترل جلسه را از کار نمی‌اندازد (سرویس‌های جدایند).
        // connectLiveKit هرگز throw نمی‌کند؛ خطا را دسته‌بندی‌شده در بنر رسانه
        // نشان می‌دهد و بازیابی با دکمه «تلاش مجدد اتصال رسانه» بدون رفرش است
        await connectLiveKit()
        setPhase('in-room')
        // ورود انجام شد؛ هیچ اعلان شروعی خودکار ارسال نمی‌شود —
        // سوییچ «شروع کلاس» فقط پس از انتشار حداقل یک رسانه واقعی فعال و با اقدام معلم ارسال می‌شود
      }
      } catch (e) {
        // هر خطای پیش‌بینی‌نشده در مسیر ورود → خطای شفاف؛ هیچ‌گاه هنگ بی‌پایان نمی‌مانیم
        if (!alive) return
        settled = true
        setErrorInfo({
          title: 'ورود به جلسه ناموفق بود',
          msg:
            e instanceof Error
              ? e.message
              : 'ارتباط با سرور برقرار نشد. اتصال خود را بررسی کنید و دوباره تلاش کنید.',
        })
        setPhase('error')
      }
    })()

    return () => {
      alive = false
      clearTimeout(slowTimer)
      clearTimeout(watchdog)
      for (const [event, fn] of handlers) socket.off(event, fn as never)
      if (joinedRef.current) {
        socket.emit('live:leave')
        joinedRef.current = false
      }
      // قطع SFU و پاک‌سازی کامل رسانه (اتاق/شنونده‌ها/ابطال تلاش در جریان/دستگاه‌ها)
      teardownMedia()
    }
  }, [sessionId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, panel, mobilePanel])

  // حالت کم‌مصرف — ماندگار بین جلسه‌ها (فقط کیفیت اشتراک را تغییر می‌دهد، نه امکانات)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOW_DATA_KEY) === '1'
      lowDataRef.current = saved
      setLowData(saved)
    } catch {
      /* ignore */
    }
  }, [])

  function toggleLowData() {
    const next = !lowData
    lowDataRef.current = next
    setLowData(next)
    try {
      window.localStorage.setItem(LOW_DATA_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
    const room = roomRef.current
    if (room) applyLowDataQuality(room)
    toast.success(
      next
        ? 'حالت کم‌مصرف روشن شد — کیفیت ویدیو برای اینترنت ضعیف کاهش می‌یابد'
        : 'حالت کم‌مصرف خاموش شد — کیفیت کامل ویدیو',
    )
  }

  // ─── کنترل‌ها ───

  const announceMedia = (patch: { micOn?: boolean; camOn?: boolean; sharing?: boolean }) => {
    const socket = getSocket()
    socket.emit('live:media', patch, (res: { ok: boolean; error?: string }) => {
      if (res && !res.ok) toast.error(res.error ?? 'تغییر وضعیت رسانه ممکن نشد')
    })
  }

  /** فعال‌سازی میکروفون — مستقل از دوربین؛ گرفتن مجوز/انتشار فقط همین‌جا و با اقدام کاربر */
  function toggleMic() {
    if (selfPerms.mutedByTeacher) {
      toast.error('میکروفون شما توسط معلم بسته شده است')
      return
    }
    if (!selfPerms.canSpeak) {
      toast.error('برای صحبت باید از معلم اجازه بگیرید (دست بلند کنید)')
      return
    }
    if (micBusy) return
    void (async () => {
      const next = !micOn
      // گارد اتصال واقعی: اتاق باید متصل باشد (وجود localParticipant کافی نیست —
      // اتاق نیمه‌مرده دقیقاً همان خطای «engine not connected» را می‌داد)
      const room = roomRef.current
      const lp = room?.localParticipant
      if (!room || room.state !== 'connected' || !lkConnectedRef.current || !lp) {
        toast.error('اتصال رسانه برقرار نیست — با دکمه «تلاش مجدد اتصال رسانه» دوباره وصل شوید')
        return
      }
      if (!next) {
        // خاموش‌کردن — اگر منتشر شده ساکت شود
        const pub = lp.getTrackPublication(Track.Source.Microphone)
        try {
          if (pub?.track) await pub.track.mute()
          if (micTrackRef.current) micTrackRef.current.enabled = false
        } catch (e) {
          console.error('mute mic error', e)
        }
        setMicOn(false)
        announceMedia({ micOn: false })
        return
      }
      setMicBusy(true)
      const hadTrack = !!micTrackRef.current
      try {
        const audioTrack = await withTimeout(ensureMic(), isHost ? MEDIA_TIMEOUT_HOST_MS : MEDIA_TIMEOUT_OTHER_MS, MIC_TIMEOUT_MSG)
        const pub = lp.getTrackPublication(Track.Source.Microphone)
        if (!pub) {
          // نخستین انتشار — فقط با مجوز معلم + اقدام خود کاربر (گیت سرور رسانه هم فعال است)
          audioTrack.enabled = true
          await lp.publishTrack(audioTrack, { source: Track.Source.Microphone, dtx: true })
        } else if (pub.track) {
          await pub.track.unmute()
          audioTrack.enabled = true
        }
        setMicOn(true)
        announceMedia({ micOn: true })
      } catch (e) {
        // ترکِ تازه‌گرفته که منتشر نشد خاموش می‌شود تا میکروفون بی‌دلیل روشن نماند
        if (!hadTrack && micTrackRef.current) {
          micTrackRef.current.stop()
          micTrackRef.current = null
        }
        const raw = e instanceof Error ? e.message : 'روشن‌کردن میکروفون ممکن نشد'
        const msg = raw.includes('engine not connected')
          ? 'اتصال رسانه برقرار نیست — ابتدا با «تلاش مجدد اتصال رسانه» وصل شوید'
          : raw
        setMediaError(msg)
        toast.error(msg)
        setMicOn(false)
      } finally {
        setMicBusy(false)
      }
    })()
  }

  /** فعال‌سازی دوربین — مستقل از میکروفون؛ نبود/رد مجوز دوربین بقیه را مسدود نمی‌کند */
  function toggleCam() {
    // دوربین دانش‌آموز فقط با اجازه معلم — سمت سرور (سوکت + LiveKit) هم enforce می‌شود
    if (!isHost && !selfPerms.canCam) {
      toast.error('برای روشن‌کردن دوربین باید از معلم اجازه بگیرید')
      return
    }
    if (camBusy) return
    void (async () => {
      const next = !camOn
      // گارد اتصال واقعی — همان toggleMic
      const room = roomRef.current
      const lp = room?.localParticipant
      if (!room || room.state !== 'connected' || !lkConnectedRef.current || !lp) {
        toast.error('اتصال رسانه برقرار نیست — با دکمه «تلاش مجدد اتصال رسانه» دوباره وصل شوید')
        return
      }
      if (!next) {
        const pub = lp.getTrackPublication(Track.Source.Camera)
        try {
          if (pub?.track) await pub.track.mute()
          if (camTrackRef.current) camTrackRef.current.enabled = false
        } catch (e) {
          console.error('mute cam error', e)
        }
        setCamOn(false)
        announceMedia({ camOn: false })
        return
      }
      setCamBusy(true)
      const hadTrack = !!camTrackRef.current
      try {
        const camTrack = await withTimeout(ensureCam(), isHost ? MEDIA_TIMEOUT_HOST_MS : MEDIA_TIMEOUT_OTHER_MS, CAM_TIMEOUT_MSG)
        const pub = lp.getTrackPublication(Track.Source.Camera)
        if (!pub) {
          camTrack.enabled = true
          await lp.publishTrack(camTrack, { source: Track.Source.Camera, videoEncoding: CAM_ENCODING })
        } else if (pub.track) {
          await pub.track.unmute()
          camTrack.enabled = true
        }
        setCamOn(true)
        announceMedia({ camOn: true })
      } catch (e) {
        // ترکِ تازه‌گرفته که منتشر نشد خاموش می‌شود تا دوربین/چراغ آن بی‌دلیل روشن نماند
        if (!hadTrack && camTrackRef.current) {
          camTrackRef.current.stop()
          camTrackRef.current = null
          camStreamRef.current = null
        }
        const raw = e instanceof Error ? e.message : 'روشن‌کردن دوربین ممکن نشد'
        const msg = raw.includes('engine not connected')
          ? 'اتصال رسانه برقرار نیست — ابتدا با «تلاش مجدد اتصال رسانه» وصل شوید'
          : raw
        setMediaError(msg)
        toast.error(msg)
        setCamOn(false)
      } finally {
        setCamBusy(false)
      }
    })()
  }

  function stopShare() {
    const track = screenTrackRef.current
    if (!track) return
    const lp = roomRef.current?.localParticipant
    try {
      if (lp) lp.unpublishTrack(track, true)
    } catch {
      /* ignore */
    }
    track.stop()
    screenTrackRef.current = null
    setSharing(false)
    announceMedia({ sharing: false })
  }

  async function toggleShare() {
    if (sharing) {
      stopShare()
      return
    }
    if (!selfPerms.canShare && !isHost) {
      toast.error('برای اشتراک‌گذاری صفحه باید از معلم اجازه بگیرید')
      return
    }
    // گارد اتصال واقعی — همان toggleMic/toggleCam
    const room = roomRef.current
    const lp = room?.localParticipant
    if (!room || room.state !== 'connected' || !lkConnectedRef.current || !lp) {
      toast.error('اتصال رسانه برقرار نیست — با دکمه «تلاش مجدد اتصال رسانه» دوباره وصل شوید')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track = stream.getVideoTracks()[0]
      if (!track) return
      track.contentHint = 'detail'
      await lp.publishTrack(track, {
        source: Track.Source.ScreenShare,
        videoEncoding: SCREEN_ENCODING,
      })
      // ثبت فقط پس از انتشار موفق؛ در شکست ترک متوقف می‌شود تا انتخاب صفحه/نوار اشتراک بی‌دلیل نماند
      screenTrackRef.current = track
      setSharing(true)
      announceMedia({ sharing: true })
      track.addEventListener('ended', () => stopShare())
      // انتشار موفق اشتراک صفحه هم شرط «حداقل یک رسانه» سوییچ شروع کلاس را برآورده می‌کند
    } catch (e) {
      screenTrackRef.current?.stop()
      screenTrackRef.current = null
      const raw = e instanceof Error ? e.message : ''
      const msg = raw.includes('engine not connected')
        ? 'اتصال رسانه برقرار نیست — ابتدا با «تلاش مجدد اتصال رسانه» وصل شوید'
        : raw.includes('NotAllowed')
          ? 'اجازه اشتراک صفحه داده نشد یا انتخاب صفحه لغو شد'
          : 'اشتراک‌گذاری صفحه انجام نشد یا لغو شد'
      toast.error(msg)
    }
  }

  function toggleHand() {
    const next = !handRaised
    const socket = getSocket()
    socket.emit('live:hand', { raised: next }, (res: { ok: boolean; error?: string }) => {
      if (res && !res.ok) toast.error(res.error ?? 'خطا')
      else {
        setHandRaised(next)
        if (next) toast.success('درخواست صحبت برای معلم ارسال شد')
      }
    })
  }

  function leaveRoom() {
    const socket = getSocket()
    if (joinedRef.current) socket.emit('live:leave')
    joinedRef.current = false
    teardownMedia()
    router.push('/live')
  }

  function endSession() {
    const socket = getSocket()
    socket.emit('live:end', (res: { ok: boolean; error?: string }) => {
      setConfirmEnd(false)
      if (res && !res.ok) {
        toast.error(res.error ?? 'پایان جلسه ممکن نشد')
        return
      }
      joinedRef.current = false
      teardownMedia()
      setEndedBy('self')
      setPhase('ended')
    })
  }

  function sendChat() {
    const body = chatInput.trim()
    if (!body) return
    const socket = getSocket()
    socket.emit('live:chat', { body }, (res: { ok: boolean; error?: string }) => {
      if (res && !res.ok) toast.error(res.error ?? 'ارسال پیام ناموفق بود')
    })
    setChatInput('')
  }

  // ─── تخته سفید معلم ───

  /** ترسیم/undo/clear — ابتدا محلی، سپس ارسال به سرور برای بقیه */
  function commitWbOp(op: WbOp) {
    if (op.type === 'clear') {
      // پاک‌سازی با رویداد سروری می‌آید (شامل خود فرستنده) — محلی دست نمی‌زنیم
    } else if (op.type === 'stroke') {
      setWboardOps((prev) => [...prev, op])
    } else if (op.type === 'undo') {
      setWboardOps((prev) => [...prev, op])
    }
    const socket = getSocket()
    socket.emit('live:wboard-op', { op }, (res: { ok: boolean; error?: string }) => {
      if (res && !res.ok) toast.error(res.error ?? 'ثبت روی تخته ناموفق بود')
    })
  }

  /** فعال/غیرفعال‌کردن تخته — وضعیت از رویداد سروری (شامل خود فرستنده) به‌روز می‌شود */
  function toggleWboard() {
    const socket = getSocket()
    socket.emit(
      'live:wboard-toggle',
      { active: !wboardActive },
      (res: { ok: boolean; error?: string }) => {
        if (res && !res.ok) toast.error(res.error ?? 'تغییر وضعیت تخته ناموفق بود')
      },
    )
  }

  // ─── ابزارهای معلم ───

  const hostAction = (event: string, payload: Record<string, unknown>) => {
    const socket = getSocket()
    socket.emit(event, payload, (res: { ok: boolean; error?: string }) => {
      if (res && !res.ok) toast.error(res.error ?? 'عملیات ناموفق بود')
    })
  }

  // ─── حالت‌های تمام‌صفحه ───

  if (phase === 'loading') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">در حال ورود به جلسه…</p>
        {slowJoin && (
          <p className="max-w-xs text-center text-xs leading-5 text-muted-foreground">
            ورود بیش از حد معمول طول کشیده است؛ چند لحظه دیگر پیام خطا و امکان تلاش مجدد نمایش داده می‌شود.
          </p>
        )}
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <FullState
        icon={<AlertTriangle className="h-10 w-10 text-destructive" />}
        title={errorInfo?.title ?? 'خطا'}
        msg={errorInfo?.msg ?? ''}
        backLabel="بازگشت"
        retry
      />
    )
  }

  if (phase === 'kicked') {
    return (
      <FullState
        icon={<ShieldAlert className="h-10 w-10 text-destructive" />}
        title="از جلسه خارج شدید"
        msg="معلم شما را از جلسه خارج کرد. برای پیگیری با معلم خود صحبت کنید."
        backLabel="بازگشت به کلاس آنلاین"
      />
    )
  }

  if (phase === 'ended') {
    return (
      <FullState
        icon={<Ban className="h-10 w-10 text-muted-foreground" />}
        title="جلسه پایان یافته"
        msg={
          endedBy === 'self'
            ? 'جلسه را پایان دادید؛ اتصال همه شرکت‌کنندگان قطع شد.'
            : 'جلسه توسط معلم یا مدیر مدرسه پایان یافت.'
        }
        backLabel="بازگشت به کلاس آنلاین"
      />
    )
  }

  // ─── رندر اتاق ───

  const screenSharer = participants.find((p) => p.sharing)
  const others = participants.filter((p) => p.userId !== me.id)
  const raisedHands = participants.filter((p) => p.handRaised && p.userId !== me.id)
  /** نمای متمرکز دانش‌آموز: فقط معلم/تخته/اشتراک صفحه — بدون موزاییک دانش‌آموزان */
  const focusedStudent = me.role === 'STUDENT' && !isHost
  const hostP = participants.find((p) => p.userId === hostId) ?? null
  /** دانش‌آموز بدون اجازه دوربین — دکمه دوربین قفل می‌شود */
  const camLocked = me.role === 'STUDENT' && !isHost && !selfPerms.canCam

  return (
    <div className="h-full min-h-0 flex flex-col bg-background">
      {/* هدر */}
      <header className="flex items-center gap-2 border-b px-3 sm:px-4 py-2 shrink-0">
        <MonitorPlay className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{session?.title}</div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              فعال
            </span>
            <span>— {session?.classroom.name}</span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {faNumSafe(participants.length)}
            </span>
          </div>
        </div>
        <span className="flex-1" />
        {!socketConnected && connStatus === 'connecting' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-bold">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            درحال اتصال…
          </span>
        )}
        {!socketConnected && connStatus === 'disconnected' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-bold">
            <WifiOff className="h-3.5 w-3.5" />
            قطع اتصال…
            <button
              type="button"
              onClick={() => void repairAndReload()}
              title="پاک‌سازی کش و نوسازی صفحه"
              className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] bg-background/60 hover:bg-accent transition-colors"
            >
              تلاش مجدد
            </button>
          </span>
        )}
        {lkStatus === 'connecting' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-bold">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            در حال اتصال رسانه…
          </span>
        )}
        {lkStatus === 'reconnecting' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-bold">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            اتصال مجدد رسانه…
          </span>
        )}
        {lkStatus === 'failed' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 font-bold">
            <WifiOff className="h-3.5 w-3.5" />
            رسانه قطع است
            <button
              type="button"
              onClick={() => void retryMedia()}
              title="تلاش مجدد اتصال رسانه — بدون رفرش صفحه"
              aria-label="تلاش مجدد اتصال رسانه"
              className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] bg-background/60 hover:bg-accent transition-colors"
            >
              تلاش مجدد رسانه
            </button>
          </span>
        )}
        {isHost && (
          <Button size="sm" variant="destructive" onClick={() => setConfirmEnd(true)}>
            <PhoneOff className="h-4 w-4" />
            پایان جلسه
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={leaveRoom}>
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">خروج</span>
        </Button>
      </header>

      {mediaError && (
        <div className="shrink-0 flex items-start gap-2 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-700 dark:text-amber-400 flex-wrap">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1 leading-5 min-w-[12rem]">{mediaError}</span>
          <span className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => void retryMedia()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              تلاش مجدد اتصال رسانه
            </Button>
            {embedded && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => window.open(window.location.href, '_blank', 'noopener')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                باز کردن در پنجره جدید
              </Button>
            )}
          </span>
        </div>
      )}

      {/* سوییچ «شروع کلاس» — فقط میزبان؛ فعال فقط پس از انتشار حداقل یک رسانه واقعی */}
      {isHost && announceState === 'off' && (
        <div className="shrink-0 flex items-center gap-3 bg-muted/60 border-b px-4 py-2 flex-wrap">
          <Switch
            checked={false}
            disabled={!anyPublished}
            onCheckedChange={() => void sendAnnounce()}
            aria-label="سوییچ شروع کلاس"
          />
          <span className="text-xs font-bold">شروع کلاس</span>
          <span className="text-[11px] text-muted-foreground leading-5">
            {anyPublished
              ? 'با روشن‌کردن سوییچ، اعلان شروع کلاس بلادرنگ برای دانش‌آموزان ارسال می‌شود.'
              : 'برای فعال‌شدن سوییچ، حداقل یک رسانه واقعی (میکروفون، دوربین یا اشتراک صفحه) منتشر کنید.'}
          </span>
        </div>
      )}

      {/* اعلام شروع کلاس — فقط میزبان */}
      {isHost && announceState === 'sent' && (
        <div className="shrink-0 flex items-center gap-2 bg-emerald-500/10 border-b border-emerald-500/30 px-4 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          اعلان شروع کلاس برای دانش‌آموزان ارسال شد؛ پیام دعوت هم در گروه درسی منتشر شد.
        </div>
      )}
      {isHost && announceState === 'sending' && (
        <div className="shrink-0 flex items-center gap-2 bg-muted/60 border-b px-4 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          در حال ارسال اعلان شروع کلاس…
        </div>
      )}
      {isHost && announceState === 'failed' && (
        <div className="shrink-0 flex items-center gap-2 bg-red-500/10 border-b border-red-500/30 px-4 py-2 text-xs text-red-700 dark:text-red-400 flex-wrap">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          اعلام شروع کلاس ناموفق بود؛ اعلانی برای دانش‌آموزان ارسال نشده است.
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void sendAnnounce()}>
            <RefreshCw className="h-3.5 w-3.5" />
            تلاش مجدد
          </Button>
        </div>
      )}

      {/* وضعیت اتصال معلم میزبان برای سایر شرکت‌کننده‌ها — قطع موقت پایان قطعی نیست */}
      {!isHost && hostStatus && !hostStatus.connected && (
        <div className="shrink-0 flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          <WifiOff className="h-4 w-4 shrink-0" />
          اتصال معلم قطع شده است؛ در صورت بازگشت تا {faNumSafe(hostStatus.graceSeconds ?? 60)} ثانیه جلسه ادامه می‌یابد وگرنه پایان می‌یابد.
        </div>
      )}

      {/* بدنه */}
      <div className="flex-1 min-h-0 flex">
        {/* صحنه اصلی — دانش‌آموز نمای متمرکز (معلم/تخته) بدون موزاییک؛ معلم موزاییک کامل */}
        {focusedStudent ? (
          <div className="flex-1 min-w-0 p-3 flex flex-col gap-3 min-h-0">
            {/* نمایشگر اصلی: تخته سفید (در صورت فعال بودن) > اشتراک صفحه > دوربین معلم */}
            {wboardActive ? (
              <Whiteboard
                ops={wboardOps}
                readOnly
                onCommit={() => {}}
                className="flex-1 min-h-40"
              />
            ) : screenSharer ? (
              <div className="flex-1 min-h-40">
                <VideoTile
                  name={screenSharer.name}
                  role={screenSharer.role}
                  stream={remoteStreams[screenSharer.userId]?.screen ?? null}
                  showVideo={!!remoteStreams[screenSharer.userId]?.screen}
                  micOn={false}
                  sharing
                  streamKind="screen"
                  className="h-full"
                />
              </div>
            ) : (
              <div className="flex-1 min-h-40">
                <VideoTile
                  name={hostP?.name ?? 'معلم'}
                  role={hostP?.role ?? 'TEACHER'}
                  isHost
                  stream={hostP ? remoteStreams[hostP.userId]?.camera ?? null : null}
                  showVideo={!!hostP?.camOn && !!(hostP && remoteStreams[hostP.userId]?.camera)}
                  micOn={!!hostP?.micOn}
                  mutedByTeacher={hostP?.mutedByTeacher}
                  className="h-full"
                />
              </div>
            )}
            {/* نوار پایین: خودم + دوربین معلم (وقتی تخته/اشتراک فعال است) */}
            <div
              className={cn(
                'grid gap-3 shrink-0',
                (wboardActive || screenSharer) && hostP ? 'grid-cols-2 max-w-md mx-auto w-full' : 'grid-cols-1 max-w-[220px] ms-auto w-full',
              )}
            >
              {(wboardActive || screenSharer) && hostP && (
                <VideoTile
                  name={hostP.name}
                  role={hostP.role}
                  isHost
                  stream={remoteStreams[hostP.userId]?.camera ?? null}
                  showVideo={hostP.camOn && !!remoteStreams[hostP.userId]?.camera}
                  micOn={hostP.micOn}
                  mutedByTeacher={hostP.mutedByTeacher}
                  className="min-h-24"
                />
              )}
              <VideoTile
                name={me.fullName + ' (شما)'}
                role={me.role}
                isSelf
                stream={camStreamRef.current ?? null}
                showVideo={camOn}
                micOn={micOn}
                mutedByTeacher={selfPerms.mutedByTeacher}
                className="min-h-24"
              />
            </div>
            {/* صدای بقیه بدون کاشی ویدیو — گفتار هم‌کلاسی‌های دارای اجازه شنیده می‌شود */}
            {others.map((p) => (
              <RemoteAudio key={p.userId} stream={remoteStreams[p.userId]?.mic ?? null} />
            ))}
          </div>
        ) : (
        <div className="flex-1 min-w-0 overflow-y-auto p-3 space-y-3">
          {/* تخته سفید معلم — بالای صحنه تا همه ببینند */}
          {wboardActive && (
            <Whiteboard
              ops={wboardOps}
              readOnly={!isHost}
              onCommit={isHost ? commitWbOp : () => {}}
              onClose={isHost ? () => toggleWboard() : undefined}
              className="h-[52vh] shrink-0"
            />
          )}
          {screenSharer && (
            <VideoTile
              name={screenSharer.name}
              role={screenSharer.role}
              stream={remoteStreams[screenSharer.userId]?.screen ?? null}
              showVideo={!!remoteStreams[screenSharer.userId]?.screen}
              micOn={false}
              sharing
              streamKind="screen"
            />
          )}
          <div
            className={cn(
              'grid gap-3',
              participants.length <= 1
                ? 'grid-cols-1 max-w-2xl mx-auto'
                : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
            )}
          >
            {/* تصویر خودم */}
            <VideoTile
              name={me.fullName + ' (شما)'}
              role={me.role}
              isSelf
              isHost={hostId === me.id}
              stream={camStreamRef.current ?? null}
              showVideo={camOn}
              micOn={micOn}
              mutedByTeacher={selfPerms.mutedByTeacher}
              handRaised={handRaised}
              sharing={sharing}
            />
            {others.map((p) => (
              <div key={p.userId}>
                <VideoTile
                  name={p.name}
                  role={p.role}
                  isHost={p.userId === hostId}
                  stream={remoteStreams[p.userId]?.camera ?? null}
                  showVideo={p.camOn && !!remoteStreams[p.userId]?.camera}
                  micOn={p.micOn}
                  mutedByTeacher={p.mutedByTeacher}
                  handRaised={p.handRaised}
                  sharing={p.sharing}
                />
                <RemoteAudio stream={remoteStreams[p.userId]?.mic ?? null} />
              </div>
            ))}
          </div>
        </div>
        )}

        {/* پنل کناری دسکتاپ */}
        <aside className="hidden lg:flex flex-col w-80 shrink-0 border-s">
          <div className="flex border-b">
            <button
              onClick={() => setPanel('people')}
              className={cn(
                'flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5',
                panel !== 'chat' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground',
              )}
            >
              <Users className="h-4 w-4" />
              شرکت‌کنندگان ({faNumSafe(participants.length)})
            </button>
            <button
              onClick={() => setPanel('chat')}
              className={cn(
                'flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5',
                panel === 'chat' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground',
              )}
            >
              <MessageSquare className="h-4 w-4" />
              گفتگو
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {panel === 'chat' ? (
              <ChatPanel
                chat={chat}
                meId={me.id}
                chatInput={chatInput}
                setChatInput={setChatInput}
                onSend={sendChat}
                endRef={chatEndRef}
              />
            ) : (
              <PeoplePanel
                participants={participants}
                hostId={hostId}
                meId={me.id}
                isHost={!!isHost}
                raisedHands={raisedHands}
                hostAction={hostAction}
              />
            )}
          </div>
        </aside>
      </div>

      {/* نوار کنترل */}
      <footer className="shrink-0 border-t px-3 py-2.5 flex items-center justify-center gap-2 sm:gap-3">
        <ControlBtn
          onClick={toggleMic}
          active={micOn}
          busy={micBusy}
          danger={selfPerms.mutedByTeacher}
          label={
            micBusy
              ? 'در حال دسترسی به میکروفون…'
              : micOn
                ? 'خاموش‌کردن میکروفون'
                : selfPerms.mutedByTeacher
                  ? 'میکروفون توسط معلم بسته شده'
                  : 'روشن‌کردن میکروفون'
          }
        >
          {micBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </ControlBtn>
        <ControlBtn
          onClick={toggleCam}
          active={camOn}
          busy={camBusy}
          label={
            camBusy
              ? 'در حال دسترسی به دوربین…'
              : camLocked
                ? 'روشن‌کردن دوربین — نیاز به اجازه معلم'
                : camOn
                  ? 'خاموش‌کردن دوربین'
                  : 'روشن‌کردن دوربین'
          }
        >
          <span className="relative inline-flex">
            {camBusy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : camOn ? (
              <Video className="h-5 w-5" />
            ) : (
              <VideoOff className="h-5 w-5" />
            )}
            {camLocked && !camBusy && (
              <span className="absolute -top-1.5 -end-1.5 h-3 w-3 rounded-full bg-amber-500 text-white flex items-center justify-center">
                <Lock className="h-2 w-2" strokeWidth={3} />
              </span>
            )}
          </span>
        </ControlBtn>
        <ControlBtn
          onClick={toggleShare}
          active={sharing}
          label={sharing ? 'پایان اشتراک صفحه' : 'اشتراک‌گذاری صفحه'}
        >
          <MonitorUp className="h-5 w-5" />
        </ControlBtn>
        {me.role === 'STUDENT' && (
          <ControlBtn
            onClick={toggleHand}
            active={handRaised}
            amber
            label={handRaised ? 'لغو درخواست صحبت' : 'بالا بردن دست (درخواست صحبت)'}
          >
            <Hand className="h-5 w-5" />
          </ControlBtn>
        )}
        {/* تخته سفید — فقط معلم میزبان */}
        {isHost && (
          <ControlBtn
            onClick={toggleWboard}
            active={wboardActive}
            label={wboardActive ? 'بستن تخته سفید' : 'تخته سفید'}
          >
            <Presentation className="h-5 w-5" />
          </ControlBtn>
        )}
        <span className="lg:hidden flex gap-2">
          <ControlBtn
            onClick={() => setMobilePanel('people')}
            label="شرکت‌کنندگان"
          >
            <Users className="h-5 w-5" />
          </ControlBtn>
          <ControlBtn onClick={() => setMobilePanel('chat')} label="گفتگو">
            <MessageSquare className="h-5 w-5" />
          </ControlBtn>
        </span>
        {/* حالت کم‌مصرف — کیفیت تطبیقی برای اینترنت ضعیف (همه نقش‌ها) */}
        <ControlBtn
          onClick={toggleLowData}
          active={lowData}
          label={lowData ? 'حالت کم‌مصرف روشن است (برای خاموش‌کردن کلیک کنید)' : 'حالت کم‌مصرف — مناسب اینترنت ضعیف'}
        >
          {lowData ? <SignalLow className="h-5 w-5" /> : <SignalHigh className="h-5 w-5" />}
        </ControlBtn>
        <ControlBtn onClick={leaveRoom} danger label="خروج از جلسه">
          <PhoneOff className="h-5 w-5" />
        </ControlBtn>
      </footer>

      {/* پنل موبایل */}
      <Dialog open={mobilePanel !== 'none'} onOpenChange={(o) => !o && setMobilePanel('none')}>
        <DialogContent className="h-[80dvh] flex flex-col p-0 max-w-md">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="text-sm flex items-center gap-2">
              {mobilePanel === 'chat' ? (
                <>
                  <MessageSquare className="h-4 w-4" /> گفتگوی جلسه
                </>
              ) : (
                <>
                  <Users className="h-4 w-4" /> شرکت‌کنندگان ({faNumSafe(participants.length)})
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {mobilePanel === 'chat' ? (
              <ChatPanel
                chat={chat}
                meId={me.id}
                chatInput={chatInput}
                setChatInput={setChatInput}
                onSend={sendChat}
                endRef={chatEndRef}
              />
            ) : (
              <PeoplePanel
                participants={participants}
                hostId={hostId}
                meId={me.id}
                isHost={!!isHost}
                raisedHands={raisedHands}
                hostAction={hostAction}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* تأیید پایان جلسه */}
      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>پایان جلسه؟</AlertDialogTitle>
            <AlertDialogDescription>
              با پایان جلسه، اتصال همه شرکت‌کنندگان قطع می‌شود و دکمه پیام دعوت در گروه به
              «جلسه پایان یافته» تغییر می‌کند. این عمل بازگشت‌پذیر نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={endSession}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              پایان جلسه
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── زیرکامپوننت‌ها ───

function ControlBtn({
  children,
  onClick,
  active,
  danger,
  amber,
  busy,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  danger?: boolean
  amber?: boolean
  busy?: boolean
  label: string
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={busy}
      className={cn(
        'h-11 w-11 rounded-full flex items-center justify-center transition-colors border',
        busy
          ? 'bg-muted text-muted-foreground border-border cursor-progress'
          : danger
            ? 'bg-red-500 text-white border-red-500 hover:bg-red-600'
            : active
              ? amber
                ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                : 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
              : 'bg-muted text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

function ChatPanel({
  chat,
  meId,
  chatInput,
  setChatInput,
  onSend,
  endRef,
}: {
  chat: ChatItem[]
  meId: string
  chatInput: string
  setChatInput: (v: string) => void
  onSend: () => void
  endRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        <p className="text-[11px] text-muted-foreground text-center">
          گفتگوی این جلسه جدا از گروه عمومی است و فقط برای حاضرین همین جلسه نمایش داده می‌شود.
        </p>
        {chat.map((m) => {
          const mine = m.senderId === meId
          return (
            <div key={m.id} className={cn('flex', mine ? 'justify-start' : 'justify-end')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-xl px-3 py-1.5 text-sm',
                  mine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm',
                )}
              >
                {!mine && (
                  <div className="text-[10.5px] font-bold opacity-80 mb-0.5">
                    {m.senderName}
                    <span className="font-normal opacity-70"> — {roleLabel(m.senderRole)}</span>
                  </div>
                )}
                <p className="whitespace-pre-wrap break-words leading-6">{m.body}</p>
                <div className="text-[10px] opacity-60 text-end">{chatClock(m.createdAt)}</div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
      <div className="p-2.5 border-t flex gap-2">
        <Input
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && onSend()}
          placeholder="پیام به جلسه…"
          maxLength={2000}
        />
        <Button size="sm" onClick={onSend} disabled={!chatInput.trim()}>
          ارسال
        </Button>
      </div>
    </div>
  )
}

function PeoplePanel({
  participants,
  hostId,
  meId,
  isHost,
  raisedHands,
  hostAction,
}: {
  participants: ParticipantView[]
  hostId: string | null
  meId: string
  isHost: boolean
  raisedHands: ParticipantView[]
  hostAction: (event: string, payload: Record<string, unknown>) => void
}) {
  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      {isHost && raisedHands.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
          <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400 mb-1.5 flex items-center gap-1.5">
            <Hand className="h-3.5 w-3.5" />
            درخواست‌های صحبت ({faNumSafe(raisedHands.length)})
          </div>
          {raisedHands.map((p) => (
            <div key={p.userId} className="flex items-center gap-2 py-1">
              <span className="text-xs font-medium truncate flex-1">{p.name}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => hostAction('live:permit', { userId: p.userId, canSpeak: true })}
              >
                اجازه صحبت
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {participants.map((p) => {
          const isHostRow = p.userId === hostId
          return (
            <div key={p.userId} className="rounded-lg border bg-card/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                  {p.name.trim().charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate">
                    {p.name}
                    {p.userId === meId && <span className="opacity-60"> (شما)</span>}
                    {isHostRow && <span className="ms-1 text-[10px] text-amber-600">(میزبان)</span>}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground">
                    {roleLabel(p.role)}
                    {p.sharing && ' — در حال اشتراک صفحه'}
                    {p.handRaised && ' — دست بالا'}
                  </div>
                </div>
                {p.micOn ? (
                  <Mic className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <MicOff className={cn('h-3.5 w-3.5 shrink-0', p.mutedByTeacher ? 'text-red-400' : 'text-muted-foreground')} />
                )}
              </div>

              {/* ابزارهای معلم */}
              {isHost && !isHostRow && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
                  <MiniAction
                    onClick={() =>
                      hostAction('live:mute-target', { userId: p.userId, unmute: p.mutedByTeacher })
                    }
                  >
                    {p.mutedByTeacher ? 'رفع سکوت' : 'بستن میکروفون'}
                  </MiniAction>
                  <MiniAction
                    onClick={() =>
                      hostAction('live:permit', { userId: p.userId, canSpeak: !p.canSpeak })
                    }
                    active={p.canSpeak}
                  >
                    {p.canSpeak ? 'قطع اجازه صحبت' : 'اجازه صحبت'}
                  </MiniAction>
                  <MiniAction
                    onClick={() =>
                      hostAction('live:permit', { userId: p.userId, canShare: !p.canShare })
                    }
                    active={p.canShare}
                  >
                    {p.canShare ? 'قطع اجازه اشتراک' : 'اجازه اشتراک صفحه'}
                  </MiniAction>
                  <MiniAction
                    onClick={() =>
                      hostAction('live:permit', { userId: p.userId, canCam: !p.canCam })
                    }
                    active={p.canCam}
                  >
                    {p.canCam ? 'قطع اجازه دوربین' : 'اجازه دوربین'}
                  </MiniAction>
                  <MiniAction
                    danger
                    onClick={() => hostAction('live:kick', { userId: p.userId })}
                  >
                    اخراج از جلسه
                  </MiniAction>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MiniAction({
  children,
  onClick,
  danger,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 text-[10.5px] font-medium transition-colors',
        danger
          ? 'border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10'
          : active
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function FullState({
  icon,
  title,
  msg,
  backLabel,
  retry,
}: {
  icon: React.ReactNode
  title: string
  msg: string
  backLabel: string
  /** نمایش دکمه «تلاش مجدد» — بارگذاری مجدد کامل صفحه (ورود تازه به جلسه) */
  retry?: boolean
}) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="flex justify-center mb-3">{icon}</div>
        <h2 className="font-bold text-lg mb-1.5">{title}</h2>
        <p className="text-sm text-muted-foreground leading-6 mb-5">{msg}</p>
        <div className="flex items-center justify-center gap-2">
          {retry && (
            <Button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold"
            >
              <RefreshCw className="h-4 w-4" />
              تلاش مجدد
            </Button>
          )}
          <Link
            href="/live"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
          >
            <ChevronLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}

function faNumSafe(n: number | string): string {
  try {
    return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
  } catch {
    return String(n)
  }
}

