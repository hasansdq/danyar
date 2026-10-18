'use client'

import { useEffect, useState, FormEvent, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  User,
  KeyRound,
  LogOut,
  Palette,
  Loader2,
  CheckCircle2,
  Bell,
  BellOff,
  Camera,
  Trash2,
  Smartphone,
  ShieldAlert,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { toast } from '@/hooks/use-toast'
import { roleLabel } from '@/lib/format'
import { PushSettingsCard } from '@/components/push/push-settings-card'
import { MutesCard } from '@/components/push/mutes-card'
import { SoundAlertCard } from '@/components/push/sound-card'
import { InstallAppCard } from '@/components/install-app-card'

interface Me {
  id: string
  username: string
  fullName: string
  role: string
  phone?: string | null
  avatarUrl?: string | null
  school?: { name: string } | null
}

export function SettingsClient({
  forcePassword = false,
  userRole,
  returnTo = '/',
}: {
  /** ورود با رمز پیش‌فرض — تغییر رمز تا پیش از ادامه اجباری است (درخواست کاربر) */
  forcePassword?: boolean
  /** نقش کاربر — برای مدیر کل کارت‌های مخصوص اپ نمایش داده نمی‌شود */
  userRole?: string
  /** مقصد پس از تغییر رمز اجباری */
  returnTo?: string
}) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const isSuperAdmin = userRole === 'SUPER_ADMIN'
  const [me, setMe] = useState<Me | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarVersion, setAvatarVersion] = useState(0)

  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/me', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setMe(data.user)
      }
    })()
  }, [])

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    if (next !== confirm) {
      toast({ title: 'تکرار رمز جدید مطابقت ندارد', variant: 'destructive' })
      return
    }
    if (next.length < 6) {
      toast({ title: 'رمز جدید باید حداقل ۶ کاراکتر باشد (رمز ضعیف فقط عدد یا فقط حرف مجاز است)', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'تغییر رمز ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'رمز عبور با موفقیت تغییر کرد' })
      setCurrent('')
      setNext('')
      setConfirm('')
      // تغییر رمز اجباری: پس از موفقیت به برنامه ادامه می‌دهیم (نشست بدون پرچم بازصادر شده)
      if (forcePassword) {
        router.push(returnTo)
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  async function onAvatarPicked(file: File) {
    setAvatarUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('purpose', 'avatar')
      const up = await fetch('/api/uploads', { method: 'POST', body: fd })
      const upData = await up.json().catch(() => null)
      if (!up.ok || !upData?.key) {
        toast({ title: upData?.error ?? 'آپلود تصویر ناموفق بود', variant: 'destructive' })
        return
      }
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarKey: upData.key }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'تنظیم تصویر ناموفق بود', variant: 'destructive' })
        return
      }
      setMe((prev) => (prev ? { ...prev, avatarUrl: `${data.avatarUrl}` } : prev))
      setAvatarVersion((v) => v + 1)
      toast({ title: 'تصویر پروفایل به‌روزرسانی شد' })
    } finally {
      setAvatarUploading(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  async function removeAvatar() {
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearAvatar: true }),
    })
    if (res.ok) {
      setMe((prev) => (prev ? { ...prev, avatarUrl: null } : prev))
      setAvatarVersion((v) => v + 1)
      toast({ title: 'تصویر پروفایل حذف شد' })
    }
  }

  async function logout() {
    setLoggingOut(true)
    // پاک‌سازی اطلاعات حساب فعلی برای کاربر بعدی
    try {
      sessionStorage.clear()
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('daniar-') || k.startsWith('muted-')) localStorage.removeItem(k)
      }
    } catch { /* ignore */ }
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push(isSuperAdmin ? '/superadmin' : '/login')
    router.refresh()
  }

  return (
    <div className="max-w-xl mx-auto px-3 py-4 sm:px-4 space-y-5">
      <h1 className="text-xl font-bold">تنظیمات</h1>

      {/* هشدار رمز پیش‌فرض — تغییر رمز اجباری تا پیش از ادامه (درخواست کاربر) */}
      {forcePassword && (
        <div
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 p-4 space-y-2"
          role="alert"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            تغییر رمز عبور اجباری
          </div>
          <p className="text-[13px] leading-6">
            شما با رمز عبور پیش‌فرض (<span dir="ltr">123456</span>) وارد شده‌اید؛ برای امنیت
            حساب، باید یک رمز جدید انتخاب کنید. تا زمان تغییر رمز، بقیهٔ بخش‌های برنامه قفل
            است.
          </p>
        </div>
      )}

      {/* پروفایل */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4.5 w-4.5 text-primary" />
            اطلاعات حساب
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-4 pb-1">
            <div className="relative">
              {me?.avatarUrl ? (
                <img
                  src={`${me.avatarUrl}?v=${avatarVersion}`}
                  alt="تصویر پروفایل"
                  className="h-16 w-16 rounded-full object-cover border"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-bold border">
                  {me ? me.fullName.trim().charAt(0) : '…'}
                </div>
              )}
              {avatarUploading && (
                <div className="absolute inset-0 rounded-full bg-background/70 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onAvatarPicked(f)
                }}
                aria-hidden="true"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
              >
                <Camera className="h-3.5 w-3.5" />
                تغییر تصویر
              </Button>
              {me?.avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive"
                  onClick={removeAvatar}
                  disabled={avatarUploading}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  حذف تصویر
                </Button>
              )}
            </div>
          </div>
          {me ? (
            <>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">نام و نام خانوادگی</span>
                <span className="font-medium">{me.fullName}</span>
              </div>
              <Separator />
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">نام کاربری</span>
                <span className="font-medium" dir="ltr">{me.username}</span>
              </div>
              <Separator />
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">نقش</span>
                <span className="font-medium">{roleLabel(me.role)}</span>
              </div>
              {me.school && (
                <>
                  <Separator />
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">مدرسه</span>
                    <span className="font-medium">{me.school.name}</span>
                  </div>
                </>
              )}
              <Separator />
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5" />
                  شماره تلفن (ورود پیامکی)
                </span>
                <span className="font-medium" dir="ltr">
                  {me.phone ?? 'ثبت نشده — توسط مدیر مدرسه تنظیم می‌شود'}
                </span>
              </div>
            </>
          ) : (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* اعلان‌های مرورگر (پوش واقعی) + انواع رویداد + دستگاه‌ها — فقط کاربران اپ */}
      {!isSuperAdmin && <PushSettingsCard />}

      {/* صدای هشدار پاپ‌آپ شروع کلاس — فقط کاربران اپ */}
      {!isSuperAdmin && <SoundAlertCard />}

      {/* بی‌صدایی‌ها — فقط کاربران اپ */}
      {!isSuperAdmin && <MutesCard />}

      {/* نصب برنامه روی موبایل (PWA) — همهٔ کاربران */}
      <InstallAppCard />

      {/* تغییر رمز */}
      <Card id="password" className={forcePassword ? 'border-amber-500/50' : ''}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4.5 w-4.5 text-primary" />
            تغییر رمز عبور
            {forcePassword && (
              <Badge variant="destructive" className="text-[10px]">
                اجباری
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {forcePassword
              ? 'رمز فعلی شما ۱۲۳۴۵۶ است؛ رمز جدیدی انتخاب کنید (حداقل ۶ کاراکتر — نمی‌تواند ۱۲۳۴۵۶ باشد).'
              : 'رمز جدید باید حداقل ۶ کاراکتر باشد؛ رمز ضعیف (فقط عدد یا فقط حرف) هم پذیرفته می‌شود.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cur">رمز فعلی</Label>
              <Input
                id="cur"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nw">رمز جدید</Label>
              <Input
                id="nw"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf">تکرار رمز جدید</Label>
              <Input
                id="cf"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              ذخیره رمز جدید
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* تم */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4.5 w-4.5 text-primary" />
            حالت نمایش
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={theme ?? 'system'}
            onValueChange={(v) => setTheme(v)}
            className="grid grid-cols-3 gap-2"
          >
            {[
              { value: 'light', label: 'روشن' },
              { value: 'dark', label: 'تاریک' },
              { value: 'system', label: 'سیستم' },
            ].map((opt) => (
              <Label
                key={opt.value}
                htmlFor={`theme-${opt.value}`}
                className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer text-sm font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem value={opt.value} id={`theme-${opt.value}`} className="sr-only" />
                {opt.label}
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* خروج */}
      <Button
        variant="destructive"
        className="w-full gap-2"
        onClick={logout}
        disabled={loggingOut}
      >
        {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        خروج از حساب کاربری
      </Button>
    </div>
  )
}
