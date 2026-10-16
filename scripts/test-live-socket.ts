/// <reference types="bun-types" />
/**
 * تست واقعی لایه بلادرنگ کلاس آنلاین (Socket.IO) — بدون مرورگر، با کلاینت واقعی socket.io
 * سناریو: اعلام شروع کلاس (رویداد live:class-started فقط برای دانش‌آموزان همان کلاس + ضدتکرار)،
 * ورود مجاز/غیرمجاز، رله offer/answer/ICE/track-map بین دو عضو،
 * چت جلسه، دست بلند، اجازه صحبت/اشتراک، سکوت معلم، اخراج و ممانعت از ورود مجدد،
 * جایگزینی اتصال تکراری، قطع موقت معلم + مهلت اتصال مجدد (پایان خودکار پس از مهلت)،
 * پایان جلسه و رد ورود پس از پایان + رویداد وضعیت دکمه دعوت
 *
 * اجرا: bun scripts/test-live-socket.ts  (باید جلسه ACTIVE اعلام‌نشده از test-live.sh باقی باشد)
 * نکته: برای تست سریع مهلت، سرویس سوکت را با LIVE_HOST_GRACE_SECONDS=6 اجرا کنید؛
 * تست مقدار graceSeconds را از رویداد واقعی می‌خواند و با هر مقداری کار می‌کند.
 */
import { io, type Socket } from 'socket.io-client'

const BASE = 'http://localhost:3000'
const SOCKET_URL = 'http://localhost:3003'
const SOCKET_PATH = '/socket.io'

let pass = 0
let fail = 0
const ok = (m: string) => { pass++; console.log('  ✅', m) }
const bad = (m: string) => { fail++; console.log('  ❌', m) }
const section = (m: string) => console.log(`\n▶ ${m}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function login(username: string, password = 'Pass@123'): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, realm: 'app' }),
  })
  if (!r.ok) throw new Error(`login failed for ${username}: ${r.status}`)
  const setCookie = r.headers.get('set-cookie') ?? ''
  const token = /daniar_session=([^;]+)/.exec(setCookie)?.[1]
  if (!token) throw new Error(`no cookie for ${username}`)
  return `daniar_session=${token}`
}

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(SOCKET_URL, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
      timeout: 5000,
    })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e) => reject(e))
  })
}

/** ack-based emit با timeout */
function emit<T = { ok: boolean; error?: string; data?: any }>(
  s: Socket,
  event: string,
  payload?: unknown,
  timeoutMs = 4000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeoutMs)
    s.emit(event, payload, (res: T) => {
      clearTimeout(t)
      resolve(res)
    })
  })
}

/** منتظر رویداد مشخص روی سوکت */
function waitFor<T = any>(s: Socket, event: string, timeoutMs = 5000, match?: (d: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      s.off(event, fn)
      reject(new Error(`timeout waiting for ${event}`))
    }, timeoutMs)
    const fn = (d: T) => {
      if (match && !match(d)) return
      clearTimeout(t)
      s.off(event, fn)
      resolve(d)
    }
    s.on(event, fn)
  })
}

async function main() {
  const sid = (await Bun.file('/tmp/danyar-live/sid2.txt').text()).trim()
  const gmath7 = (await Bun.file('/tmp/danyar-live/gmath7.txt').text()).trim()
  console.log(`جلسه تست: ${sid}`)

  section('اعلام شروع کلاس — رویداد پاپ‌آپ فقط برای دانش‌آموزان همان کلاس + ضدتکرار')
  const t1c = await login('beheshti.t1')
  const s1 = await connect(await login('beheshti.s1'))
  const s5 = await connect(await login('beheshti.s5'))
  const fs1 = await connect(await login('farzanegan.s1'))

  const startedWaitS1 = waitFor<any>(s1, 'live:class-started', 8000)
  const leakS5 = waitFor<any>(s5, 'live:class-started', 2500).catch(() => 'none')
  const leakFS1 = waitFor<any>(fs1, 'live:class-started', 2500).catch(() => 'none')

  async function rest(method: string, path: string, cookie: string) {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie } })
    return { status: r.status, data: await r.json().catch(() => null) }
  }

  // اعلام توسط دانش‌آموز باید رد شود
  const annByStudent = await rest('POST', `/api/live-sessions/${sid}/announce`, await login('beheshti.s1'))
  annByStudent.status === 403
    ? ok('اعلام شروع توسط دانش‌آموز رد شد (403)')
    : bad('اعلام توسط دانش‌آموز! ' + JSON.stringify(annByStudent))
  // اعلام توسط معلم مدرسه دیگر — اصلاً وجود جلسه را نمی‌بیند
  const annByForeign = await rest('POST', `/api/live-sessions/${sid}/announce`, await login('farzanegan.t1'))
  annByForeign.status === 404
    ? ok('اعلام توسط معلم مدرسه دیگر رد شد (404)')
    : bad('اعلام بین‌مدرسه! ' + JSON.stringify(annByForeign))

  const annRes = await rest('POST', `/api/live-sessions/${sid}/announce`, t1c)
  annRes.status === 200 && annRes.data?.announcedAt
    ? ok(`میزبان شروع کلاس را اعلام کرد (مخاطبان: ${annRes.data?.audience})`)
    : bad('اعلام شروع ناموفق: ' + JSON.stringify(annRes.data))

  const startedEv = await startedWaitS1
  startedEv?.sessionId === sid && startedEv?.teacherName && startedEv?.classroomName
    ? ok(`پاپ‌آپ شروع کلاس برای s1 رسید: «${startedEv.title}» — ${startedEv.teacherName} / ${startedEv.classroomName}`)
    : bad('رویداد live:class-started به دانش‌آموز همان کلاس نرسید')

  const l5 = await leakS5
  const lf = await leakFS1
  l5 === 'none' && lf === 'none'
    ? ok('رویداد شروع کلاس به دانش‌آموز کلاس دیگر/مدرسه دیگر ارسال نشد')
    : bad('نشت رویداد شروع کلاس به غیر اعضا!')

  // اعلام دوباره — بدون رویداد تکراری
  const reAnn = await rest('POST', `/api/live-sessions/${sid}/announce`, t1c)
  const dupWait = waitFor<any>(s1, 'live:class-started', 1800).catch(() => 'none')
  reAnn.status === 200 && reAnn.data?.alreadyAnnounced === true
    ? ok('اعلام مجدد → alreadyAnnounced (idempotent)')
    : bad('اعلام مجدد idempotent نبود: ' + JSON.stringify(reAnn.data))
  const dup = await dupWait
  dup === 'none'
    ? ok('اعلام مجدد هیچ رویداد/اعلان تکراری نساخت')
    : bad('رویداد تکراری live:class-started دریافت شد!')

  section('اتصال سوکت با کوکی واقعی')
  let t1 = await connect(t1c)
  const t2 = await connect(await login('beheshti.t2'))
  ok('۵ کلاینت سوکت (t1 میزبان، s1 هم‌کلاس، s5 کلاس دیگر، fs1 مدرسه دیگر، t2 معلم منتسب)')

  section('ورود به جلسه — ماتریس مجوز سمت سرور')
  const rS5 = await emit(s5, 'live:join', { sessionId: sid })
  if (!rS5.ok) ok('s5 (کلاس هشتم) رد شد: ' + rS5.error)
  else bad('s5 نباید وارد شود')

  const rFS1 = await emit(fs1, 'live:join', { sessionId: sid })
  if (!rFS1.ok) ok('fs1 (مدرسه دیگر) رد شد: ' + rFS1.error)
  else bad('fs1 نباید وارد شود')

  // جمع‌آوری رویدادهای ورود روی سوکت میزبان (برای بررسی دقیق بعد از join هر کاربر)
  const joinEvents: any[] = []
  t1.on('live:participant-joined', (d: any) => joinEvents.push(d))

  const rT1 = await emit<{ ok: boolean; data?: any }>(t1, 'live:join', { sessionId: sid })
  if (rT1.ok && rT1.data?.self?.canSpeak === true && rT1.data?.self?.canShare === true)
    ok('میزبان (t1) وارد شد — صحبت و اشتراک برایش آزاد')
  else bad('ورود میزبان یا مجوزهایش نادرست است')

  const rT2 = await emit<{ ok: boolean; data?: any }>(t2, 'live:join', { sessionId: sid })
  if (rT2.ok && rT2.data?.self?.canSpeak === true)
    ok('معلم منتسب کلاس (t2) وارد شد')
  else bad('ورود t2 ناموفق')

  const rS1 = await emit<{ ok: boolean; data?: any }>(s1, 'live:join', { sessionId: sid })
  if (rS1.ok && rS1.data?.self?.canSpeak === false && rS1.data?.self?.canShare === false)
    ok('دانش‌آموز s1 وارد شد — صحبت/اشتراک پیش‌فرض بسته (باید اجازه بگیرد)')
  else bad('ورود s1 یا مجوزهای پیش‌فرض نادرست')

  await sleep(400) // فرصت برای رسیدن رویدادها به سوکت میزبان
  const s1JoinEv = joinEvents.find(
    (e) => e?.participant?.userId === rS1?.data?.self?.userId,
  )
  if (s1JoinEv) ok('میزبان ورود s1 را بلادرنگ دید')
  else bad('رویداد participant-joined به میزبان نرسید')

  const participants = rS1?.data?.participants?.length ?? 0
  if (participants >= 3) ok(`فهرست شرکت‌کنندگان ${participants} نفر (t1، t2، s1) — بدون تکرار`)
  else bad('فهرست ناقص')

  section('رله واقعی WebRTC (offer/answer/ICE/track-map) بین t1 و s1')
  const sdpOffer = 'v=0\r\no=- 46117317 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
  const answerWait = waitFor(s1, 'webrtc:offer', 5000)
  const offerAck = await emit(t1, 'webrtc:offer', {
    to: rS1?.data?.self?.socketId,
    description: { type: 'offer', sdp: sdpOffer },
  })
  offerAck.ok ? ok('offer میزبان به سرور پذیرفته شد') : bad('emit offer رد شد: ' + offerAck.error)
  const gotOffer = await answerWait
  gotOffer?.description?.sdp === sdpOffer && gotOffer.from
    ? ok('offer دقیقاً به s1 رله شد (بدون تغییر محتوا)')
    : bad('offer ناقص/تحریف‌شده رسید')

  const answerWaitT1 = waitFor(t1, 'webrtc:answer', 5000)
  await emit(s1, 'webrtc:answer', {
    to: gotOffer.from,
    description: { type: 'answer', sdp: 'v=0\r\no=- 99 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
  })
  const gotAnswer = await answerWaitT1
  gotAnswer?.description?.type === 'answer'
    ? ok('answer s1 به t1 رله شد')
    : bad('answer نرسید')

  const iceWait = waitFor(s1, 'webrtc:ice', 5000)
  await emit(t1, 'webrtc:ice', { to: rS1?.data?.self?.socketId, candidate: { candidate: 'candidate:1 1 UDP 1 127.0.0.1 5000 typ host', sdpMid: '0' } })
  const gotIce = await iceWait
  gotIce?.candidate?.candidate?.includes('5000')
    ? ok('ICE candidate رله شد')
    : bad('ICE نرسید')

  const mapWait = waitFor(s1, 'live:track-map', 5000)
  await emit(t1, 'live:track-map', { to: rS1?.data?.self?.socketId, mids: [{ mid: '0', purpose: 'mic' }, { mid: '1', purpose: 'camera' }] })
  const gotMap = await mapWait
  gotMap?.mids?.length === 2 && gotMap.mids[1].purpose === 'camera'
    ? ok('track-map (نگاشت mid→کاربرد ترک) رله شد')
    : bad('track-map نرسید')

  const crossWait = waitFor(s5, 'webrtc:offer', 1500).catch(() => 'none')
  await emit(t1, 'webrtc:offer', { to: 'fake-socket-id', description: { type: 'offer', sdp: 'x' } }).catch(() => null)
  const cross = await crossWait
  cross === 'none' ? ok('رله به سوکت خارج از جلسه انجام نشد') : bad('نشت سیگنال به خارج از جلسه')

  section('گفتگوی متنی جلسه — مستقل از گروه عمومی')
  const chatWaitT1 = waitFor(t1, 'live:chat', 5000)
  const chatWaitT2 = waitFor(t2, 'live:chat', 5000)
  const chatRes = await emit<{ ok: boolean; data?: any; error?: string }>(s1, 'live:chat', { body: 'سلام استاد، صدای شما واضح است' })
  chatRes.ok ? ok('s1 پیام چت جلسه فرستاد') : bad('چت رد شد: ' + chatRes.error)
  const c1 = await chatWaitT1
  const c2 = await chatWaitT2
  c1?.body === 'سلام استاد، صدای شما واضح است' && c2?.senderName === 'رضا احمدی'
    ? ok('پیام هم‌زمان به t1 و t2 رسید (با نام واقعی فرستنده)')
    : bad('انتشار چت ناقص')

  const groupChatWait = waitFor(t1, 'message:new', 1500).catch(() => 'none')
  await emit(s1, 'live:chat', { body: 'این نباید به گروه عمومی برسد' })
  const groupLeak = await groupChatWait
  groupLeak === 'none' ? ok('چت جلسه به گروه عمومی سرریز نشد') : bad('نشت چت جلسه به گروه!')

  section('دست بلند + مجوز صحبت + سکوت توسط معلم')
  const handWait = waitFor(t1, 'live:participant-update', 5000, (d: any) => d?.participant?.handRaised === true)
  await emit(s1, 'live:hand', { raised: true })
  const handEv = await handWait
  handEv ? ok('درخواست صحبت (دست بالا) به میزبان رسید') : bad('دست بالا به میزبان نرسید')

  const micDeny = await emit(s1, 'live:media', { micOn: true })
  !micDeny.ok && (micDeny.error ?? '').includes('اجازه')
    ? ok('میکروفون بدون اجازه معلم رد شد: ' + micDeny.error)
    : bad('میکروفون بدون اجازه نباید روشن شود')

  const permWait = waitFor(s1, 'live:permission-changed', 5000)
  await emit(t1, 'live:permit', { userId: rS1?.data?.self?.userId, canSpeak: true })
  const perm = await permWait
  perm?.canSpeak === true ? ok('معلم اجازه صحبت داد → s1 مطلع شد') : bad('رویداد اجازه صحبت نرسید')

  const micUpdate = waitFor(t1, 'live:participant-update', 5000, (d: any) => d?.participant?.micOn === true)
  const micRes = await emit(s1, 'live:media', { micOn: true })
  micRes.ok ? ok('پس از اجازه، s1 میکروفون را روشن کرد') : bad('میکروفون پس از اجازه رد شد')
  await micUpdate
  ok('روشن‌شدن میکروفون s1 بلادرنگ به میزبان رسید')

  const muteWait = waitFor(s1, 'live:you-are-muted', 5000)
  await emit(t1, 'live:mute-target', { userId: rS1?.data?.self?.userId })
  await muteWait
  ok('معلم میکروفون s1 را بست → s1 رویداد you-are-muted گرفت')
  const micDeny2 = await emit(s1, 'live:media', { micOn: true })
  !micDeny2.ok ? ok('روشن‌کردن مجدد میکروفون در حین سکوت اجباری رد شد') : bad('سکوت اجباری قابل دور زدن بود!')

  const shareDeny = await emit(s1, 'live:media', { sharing: true })
  !shareDeny.ok ? ok('اشتراک صفحه بدون اجازه رد شد') : bad('اشتراک بدون اجازه!')
  const permShare = waitFor(s1, 'live:permission-changed', 5000)
  await emit(t1, 'live:permit', { userId: rS1?.data?.self?.userId, canShare: true })
  const ps = await permShare
  ps?.canShare === true ? ok('معلم اجازه اشتراک صفحه داد') : bad('اجازه اشتراک نرسید')
  const shareRes = await emit(s1, 'live:media', { sharing: true })
  shareRes.ok ? ok('پس از اجازه، اشتراک صفحه s1 پذیرفته شد') : bad('اشتراک پس از اجازه رد شد')
  await emit(s1, 'live:media', { sharing: false })

  section('اتصال تکراری — جایگزینی (بدون شرکت‌کننده تکراری)')
  const s1b = await connect(await login('beheshti.s1'))
  const replaced = waitFor(s1, 'live:replaced', 5000)
  const rS1b = await emit<{ ok: boolean; data?: any }>(s1b, 'live:join', { sessionId: sid })
  rS1b.ok ? ok('s1 با سوکت دوم وارد شد (سناریوی اتصال مجدد)') : bad('ورود مجدد s1 ناموفق')
  const rep = await replaced
  rep !== null ? ok('سوکت قدیمی s1 رویداد live:replaced گرفت (جایگزینی)') : bad('سوکت قدیمی جایگزین نشد')
  const listAfter = await emit<{ ok: boolean; data?: any }>(t2, 'live:leave')
  const rejoinT2 = await emit<{ ok: boolean; data?: any }>(t2, 'live:join', { sessionId: sid })
  const s1Count = (rejoinT2.data?.participants ?? []).filter((p: any) => p.name === 'رضا احمدی').length
  if (s1Count === 1) ok('در فهرست، s1 فقط یک‌بار وجود دارد (بدون تکرار)')
  else bad(`s1 تکراری: ${s1Count}`)
  s1.close() // فقط سوکت قدیمی بسته می‌شود؛ s1b سوکت فعال s1 باقی می‌ماند

  section('اخراج و ممانعت از ورود مجدد')
  const kickWait = waitFor(s1b, 'live:kicked', 5000)
  await emit(t1, 'live:kick', { userId: rS1b?.data?.self?.userId })
  await kickWait
  ok('s1 اخراج شد → رویداد live:kicked گرفت')
  s1b.close()
  await sleep(300)
  const s1c = await connect(await login('beheshti.s1'))
  const rejoin = await emit(s1c, 'live:join', { sessionId: sid })
  if (!rejoin.ok && (rejoin.error ?? '').includes('خارج')) ok('ورود مجدد اخراج‌شده رد شد: ' + rejoin.error)
  else bad('اخراج‌شده دوباره وارد شد!')
  s1c.close()

  section('پایان جلسه توسط غیرمیزبان رد می‌شود')
  const s2tmp = await connect(await login('beheshti.s2'))
  const endDeny = await emit(s2tmp, 'live:end')
  if (!endDeny.ok) ok('پایان جلسه توسط غیرمیزبان رد شد: ' + endDeny.error)
  else bad('غیرمیزبان جلسه را پایان داد!')
  s2tmp.close()

  section('قطع موقت معلم — مهلت اتصال مجدد (پایان قطعی فقط پس از مهلت)')
  // t2 داخل جلسه است؛ با قطع t1 باید رویداد host-status (قطع) برسد
  const graceWaitT2 = waitFor<any>(t2, 'live:host-status', 6000, (d: any) => d?.hostConnected === false)
  t1.disconnect()
  const graceEv = await graceWaitT2
  graceEv?.graceSeconds >= 5
    ? ok(`قطع معلم اعلام شد — مهلت اتصال مجدد: ${graceEv.graceSeconds} ثانیه`)
    : bad('رویداد قطع معلم یا graceSeconds نرسید: ' + JSON.stringify(graceEv))

  // بازگشت معلم در مهلت → لغو مهلت و ادامه جلسه
  const backWaitT2 = waitFor<any>(t2, 'live:host-status', 6000, (d: any) => d?.hostConnected === true)
  t1 = await connect(t1c)
  const rT1back = await emit<{ ok: boolean; data?: any; error?: string }>(t1, 'live:join', { sessionId: sid })
  rT1back.ok ? ok('معلم در مهلت به جلسه برگشت') : bad('ورود مجدد معلم ناموفق: ' + rT1back.error)
  const backEv = await backWaitT2
  backEv ? ok('بازگشت معلم به همه شرکت‌کننده‌ها اعلام شد (لغو مهلت)') : bad('رویداد بازگشت معلم نرسید')

  // قطع دوباره معلم + سپری‌شدن مهلت → پایان واقعی جلسه در سرور
  const endedWaitT2 = waitFor<any>(t2, 'live:ended', graceEv.graceSeconds * 1000 + 10000)
  const statusWaitT2 = waitFor<any>(t2, 'live:session-status', graceEv.graceSeconds * 1000 + 10000, (d: any) => d?.sessionId === sid)
  t1.disconnect()
  ok('معلم قطع شد؛ منتظر سپری‌شدن مهلت…')
  const endedEv = await endedWaitT2
  endedEv ? ok('پس از مهلت، جلسه در سرور پایان یافت (live:ended)') : bad('جلسه پس از مهلت پایان نیافت')
  const statusEv2 = await statusWaitT2
  statusEv2?.status === 'ENDED'
    ? ok('رویداد live:session-status ENDED برای به‌روزرسانی سوییچ/دعوت‌ها رسید')
    : bad('رویداد وضعیت پس از مهلت نرسید')

  // وضعیت واقعی در DB — از مسیر REST
  const t2Cookie = await login('beheshti.t2')
  const statusRes = await fetch(`${BASE}/api/live-sessions/${sid}`, { headers: { cookie: t2Cookie } })
  const statusData = await statusRes.json().catch(() => null)
  statusData?.status === 'ENDED'
    ? ok('وضعیت واقعی جلسه در سرور «پایان‌یافته» است')
    : bad('وضعیت DB پس از مهلت: ' + JSON.stringify(statusData?.status))

  section('ورود پس از پایان جلسه رد می‌شود')
  const afterEnd = await connect(await login('beheshti.s2'))
  const joinAfter = await emit(afterEnd, 'live:join', { sessionId: sid })
  !joinAfter.ok ? ok('ورود پس از پایان جلسه رد شد: ' + joinAfter.error) : bad('ورود پس از پایان!')
  // اعلام شروع برای جلسه پایان‌یافته هم رد می‌شود
  const annAfterEnd = await fetch(`${BASE}/api/live-sessions/${sid}/announce`, {
    method: 'POST',
    headers: { cookie: t1c },
  })
  annAfterEnd.status === 409
    ? ok('اعلام شروع برای جلسه پایان‌یافته رد شد (409)')
    : bad('اعلام شروع روی جلسه پایان‌یافته! ' + annAfterEnd.status)
  afterEnd.close()

  for (const s of [s1, s5, fs1, t2, t1]) { try { s.close() } catch {} }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`نتیجه سوکت: ${pass} پاس / ${fail} خطا`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('خطای اجرای تست:', e.message)
  process.exit(1)
})
