'use client'

/**
 * بررسی‌های «مرورگر مدیر کل» — جدا از بررسی‌های بک‌اند.
 *
 * اصول صادقانه:
 * - هر آزمون فقط با اقدام مدیر اجرا می‌شود (سبک‌ترین حالت هم دکمه دارد)
 * - نتیجه فقط وضعیت «همین مرورگر و همین شبکه» است — سلامت اتصال همه کاربران نیست
 * - موفقیت HTTP/توکن هرگز «موفقیت انتقال رسانه» اعلام نمی‌شود؛ سیگنالینگ،
 *   WebRTC، انتشار و دریافت رسانه جدا گزارش می‌شوند و اجرانشده‌ها صریح‌اند
 * - آزمون دستگاه واقعی فقط با مجوز کاربر؛ رسانه مصنوعی برچسب واضح دارد
 * - اتاق/ترک‌های آزمایشی پس از پایان/خطا/خروج پاک می‌شوند و هیچ اعلان کلاس
 *   یا حضورغیابی ایجاد نمی‌کنند
 */

import { useCallback, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Loader2, MessagesSquare, RadioTower, Video, Info } from 'lucide-react'
import { describeSocketError } from '@/components/messenger/socket-client'
import { alignSignalUrl } from '@/lib/livekit-signal-url'
import { fmtTime } from './infra-shared'

// ─────────────────────────── آزمون پیام‌رسان ───────────────────────────

interface SocketEchoResult {
  status: 'ok' | 'error' | 'running'
  stage?: 'connect' | 'echo'
  message?: string
  connectMs?: number
  rttMs?: number
  transport?: string
  at?: number
}

function SocketEchoTest() {
  const [result, setResult] = useState<SocketEchoResult | null>(null)

  const run = useCallback(async () => {
    setResult({ status: 'running' })
    const { io } = await import('socket.io-client')
    const SOCKET_URL =
      process.env.NEXT_PUBLIC_SOCKET_URL ??
      (process.env.NODE_ENV === 'production' ? '/' : '/?XTransformPort=3003')
    const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH ?? '/socket.io'

    await new Promise<void>((resolve) => {
      const s = io(SOCKET_URL, {
        path: SOCKET_PATH,
        transports: ['polling', 'websocket'],
        withCredentials: true,
        reconnection: false,
        timeout: 8000,
      })
      let settled = false
      const finish = (r: SocketEchoResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          s.disconnect()
        } catch {
          /* بسته شده */
        }
        setResult({ ...r, at: Date.now() })
        resolve()
      }
      const timer = setTimeout(
        () =>
          finish({
            status: 'error',
            stage: 'connect',
            message: 'اتصال به سرویس پیام‌رسان در مهلت مقرر برقرار نشد',
          }),
        14000,
      )
      const t0 = performance.now()
      s.on('connect', () => {
        const connectMs = Math.round(performance.now() - t0)
        const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36)
        const te0 = performance.now()
        s.timeout(6000).emit(
          'diag:echo',
          { nonce },
          (err: unknown, res: { ok?: boolean; nonce?: string; diag?: boolean }) => {
            if (err) {
              finish({
                status: 'error',
                stage: 'echo',
                message: 'پیام تشخیصی ارسال شد اما پاسخ رفت‌وبرگشت دریافت نشد',
                connectMs,
              })
              return
            }
            if (res?.ok === true && res.nonce === nonce && res.diag === true) {
              finish({
                status: 'ok',
                connectMs,
                rttMs: Math.round(performance.now() - te0),
                transport: s.io.engine?.transport?.name,
              })
            } else {
              finish({
                status: 'error',
                stage: 'echo',
                message: 'پاسخ پیام تشخیصی نامعتبر بود',
                connectMs,
              })
            }
          },
        )
      })
      s.on('connect_error', (e: Error) => {
        finish({
          status: 'error',
          stage: 'connect',
          message: describeSocketError(e?.message ?? ''),
        })
      })
    })
  }, [])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessagesSquare className="h-4.5 w-4.5 text-primary" />
          پیام‌رسان — اتصال و رفت‌وبرگشت پیام
        </CardTitle>
        <CardDescription>
          اتصال احراز هویت‌شده (همان کوکی نشست) + پیام تشخیصی اختصاصی با کد یکتا؛ هیچ پیامی در گروه‌های واقعی ارسال نمی‌شود.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={result?.status === 'running'} size="sm">
          {result?.status === 'running' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> در حال آزمون…
            </>
          ) : (
            'آزمون پیام‌رسان'
          )}
        </Button>
        {result && result.status !== 'running' ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1.5">
            {result.status === 'ok' ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">اتصال احراز هویت‌شده</span>
                  <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400 border-emerald-500/40">
                    برقرار
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">رفت‌وبرگشت پیام تشخیصی</span>
                  <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400 border-emerald-500/40">
                    تأیید شد
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>برقراری اتصال: {result.connectMs ?? '—'} م‌ث — رفت‌وبرگشت: {result.rttMs ?? '—'} م‌ث</span>
                  <span>{result.transport === 'websocket' ? 'WebSocket' : result.transport ?? '—'}</span>
                </div>
              </>
            ) : (
              <div className="text-red-700 dark:text-red-400">
                <div className="font-medium">
                  {result.stage === 'connect' ? 'اتصال برقرار نشد' : 'پیام تشخیصی موفق نبود'}
                </div>
                <div className="text-xs mt-0.5">{result.message}</div>
              </div>
            )}
            {result.at ? <div className="text-[11px] text-muted-foreground">{fmtTime(result.at)}</div> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────── آزمون TURN (relay واقعی) ───────────────────────────

interface TurnTestResult {
  status: 'ok' | 'error' | 'not_configured' | 'running'
  message?: string
  connectionOk?: boolean
  usedRelay?: boolean
  localCandidateType?: string
  remoteCandidateType?: string
  relayCandidates?: number
  at?: number
}

interface IceServerLike {
  urls: string | string[]
  username?: string
  credential?: string
}

function TurnRelayTest() {
  const [result, setResult] = useState<TurnTestResult | null>(null)

  const run = useCallback(async () => {
    setResult({ status: 'running' })
    try {
      const cfgRes = await fetch('/api/superadmin/infrastructure/turn-config', { cache: 'no-store' })
      if (!cfgRes.ok) {
        setResult({ status: 'error', message: 'دریافت تنظیمات TURN از سرور ناموفق بود', at: Date.now() })
        return
      }
      const cfg = (await cfgRes.json()) as { configured: boolean; iceServers?: IceServerLike[] }
      if (!cfg.configured || !cfg.iceServers?.length) {
        setResult({
          status: 'not_configured',
          message: 'TURN در تنظیمات سرور ثبت نشده — آزمون relay ممکن نیست (اختیاری است)',
          at: Date.now(),
        })
        return
      }

      // فقط سرورهای TURN (بدون STUN) + سیاست iceTransportPolicy=relay →
      // یگانه مسیر ممکن relay است؛ اتصال یعنی «مسیر relay واقعاً انتخاب شد»
      const turnOnly: RTCIceServer[] = cfg.iceServers
        .map((s) => ({
          urls: Array.isArray(s.urls) ? s.urls : [s.urls],
          username: s.username,
          credential: s.credential,
        }))
        .map((s) => ({ ...s, urls: s.urls.filter((u) => /^turn/i.test(u)) }))
        .filter((s) => s.urls.length > 0)

      if (turnOnly.length === 0) {
        setResult({
          status: 'not_configured',
          message: 'در تنظیمات ICE سرور TURNی نیست (فقط STUN) — آزمون relay انجام نمی‌شود',
          at: Date.now(),
        })
        return
      }

      const r = await runRelayLoopback(turnOnly)
      setResult({
        ...r,
        status: r.connectionOk && r.usedRelay ? 'ok' : 'error',
        at: Date.now(),
      })
    } catch (e) {
      setResult({
        status: 'error',
        message: e instanceof Error ? `آزمون TURN ناموفق بود: ${e.message.slice(0, 120)}` : 'آزمون TURN ناموفق بود',
        at: Date.now(),
      })
    }
  }, [])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <RadioTower className="h-4.5 w-4.5 text-primary" />
          TURN — آزمون واقعی مسیر relay
        </CardTitle>
        <CardDescription>
          دو اتصال هم‌تا در همین مرورگر با «فقط» سرور TURN و سیاست relay؛ موفقیت یعنی تخصیص و انتخاب واقعی مسیر رله — نه صرف وجود تنظیمات.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={result?.status === 'running'} size="sm" variant="outline">
          {result?.status === 'running' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> در حال آزمون…
            </>
          ) : (
            'آزمون مسیر relay'
          )}
        </Button>
        {result && result.status !== 'running' ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1.5">
            {result.status === 'ok' && result.connectionOk && result.usedRelay ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">اتصال از مسیر TURN</span>
                  <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400 border-emerald-500/40">
                    relay واقعی
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  کاندید منتخب محلی: {result.localCandidateType ?? '—'} — قرینه: {result.remoteCandidateType ?? '—'} —
                  کاندیدهای relay تخصیص‌یافته: {result.relayCandidates ?? '—'}
                </div>
              </>
            ) : result.status === 'not_configured' ? (
              <div className="text-muted-foreground text-xs">{result.message}</div>
            ) : (
              <div className="text-red-700 dark:text-red-400">
                <div className="font-medium">مسیر relay کار نکرد</div>
                <div className="text-xs mt-0.5">
                  {result.message ??
                    'اتصال از مسیر TURN برقرار نشد — کاندید relay تخصیص یا انتخاب نشد'}
                </div>
                {result.relayCandidates !== undefined && result.relayCandidates > 0 ? (
                  <div className="text-xs mt-0.5">
                    کاندید relay تخصیص یافت ({result.relayCandidates}) اما اتصال نهایی نشد
                  </div>
                ) : null}
              </div>
            )}
            {result.at ? <div className="text-[11px] text-muted-foreground">{fmtTime(result.at)}</div> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** خواندن نوع کاندیدهای جفتِ منتخب — اول از transport.selectedCandidatePairId،
 * بعد جفت nominated/succeeded — سازگار با کروم/فایرفاکس */
async function readSelectedPairTypes(
  pc: RTCPeerConnection,
): Promise<{ local?: string; remote?: string }> {
  const stats = await pc.getStats()
  const candidates = new Map<string, { candidateType?: string }>()
  const pairs = new Map<string, { nominated?: boolean; state?: string; localCandidateId?: string; remoteCandidateId?: string }>()
  let transportPairId: string | undefined
  let flaggedPairId: string | undefined
  let succeededPairId: string | undefined
  stats.forEach((r) => {
    if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
      candidates.set(r.id, r as { candidateType?: string })
    } else if (r.type === 'candidate-pair') {
      const pair = r as unknown as {
        id: string
        nominated?: boolean
        state?: string
        selected?: boolean
        localCandidateId?: string
        remoteCandidateId?: string
      }
      pairs.set(pair.id, pair)
      if (pair.selected === true) flaggedPairId = pair.id
      else if (pair.nominated === true && pair.state === 'succeeded') flaggedPairId ??= pair.id
      else if (pair.state === 'succeeded') succeededPairId ??= pair.id
    } else if (r.type === 'transport') {
      const t = r as unknown as { selectedCandidatePairId?: string }
      if (t.selectedCandidatePairId) transportPairId = t.selectedCandidatePairId
    }
  })
  const pairId = transportPairId ?? flaggedPairId ?? succeededPairId
  const pair = pairId ? pairs.get(pairId) : undefined
  if (!pair) return {}
  return {
    local: candidates.get(pair.localCandidateId ?? '')?.candidateType,
    remote: candidates.get(pair.remoteCandidateId ?? '')?.candidateType,
  }
}

/** دو RTCPeerConnection لوکال با فقط TURN — تعویض SDP/ICE و بررسی جفت منتخب */
async function runRelayLoopback(
  turnOnly: RTCIceServer[],
): Promise<Omit<TurnTestResult, 'at' | 'status'>> {
  const pcs: RTCPeerConnection[] = []
  let relayCandidates = 0
  try {
    const mk = () =>
      new RTCPeerConnection({ iceServers: turnOnly, iceTransportPolicy: 'relay' } as RTCConfiguration)
    const pc1 = mk()
    const pc2 = mk()
    pcs.push(pc1, pc2)

    pc1.addEventListener('icecandidate', (e) => {
      if (e.candidate) {
        if (e.candidate.type === 'relay') relayCandidates++
        pc2.addIceCandidate(e.candidate).catch(() => undefined)
      }
    })
    pc2.addEventListener('icecandidate', (e) => {
      if (e.candidate) {
        if (e.candidate.type === 'relay') relayCandidates++
        pc1.addIceCandidate(e.candidate).catch(() => undefined)
      }
    })
    const dc = pc1.createDataChannel('infra-diag')
    const dcOpen = new Promise<void>((resolve) => {
      dc.onopen = () => resolve()
    })
    const pc2Connected = new Promise<void>((resolve) => {
      pc2.addEventListener('connectionstatechange', () => {
        if (pc2.connectionState === 'connected') resolve()
      })
    })

    const offer = await pc1.createOffer()
    await pc1.setLocalDescription(offer)
    await pc2.setRemoteDescription(offer)
    const answer = await pc2.createAnswer()
    await pc2.setLocalDescription(answer)
    await pc1.setRemoteDescription(answer)

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 12000),
    )
    await Promise.race([Promise.all([dcOpen, pc2Connected]), timeout])

    // بررسی جفت کاندید «منتخب» — مسیر واقعیِ انتخاب‌شده؛ با تلاش مجدد کوتاه
    // چون پر شدن کامل گزارش‌های stats می‌تواند چند صد میلی‌ثانیه طول بکشد
    let localCandidateType: string | undefined
    let remoteCandidateType: string | undefined
    for (let attempt = 0; attempt < 3 && localCandidateType === undefined; attempt++) {
      const found = await readSelectedPairTypes(pc1)
      localCandidateType = found.local
      remoteCandidateType = found.remote
      if (localCandidateType === undefined) await new Promise((r2) => setTimeout(r2, 350))
    }

    const usedRelay = localCandidateType === 'relay' || remoteCandidateType === 'relay'
    return {
      connectionOk: true,
      usedRelay,
      localCandidateType,
      remoteCandidateType,
      relayCandidates,
      message: usedRelay
        ? undefined
        : `اتصال برقرار شد اما جفت منتخب relay نیست (محلی: ${localCandidateType ?? 'نامشخص'})`,
    }
  } catch (e) {
    return {
      connectionOk: false,
      relayCandidates,
      message:
        e instanceof Error && e.message === 'timeout'
          ? 'اتصال در مهلت ۱۲ ثانیه برقرار نشد — تخصیص یا انتخاب مسیر relay ناموفق'
          : `خطای آزمون: ${e instanceof Error ? e.message.slice(0, 100) : 'نامشخص'}`,
    }
  } finally {
    for (const pc of pcs) {
      try {
        pc.close()
      } catch {
        /* بسته */
      }
    }
  }
}

// ─────────────────────────── آزمون رسانه LiveKit ───────────────────────────

type StageState = 'ok' | 'failed' | 'skipped' | 'not_verified'

interface MediaTestResult {
  signaling: StageState
  signalingDetail?: string
  webrtc: StageState
  webrtcDetail?: string
  publish: StageState
  publishDetail?: string
  receive: StageState
  receiveDetail?: string
  cleanup: 'ok' | 'fallback' | 'failed'
  cleanupDetail?: string
  mediaKind: 'real' | 'artificial'
  mediaLabel: string
  at?: number
}

function StageRow({ label, state, detail }: { label: string; state: StageState; detail?: string }) {
  const meta: Record<StageState, { text: string; cls: string }> = {
    ok: { text: 'تأیید شد', cls: 'text-emerald-700 dark:text-emerald-400 border-emerald-500/40' },
    failed: { text: 'ناموفق', cls: 'text-red-700 dark:text-red-400 border-red-500/40' },
    skipped: { text: 'اجرا نشد', cls: 'text-neutral-500 border-neutral-500/30' },
    not_verified: { text: 'تأیید نشده', cls: 'text-amber-700 dark:text-amber-400 border-amber-500/40' },
  }
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <Badge variant="outline" className={meta[state].cls}>
          {meta[state].text}
        </Badge>
      </div>
      {detail ? <div className="text-xs text-muted-foreground pr-1">{detail}</div> : null}
    </div>
  )
}

function LiveKitMediaTest() {
  const [mode, setMode] = useState<'artificial' | 'real'>('artificial')
  const [running, setRunning] = useState(false)
  const [liveStatus, setLiveStatus] = useState<string | null>(null)
  const [result, setResult] = useState<MediaTestResult | null>(null)
  const runningRef = useRef(false)

  const run = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setResult(null)
    setLiveStatus('درخواست اتاق تشخیصی…')
    let testId: string | null = null
    let endCalled = false
    try {
      const startRes = await fetch('/api/superadmin/infrastructure/live-test/start', { method: 'POST' })
      if (!startRes.ok) {
        const d = (await startRes.json().catch(() => null)) as { error?: string } | null
        setResult({
          signaling: 'failed',
          signalingDetail: d?.error ?? 'دریافت اتاق/توکن تشخیصی ناموفق بود',
          webrtc: 'skipped',
          publish: 'skipped',
          receive: 'skipped',
          cleanup: 'ok',
          cleanupDetail: 'اتاقی ساخته نشد',
          mediaKind: mode,
          mediaLabel: mode === 'real' ? 'دستگاه واقعی (با مجوز)' : 'رسانه مصنوعی',
          at: Date.now(),
        })
        return
      }
      const st = (await startRes.json()) as {
        testId: string
        room: string
        token: string
        url: string
        iceServers: IceServerLike[]
      }
      testId = st.testId
      const endTest = async () => {
        if (endCalled || !testId) return { cleaned: false, fallback: null as string | null }
        endCalled = true
        try {
          const r = await fetch('/api/superadmin/infrastructure/live-test/end', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ testId }),
          })
          const d = (await r.json().catch(() => null)) as {
            cleaned?: boolean
            fallback?: string | null
          } | null
          return { cleaned: !!d?.cleaned, fallback: d?.fallback ?? null }
        } catch {
          return { cleaned: false, fallback: 'اتاق تشخیصی حداکثر ۹۰ ثانیه بعد خودکار حذف می‌شود' }
        }
      }

      const { Room, RoomEvent, createLocalTracks, Track } = await import('livekit-client')
      const room = new Room({ adaptiveStream: false, dynacast: false })
      let quality: string | null = null
      let publishedCount = 0
      let receivedCount = 0
      room.on(RoomEvent.ConnectionQualityChanged, (q) => {
        quality = String(q)
      })
      room.on(RoomEvent.LocalTrackPublished, () => {
        publishedCount++
      })
      room.on(RoomEvent.TrackSubscribed, () => {
        receivedCount++
      })

      // ۱) سیگنالینگ + اتصال WebRTC (SFU)
      setLiveStatus('اتصال به سرور رسانه…')
      let signalingState: StageState = 'ok'
      let signalingDetail: string | undefined
      let webrtcState: StageState = 'ok'
      let webrtcDetail: string | undefined
      try {
        const connectOpts =
          st.iceServers && st.iceServers.length
            ? { rtcConfig: { iceServers: st.iceServers as RTCIceServer[] } }
            : {}
        await withTimeoutMs(
          room.connect(alignSignalUrl(st.url), st.token, connectOpts),
          20000,
          'اتصال به سرور رسانه بیش از حد طول کشید',
        )
        if (room.state !== 'connected') throw new Error('اتصال پس از سیگنالینگ تکمیل نشد')
        signalingDetail = 'ورود به اتاق تشخیصی موفق بود'
        webrtcDetail = quality ? `کیفیت اتصال: ${quality}` : 'کانال رسانه برقرار شد'
      } catch (e) {
        signalingState = 'failed'
        signalingDetail = e instanceof Error ? e.message.slice(0, 140) : 'اتصال ناموفق'
        webrtcState = 'skipped'
        const cleanupRes = await endTest()
        setResult({
          signaling: signalingState,
          signalingDetail,
          webrtc: webrtcState,
          publish: 'skipped',
          receive: 'skipped',
          cleanup: cleanupRes.cleaned ? 'ok' : 'fallback',
          cleanupDetail: cleanupRes.fallback ?? undefined,
          mediaKind: mode,
          mediaLabel: mode === 'real' ? 'دستگاه واقعی (با مجوز)' : 'رسانه مصنوعی',
          at: Date.now(),
        })
        return
      }

      // ۲) انتشار رسانه — واقعی (با مجوز کاربر) یا مصنوعی (برچسب واضح)
      setLiveStatus('انتشار رسانه آزمایشی…')
      let publishState: StageState = 'ok'
      let publishDetail: string | undefined
      const localTracksToStop: { stop: () => void }[] = []
      let audioCtx: AudioContext | null = null
      let raf = 0
      try {
        if (mode === 'real') {
          const tracks = await withTimeoutMs(
            createLocalTracks({ audio: true, video: true }),
            15000,
            'دریافت مجوز/دستگاه بیش از حد طول کشید',
          )
          for (const t of tracks) {
            localTracksToStop.push(t)
            await room.localParticipant.publishTrack(t, {
              name: `diag-real-${t.kind}`,
            })
          }
          publishDetail = `${publishedCount} ترک از دستگاه واقعی (میکروفون/دوربین) منتشر شد`
        } else {
          // رسانه مصنوعی: canvas + اسیلاتور صوتی — بدون هیچ دستگاه/مجوزی
          const canvas = document.createElement('canvas')
          canvas.width = 160
          canvas.height = 120
          const ctx = canvas.getContext('2d')
          const draw = () => {
            if (!ctx) return
            ctx.fillStyle = '#0f766e'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.fillStyle = '#ffffff'
            ctx.font = '10px sans-serif'
            ctx.fillText(new Date().toISOString().slice(11, 19), 12, 64)
            raf = requestAnimationFrame(draw)
          }
          draw()
          const vStream = canvas.captureStream(4)
          const vTrack = vStream.getVideoTracks()[0]
          audioCtx = new AudioContext()
          const osc = audioCtx.createOscillator()
          const dest = audioCtx.createMediaStreamDestination()
          osc.frequency.value = 440
          osc.connect(dest)
          osc.start()
          const aTrack = dest.stream.getAudioTracks()[0]
          await room.localParticipant.publishTrack(vTrack, {
            name: 'diag-artificial-video',
            source: Track.Source.Camera,
          })
          await room.localParticipant.publishTrack(aTrack, {
            name: 'diag-artificial-audio',
            source: Track.Source.Microphone,
          })
          publishDetail = `${publishedCount} ترک «مصنوعی» (پرده + تن صوتی) منتشر شد — بدون دستگاه واقعی`
        }
        if (publishedCount === 0) {
          publishState = 'failed'
          publishDetail = 'هیچ ترکی تأیید انتشار نشد'
        }
      } catch (e) {
        publishState = 'failed'
        publishDetail =
          e instanceof Error
            ? /Permission|NotAllowed/i.test(e.name + e.message)
              ? 'مجوز دسترسی به میکروفون/دوربین داده نشد'
              : e.message.slice(0, 140)
            : 'انتشار رسانه ناموفق بود'
      } finally {
        // خاموش‌سازی فوری منابع محلی — دستگاه/اصلاتور بی‌مورد روشن نمی‌ماند
        for (const t of localTracksToStop) {
          try {
            t.stop()
          } catch {
            /* متوقف */
          }
        }
        if (raf) cancelAnimationFrame(raf)
        if (audioCtx) {
          try {
            await audioCtx.close()
          } catch {
            /* بسته */
          }
        }
      }

      // ۳) دریافت رسانه — فقط با شرکت‌کننده دوم قابل تأیید است؛ در آزمون
      //    تک‌نفره صادقانه «تأیید نشده» گزارش می‌شود
      const receiveState: StageState =
        receivedCount > 0 ? 'ok' : 'not_verified'
      const receiveDetail =
        receivedCount > 0
          ? `${receivedCount} ترک رسانه از شرکت‌کننده دوم دریافت شد`
          : 'آزمون تک‌نفره است — دریافت رسانه نیاز به شرکت‌کننده دوم دارد'

      // ۴) پاک‌سازی کامل: قطع اتصال + حذف اتاق تشخیصی از سرور
      setLiveStatus('پاک‌سازی آزمون…')
      try {
        await room.disconnect()
      } catch {
        /* قطع شده */
      }
      const cleanupRes = await endTest()
      setResult({
        signaling: signalingState,
        signalingDetail,
        webrtc: webrtcState,
        webrtcDetail: webrtcDetail,
        publish: publishState,
        publishDetail,
        receive: receiveState,
        receiveDetail,
        cleanup: cleanupRes.cleaned ? 'ok' : cleanupRes.fallback ? 'fallback' : 'failed',
        cleanupDetail:
          cleanupRes.fallback ??
          (cleanupRes.cleaned ? 'اتاق تشخیصی از سرور حذف شد' : undefined),
        mediaKind: mode,
        mediaLabel: mode === 'real' ? 'دستگاه واقعی (با مجوز)' : 'رسانه مصنوعی',
        at: Date.now(),
      })
    } catch (e) {
      if (testId && !endCalled) {
        endCalled = true
        try {
          await fetch('/api/superadmin/infrastructure/live-test/end', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ testId }),
          })
        } catch {
          /* بهترین تلاش — اتاق خودکار حذف می‌شود */
        }
      }
      setResult({
        signaling: 'failed',
        signalingDetail: e instanceof Error ? e.message.slice(0, 140) : 'خطای غیرمنتظره در آزمون',
        webrtc: 'skipped',
        publish: 'skipped',
        receive: 'skipped',
        cleanup: 'fallback',
        cleanupDetail: 'اتاق تشخیصی حداکثر ۹۰ ثانیه بعد خودکار حذف می‌شود (empty_timeout)',
        mediaKind: mode,
        mediaLabel: mode === 'real' ? 'دستگاه واقعی (با مجوز)' : 'رسانه مصنوعی',
        at: Date.now(),
      })
    } finally {
      setLiveStatus(null)
      setRunning(false)
      runningRef.current = false
    }
  }, [mode])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Video className="h-4.5 w-4.5 text-primary" />
          سرور رسانه — آزمون اتصال رسانه
        </CardTitle>
        <CardDescription>
          ورود به اتاق تشخیصی موقت و مجزا (حداکثر ۲ شرکت‌کننده، حذف خودکار ۹۰ ثانیه‌ای)؛ هیچ اعلان کلاس یا حضورغیابی ایجاد نمی‌شود.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as 'artificial' | 'real')}
          className="flex flex-col gap-2 sm:flex-row sm:gap-4"
        >
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <RadioGroupItem value="artificial" id="diag-artificial" />
            <Label htmlFor="diag-artificial" className="font-normal cursor-pointer">
              رسانه مصنوعی (بدون دستگاه)
              <span className="block text-[11px] text-muted-foreground">پرده و تن صوتی ساختگی با برچسب «مصنوعی»</span>
            </Label>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <RadioGroupItem value="real" id="diag-real" />
            <Label htmlFor="diag-real" className="font-normal cursor-pointer">
              دستگاه واقعی (مجوز می‌خواهد)
              <span className="block text-[11px] text-muted-foreground">میکروفون/دوربین با تأیید مرورگر</span>
            </Label>
          </div>
        </RadioGroup>

        <Button onClick={run} disabled={running} size="sm">
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {liveStatus ?? 'در حال آزمون…'}
            </>
          ) : (
            'آزمون اتصال رسانه'
          )}
        </Button>

        {result ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-2">
            <StageRow label="سیگنالینگ (ورود به اتاق)" state={result.signaling} detail={result.signalingDetail} />
            <StageRow label="اتصال WebRTC (SFU)" state={result.webrtc} detail={result.webrtcDetail} />
            <StageRow
              label={`انتشار رسانه — ${result.mediaLabel}`}
              state={result.publish}
              detail={result.publishDetail}
            />
            <StageRow label="دریافت رسانه" state={result.receive} detail={result.receiveDetail} />
            <StageRow
              label="پاک‌سازی آزمون"
              state={result.cleanup === 'ok' ? 'ok' : result.cleanup === 'fallback' ? 'not_verified' : 'failed'}
              detail={result.cleanupDetail}
            />
            {result.at ? <div className="text-[11px] text-muted-foreground">{fmtTime(result.at)}</div> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function withTimeoutMs<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
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

// ─────────────────────────── کانتینر بخش مرورگر ───────────────────────────

export function BrowserTestsPanel() {
  return (
    <section className="space-y-4" aria-label="بررسی از مرورگر شما">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          نتایج این بخش فقط وضعیت «همین مرورگر و همین شبکهٔ شما» را نشان می‌دهد و سلامت اتصال دیگر کاربران را
          اثبات نمی‌کند. بررسی‌های این بخش فقط با اقدام شما اجرا می‌شوند و منابع آزمایشی پس از پایان پاک می‌شوند.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 lg:grid-cols-3">
        <SocketEchoTest />
        <TurnRelayTest />
        <LiveKitMediaTest />
      </div>
    </section>
  )
}
