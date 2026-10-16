'use client'

import { io, type Socket } from 'socket.io-client'
import { create } from 'zustand'

/**
 * اتصال Socket.IO به سرویس مستقل.
 * در سندباکس: /?XTransformPort=3003 از طریق گیت‌وی
 * در Docker/سرور: NEXT_PUBLIC_SOCKET_URL=/ و NEXT_PUBLIC_SOCKET_PATH=/socket.io با پراکسی همان دامنه
 */
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ??
  // در باندل production بدون متغیر build → همان‌دامنه (پراکسی استاندارد)؛ fallback سندباکس فقط برای dev است
  (process.env.NODE_ENV === 'production' ? '/' : '/?XTransformPort=3003')
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH ?? '/socket.io'

/** وضعیت دقیق اتصال بلادرنگ — متصل / درحال اتصال (تلاش خودکار) / قطع */
export type ConnStatus = 'connected' | 'connecting' | 'disconnected'

interface SocketStatusState {
  connected: boolean
  status: ConnStatus
  everConnected: boolean
  /** آخرین علت تشخیصی connect_error — بی‌خطر (بدون هیچ محرمانه)؛ برای tooltip نشان */
  lastError: string | null
  setConnected: (c: boolean) => void
  setStatus: (s: ConnStatus) => void
  setLastError: (e: string | null) => void
}

/** ترجمه کدهای بی‌خطر سرور به توضیح فارسی کوتاه — بدون افشای هیچ محرمانه‌ای */
export function describeSocketError(msg: string): string {
  if (msg.startsWith('auth:no_session'))
    return 'کوکی نشست به سرور نرسید — وارد شوید یا صفحه را نوسازی کنید'
  if (msg.startsWith('auth:bad_token'))
    return 'نشست منقضی یا نامعتبر است — خارج و دوباره وارد شوید'
  if (msg.startsWith('auth:unknown_user'))
    return 'کاربر این نشست در سامانه نیست — دوباره وارد شوید'
  if (msg.startsWith('auth:inactive')) return 'حساب کاربری غیرفعال است'
  if (msg.startsWith('auth:role_not_allowed'))
    return 'این نقش به اتصال بلادرنگ دسترسی ندارد'
  if (msg.startsWith('auth:server_error'))
    return 'خطای داخلی سرویس بلادرنگ — با مدیر سرور تماس بگیرید'
  if (/xhr|poll|network|timeout|websocket/i.test(msg))
    return 'ارتباط با سرویس بلادرنگ برقرار نشد (شبکه/درگاه)'
  return msg
}

export const useSocketStatus = create<SocketStatusState>((set) => ({
  connected: false,
  // از لحظه باز شدن برنامه تا برقراری اتصال، وضعیت واقعی «درحال اتصال» است
  status: 'connecting',
  everConnected: false,
  lastError: null,
  setConnected: (c) =>
    set((s) => ({
      connected: c,
      status: c ? 'connected' : 'disconnected',
      everConnected: s.everConnected || c,
    })),
  setStatus: (status) =>
    set((s) => ({
      status,
      connected: status === 'connected',
      everConnected: s.everConnected || status === 'connected',
    })),
  setLastError: (lastError) => set({ lastError }),
}))

let socket: Socket | null = null

/** شروع نخستین تلاش اتصال — برای وضعیت صادق پس از شکست‌های پیاپی */
let firstAttemptAt = 0
/** اگر هرگز وصل نشدیم، پس از این مدت شکست پیاپی «قطع اتصال» گزارش می‌شود نه «درحال اتصال» */
const HONEST_DISCONNECT_MS = 8000

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      // ترتیب حیاتی: اتصال اولیه با polling (احراز هویت با کوکی) و سپس ارتقا به websocket —
      // در برخی پروکسی‌ها (پیش‌نمایش زنده) هدر کوکی روی درخواست ارتقای websocket تازه حذف
      // می‌شود؛ چون احراز هویت در polling انجام شده، ارتقا روی همان نشست تأیید می‌شود و
      // در صورت شکست ارتقا، اتصال روی polling سالم می‌ماند (رفتار پیش‌فرض socket.io)
      transports: ['polling', 'websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    })

    socket.on('connect', () => {
      firstAttemptAt = 0
      useSocketStatus.getState().setLastError(null)
      useSocketStatus.getState().setStatus('connected')
    })
    // قطع موقت: تلاش مجدد خودکار بلافاصله آغاز می‌شود (attempts=Infinity) —
    // پس وضعیت درست «درحال اتصال» است؛ «قطع اتصال» فقط وقتی معنا دارد که
    // هیچ تلاشی در جریان نباشد که با تنظیمات فعلی هرگز رخ نمی‌دهد
    socket.on('disconnect', () => useSocketStatus.getState().setStatus('connecting'))
    // تلاش ناموفق: تا ۸ ثانیه اول «درحال اتصال»؛ پس از آن اگر هرگز وصل نشده بودیم
    // وضعیت صادق «قطع اتصال» است (تلاش خودکار ادامه دارد) تا کاربر گیر نکند
    socket.on('connect_error', (e) => {
      const st = useSocketStatus.getState()
      st.setLastError(describeSocketError(e?.message ?? ''))
      if (st.everConnected) {
        st.setStatus('connecting')
        return
      }
      if (!firstAttemptAt) firstAttemptAt = Date.now()
      st.setStatus(Date.now() - firstAttemptAt >= HONEST_DISCONNECT_MS ? 'disconnected' : 'connecting')
    })
    // شروع تلاش مجدد خودکار (بازگشت نمایی ۱ تا ۵ ثانیه، بی‌نهایت)
    socket.io.on('reconnect_attempt', () => useSocketStatus.getState().setStatus('connecting'))
  }
  return socket
}

/** بازسازی اتاق‌ها پس از تغییر عضویت */
export function refreshRooms() {
  const s = getSocket()
  if (s.connected) s.emit('refresh-rooms')
}
