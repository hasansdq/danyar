'use client'

import { useState, FormEvent, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LogIn, Loader2, ShieldCheck, MessageSquareText, KeyRound, Bot, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LoginFormProps {
  realm: 'app' | 'superadmin'
  title: string
  description: string
}

type Method = 'password' | 'sms'

export function LoginForm({ realm, title, description }: LoginFormProps) {
  const router = useRouter()
  const [method, setMethod] = useState<Method>('password')

  // ورود با رمز
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // ورود با پیامک
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [smsLoading, setSmsLoading] = useState(false)

  // من ربات نیستم — الزامی برای ارسال فرم (درخواست کاربر)
  const [notRobot, setNotRobot] = useState(false)
  const [robotError, setRobotError] = useState(false)
  // تله‌ی Bot — فیلد مخفی که فقط ربات‌ها پر می‌کنند
  const [honeypot, setHoneypot] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // مقصد پس از ورود (مثلاً از کلیک اعلان وقتی کاربر وارد نبوده: /login?next=…)
  const [nextPath, setNextPath] = useState('')
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    try {
      const n = new URLSearchParams(window.location.search).get('next') ?? ''
      // فقط مسیر داخلی امن — نه خارجی نه پروتکلی
      if (n.startsWith('/') && !n.startsWith('//') && !n.includes('://')) setNextPath(n)
    } catch {
      /* ignore */
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  function startCountdown(seconds: number) {
    setCountdown(seconds)
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!notRobot) {
      setRobotError(true)
      setError('لطفاً گزینه «من ربات نیستم» را تأیید کنید')
      return
    }
    if (honeypot) return // تله‌ی Bot — silently drop
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, realm }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'ورود ناموفق بود')
        setLoading(false)
        return
      }
      // مقصد از اعلان/مسیر درخواستی در اولویت است
      router.push(nextPath || (data.redirect ?? '/chats'))
      router.refresh()
    } catch {
      setError('خطا در برقراری ارتباط با سرور')
      setLoading(false)
    }
  }

  // تبدیل ارقام فارسی به انگلیسی برای ارسال
  function normalizeFaDigits(v: string): string {
    const fa = '۰۱۲۳۴۵۶۷۸۹'
    const ar = '٠١٢٣٤٥٦٧٨٩'
    let out = ''
    for (const ch of v) {
      const fi = fa.indexOf(ch)
      if (fi !== -1) { out += String(fi); continue }
      const ai = ar.indexOf(ch)
      if (ai !== -1) { out += String(ai); continue }
      out += ch
    }
    return out
  }

  async function requestCode() {
    setError(null)
    if (!notRobot) {
      setRobotError(true)
      setError('لطفاً گزینه «من ربات نیستم» را تأیید کنید')
      return
    }
    if (honeypot) return
    setSmsLoading(true)
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizeFaDigits(phone) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'ارسال کد ناموفق بود')
        if (data.retryAfter) startCountdown(data.retryAfter)
        return
      }
      setCodeSent(true)
      setCode('')
      startCountdown(data.cooldownSeconds ?? 60)
    } catch {
      setError('خطا در برقراری ارتباط با سرور')
    } finally {
      setSmsLoading(false)
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSmsLoading(true)
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizeFaDigits(phone), code: normalizeFaDigits(code) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'ورود ناموفق بود')
        return
      }
      // مقصد از اعلان/مسیر درخواستی در اولویت است
      router.push(nextPath || (data.redirect ?? '/chats'))
      router.refresh()
    } catch {
      setError('خطا در برقراری ارتباط با سرور')
    } finally {
      setSmsLoading(false)
    }
  }

  const isSuper = realm === 'superadmin'

  return (
    <div
      className={
        'min-h-screen flex items-center justify-center p-4 ' +
        (isSuper ? 'bg-background' : 'bg-gradient-to-b from-primary/5 to-background')
      }
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/daniar-logo.svg" alt="لوگوی دانیار" className="h-16 w-16" />
          <h1 className="text-2xl font-bold">دانیار</h1>
          <p className="text-sm text-muted-foreground">
            پیام‌رسان آموزشی مدارس
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {isSuper ? (
                <ShieldCheck className="h-5 w-5 text-primary" />
              ) : (
                <LogIn className="h-5 w-5 text-primary" />
              )}
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* انتخاب روش ورود — فقط برای کاربران عادی */}
            {!isSuper && (
              <div className="grid grid-cols-2 gap-2 mb-4" role="tablist" aria-label="روش ورود">
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === 'password'}
                  onClick={() => { setMethod('password'); setError(null) }}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    method === 'password'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  <KeyRound className="h-4 w-4" />
                  با رمز عبور
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === 'sms'}
                  onClick={() => { setMethod('sms'); setError(null) }}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    method === 'sms'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  <MessageSquareText className="h-4 w-4" />
                  با پیامک
                </button>
              </div>
            )}

            {method === 'password' || isSuper ? (
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="username">نام کاربری</Label>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    dir="ltr"
                    className="text-left"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">رمز عبور</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}

                <NotRobotCheck
                  checked={notRobot}
                  onChange={(v) => {
                    setNotRobot(v)
                    if (v) setRobotError(false)
                  }}
                  highlight={robotError}
                  honeypot={honeypot}
                  onHoneypot={setHoneypot}
                />

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ورود'}
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">شماره تلفن ثبت‌شده</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    dir="ltr"
                    className="text-left"
                    placeholder="09xxxxxxxxx"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    قالب‌های ۰۹ / ۹۸ / +۹۸ و ارقام فارسی یا انگلیسی پذیرفته می‌شود
                  </p>
                </div>

                {codeSent && (
                  <div className="space-y-2">
                    <Label htmlFor="code">کد یک‌بارمصرف</Label>
                    <Input
                      id="code"
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      dir="ltr"
                      className="text-left tracking-[0.4em] font-bold"
                      placeholder="––––––"
                      maxLength={8}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      کد پیامک‌شده محرمانه است — آن را با کسی به اشتراک نگذارید
                    </p>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}

                <NotRobotCheck
                  checked={notRobot}
                  onChange={(v) => {
                    setNotRobot(v)
                    if (v) setRobotError(false)
                  }}
                  highlight={robotError}
                  honeypot={honeypot}
                  onHoneypot={setHoneypot}
                />

                {!codeSent ? (
                  <Button
                    type="button"
                    className="w-full"
                    disabled={smsLoading || phone.trim().length < 8}
                    onClick={requestCode}
                  >
                    {smsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'ارسال کد ورود'
                    )}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      className="w-full"
                      disabled={smsLoading || code.trim().length < 4}
                      onClick={verifyCode}
                    >
                      {smsLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'ورود به دانیار'
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={smsLoading || countdown > 0}
                      onClick={requestCode}
                    >
                      {countdown > 0
                        ? `ارسال مجدد کد (${new Intl.NumberFormat('fa-IR').format(countdown)} ثانیه)`
                        : 'ارسال مجدد کد'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {!isSuper && (
          <p className="text-center text-xs text-muted-foreground">
            <a href="/superadmin" className="underline underline-offset-4 hover:text-foreground">
              ورود مدیر کل پلتفرم
            </a>
          </p>
        )}
      </div>
    </div>
  )
}

/** گزینه «من ربات نیستم» — الزامی برای ورود + تله‌ی Bot */
function NotRobotCheck({
  checked,
  onChange,
  highlight,
  honeypot,
  onHoneypot,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  highlight: boolean
  honeypot: string
  onHoneypot: (v: string) => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
        highlight && !checked
          ? 'border-destructive/50 bg-destructive/5'
          : checked
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : '',
      )}
    >
      {/* تله‌ی Bot — با CSS مخفی؛ کاربر واقعی نمی‌بیند */}
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        value={honeypot}
        onChange={(e) => onHoneypot(e.target.value)}
        className="absolute opacity-0 h-0 w-0 pointer-events-none"
        aria-hidden="true"
      />
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label="من ربات نیستم"
        onClick={() => onChange(!checked)}
        className={cn(
          'h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
          checked
            ? 'bg-emerald-600 border-emerald-600 text-white'
            : highlight
              ? 'border-destructive/60'
              : 'border-muted-foreground/40 hover:border-primary',
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </button>
      <span className="text-sm select-none flex items-center gap-1.5">
        <Bot className="h-4 w-4 text-muted-foreground" />
        من ربات نیستم
      </span>
      <ShieldCheck className="h-4 w-4 text-muted-foreground/50 ms-auto" />
    </div>
  )
}
