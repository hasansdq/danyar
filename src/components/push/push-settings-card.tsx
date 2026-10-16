'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bell,
  BellRing,
  BellOff,
  Loader2,
  Send,
  MonitorSmartphone,
  ShieldAlert,
  Info,
  Trash2,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import {
  detectPushSupport,
  activatePushOnThisDevice,
  deactivatePushOnThisDevice,
  getDeviceId,
  type PushSupport,
} from '@/lib/push-client'
import { PUSH_EVENT_CATEGORIES, PUSH_EVENT_LABELS, type PushEventCategory } from '@/lib/push-types'

interface DeviceRow {
  id: string
  deviceId: string | null
  label: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface PushConfigData {
  vapidConfigured: boolean
  publicKey: string | null
  platformEnabled: boolean
  schoolEnabled: boolean | null
  eventTypes: PushEventCategory[]
  previewEnabled: boolean
  devices: DeviceRow[]
}

interface TestResult {
  ok: boolean
  message: string
  errors?: string[]
}

type PersianDate = (iso: string) => string

/**
 * کارت تنظیمات پوش نوتیفیکیشن واقعی مرورگر — مشترک بین تنظیمات کاربر،
 * پنل مدیر مدرسه و پنل مدیر کل.
 * - درخواست مجوز مرورگر فقط پس از کلیک کاربر و با توضیح قبلی انجام می‌شود
 * - وضعیت شفاف: فعال، غیرفعال، مسدودشده، پشتیبانی‌نشده
 * - دکمه ارسال اعلان آزمایشی با گزارش نتیجه واقعی
 */
export function PushSettingsCard({ formatDate }: { formatDate?: PersianDate }) {
  const { toast } = useToast()
  const [support, setSupport] = useState<PushSupport | null>(null)
  const [config, setConfig] = useState<PushConfigData | null>(null)
  const [browserSubscribed, setBrowserSubscribed] = useState(false)
  const [explainerOpen, setExplainerOpen] = useState(false)
  const [activating, setActivating] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [busyDevice, setBusyDevice] = useState<string | null>(null)
  const [savingEvents, setSavingEvents] = useState(false)

  const fmtDate: PersianDate =
    formatDate ??
    ((iso: string) => {
      try {
        return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(
          new Date(iso),
        )
      } catch {
        return iso
      }
    })

  const myDeviceId = typeof window !== 'undefined' ? getDeviceId() : ''

  const loadState = useCallback(async () => {
    const s = detectPushSupport()
    setSupport(s)
    try {
      const res = await fetch('/api/push/config', { cache: 'no-store' })
      if (res.ok) {
        const d: PushConfigData = await res.json()
        setConfig(d)
      }
    } catch {
      /* ignore */
    }
    try {
      const reg = await navigator.serviceWorker?.getRegistration('/')
      const sub = reg ? await reg.pushManager.getSubscription() : null
      setBrowserSubscribed(!!sub)
    } catch {
      setBrowserSubscribed(false)
    }
  }, [])

  useEffect(() => {
    loadState()
  }, [loadState])

  async function activate() {
    setActivating(true)
    try {
      if (!config?.publicKey) {
        toast({ title: 'پوش روی سرور پیکربندی نشده است', variant: 'destructive' })
        return
      }
      const r = await activatePushOnThisDevice(config.publicKey)
      if (!r.ok) {
        toast({ title: r.error ?? 'فعال‌سازی ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'اعلان‌های این دستگاه فعال شد' })
      setExplainerOpen(false)
      await loadState()
    } finally {
      setActivating(false)
    }
  }

  async function deactivate() {
    const ok = await deactivatePushOnThisDevice()
    if (ok) {
      toast({ title: 'پوش این دستگاه غیرفعال شد', description: 'اعلان‌های درون‌برنامه‌ای همچنان کار می‌کنند.' })
      await loadState()
    } else {
      toast({ title: 'غیرفعال‌سازی ناموفق بود', variant: 'destructive' })
    }
  }

  async function sendTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: myDeviceId }),
      })
      const d = (await res.json().catch(() => null)) as TestResult | null
      if (!d) {
        setTestResult({ ok: false, message: 'پاسخ سرور نامعتبر بود' })
        return
      }
      setTestResult(d)
      await loadState()
    } finally {
      setTesting(false)
    }
  }

  async function toggleDevice(device: DeviceRow, enabled: boolean) {
    setBusyDevice(device.id)
    try {
      const res = await fetch(`/api/push/devices/${device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (res.ok) {
        setConfig((c) =>
          c ? { ...c, devices: c.devices.map((d) => (d.id === device.id ? { ...d, enabled } : d)) } : c,
        )
      } else {
        toast({ title: 'ذخیره وضعیت دستگاه ناموفق بود', variant: 'destructive' })
      }
    } finally {
      setBusyDevice(null)
    }
  }

  async function removeDevice(device: DeviceRow) {
    setBusyDevice(device.id)
    try {
      const res = await fetch(`/api/push/devices/${device.id}`, { method: 'DELETE' })
      if (res.ok) {
        setConfig((c) => (c ? { ...c, devices: c.devices.filter((d) => d.id !== device.id) } : c))
        toast({ title: 'اشتراک دستگاه لغو شد' })
      } else {
        toast({ title: 'حذف دستگاه ناموفق بود', variant: 'destructive' })
      }
    } finally {
      setBusyDevice(null)
    }
  }

  async function toggleEventType(cat: PushEventCategory, on: boolean) {
    if (!config) return
    const next = on
      ? [...new Set([...config.eventTypes, cat])]
      : config.eventTypes.filter((c) => c !== cat)
    setConfig({ ...config, eventTypes: next })
    setSavingEvents(true)
    try {
      const res = await fetch('/api/me/notification-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewEnabled: config.previewEnabled, pushEventTypes: next }),
      })
      if (!res.ok) {
        toast({ title: 'ذخیره ترجیحات ناموفق بود', variant: 'destructive' })
        await loadState()
      }
    } finally {
      setSavingEvents(false)
    }
  }

  async function togglePreview(on: boolean) {
    if (!config) return
    setConfig({ ...config, previewEnabled: on })
    const res = await fetch('/api/me/notification-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewEnabled: on, pushEventTypes: config.eventTypes }),
    })
    if (!res.ok) {
      toast({ title: 'ذخیره ترجیحات ناموفق بود', variant: 'destructive' })
      await loadState()
    }
  }

  // ─── محاسبه وضعیت نهایی ───
  const deviceEnabledHere = config?.devices.some((d) => d.deviceId === myDeviceId && d.enabled) ?? false
  const serverGatesOk =
    !!config?.vapidConfigured && config.platformEnabled && (config.schoolEnabled !== false)

  let status: {
    key: 'ACTIVE' | 'OFF' | 'BLOCKED' | 'UNSUPPORTED' | 'SERVER_OFF' | 'PLATFORM_OFF' | 'SCHOOL_OFF'
    label: string
    hint: string
    tone: 'default' | 'secondary' | 'destructive' | 'outline'
  } = {
    key: 'OFF',
    label: 'غیرفعال',
    hint: 'اعلان سیستم‌عاملی روی این دستگاه فعال نیست؛ اعلان‌های درون‌برنامه‌ای همیشه کار می‌کنند.',
    tone: 'secondary',
  }

  if (support && support.state !== 'SUPPORTED' && support.state !== 'PERMISSION_DENIED') {
    status = { key: 'UNSUPPORTED', label: 'پشتیبانی‌نشده', hint: support.browserHint, tone: 'destructive' }
  } else if (support?.state === 'PERMISSION_DENIED') {
    status = {
      key: 'BLOCKED',
      label: 'مسدودشده',
      hint: `${support.browserHint} اعلان درون‌برنامه‌ای همچنان کار می‌کند.`,
      tone: 'destructive',
    }
  } else if (config && !config.vapidConfigured) {
    status = {
      key: 'SERVER_OFF',
      label: 'پیکربندی‌نشده',
      hint: 'کلیدهای VAPID روی سرور تنظیم نشده‌اند؛ با مدیر پلتفرم تماس بگیرید.',
      tone: 'destructive',
    }
  } else if (config && !config.platformEnabled) {
    status = {
      key: 'PLATFORM_OFF',
      label: 'غیرفعال (پلتفرم)',
      hint: 'پوش در سطح پلتفرم توسط مدیر کل غیرفعال شده است.',
      tone: 'destructive',
    }
  } else if (config && config.schoolEnabled === false) {
    status = {
      key: 'SCHOOL_OFF',
      label: 'غیرفعال (مدرسه)',
      hint: 'پوش برای مدرسه شما توسط مدیر کل غیرفعال شده است.',
      tone: 'destructive',
    }
  } else if (config && browserSubscribed && deviceEnabledHere && serverGatesOk) {
    status = {
      key: 'ACTIVE',
      label: 'فعال',
      hint: 'این دستگاه حتی وقتی دانیار باز نیست اعلان دریافت می‌کند (در حد پشتیبانی مرورگر و سیستم‌عامل).',
      tone: 'default',
    }
  }

  const canActivate =
    status.key === 'OFF' ||
    (status.key === 'ACTIVE' && false) // فعال نیازی به دکمه ندارد
  const showActivateButton = status.key === 'OFF'

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4.5 w-4.5 text-primary" />
          اعلان‌های مرورگر (پوش واقعی)
        </CardTitle>
        <CardDescription>
          دریافت اعلان حتی وقتی صفحه دانیار باز نیست — با Web Push و Service Worker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* وضعیت فعلی */}
        <div className="flex items-center justify-between rounded-lg border px-3 py-2.5 gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-2">
              وضعیت این دستگاه:
              <Badge variant={status.tone === 'default' ? 'default' : status.tone} className="gap-1">
                {status.key === 'ACTIVE' ? <BellRing className="h-3 w-3" /> : status.key === 'BLOCKED' ? <ShieldAlert className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                {status.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-5">{status.hint}</p>
          </div>
        </div>

        {/* توضیح محدودیت‌ها — همیشه شفاف */}
        <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground leading-5 flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            دریافت اعلان تضمین‌شده نیست: سیستم‌عامل، حالت صرفه‌جویی باتری، حالت «Focus/Do Not Disturb»،
            مرورگرهای خاص یا بسته‌شدن مرورگر می‌توانند اعلان‌ها را متوقف یا با تأخیر نشان دهند.
            در iOS اعلان وب فقط برای وب‌اپ نصب‌شده (Add to Home Screen؛ iOS 16.4+) کار می‌کند.
            اعلان‌های درون‌برنامه‌ای همیشه و مستقل از این تنظیمات کار می‌کنند.
          </span>
        </div>

        {/* فعال‌سازی / غیرفعال‌سازی */}
        {(showActivateButton || canActivate) && status.key !== 'UNSUPPORTED' && status.key !== 'SERVER_OFF' && status.key !== 'PLATFORM_OFF' && status.key !== 'SCHOOL_OFF' && (
          <Button
            type="button"
            className="w-full gap-2"
            disabled={activating || (support?.state === 'PERMISSION_DENIED')}
            onClick={() => {
              if (support?.state === 'PERMISSION_DENIED') return
              setExplainerOpen(true)
            }}
          >
            {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            فعال‌کردن اعلان‌ها
          </Button>
        )}
        {status.key === 'ACTIVE' && (
          <Button type="button" variant="outline" className="w-full gap-2" onClick={deactivate}>
            <BellOff className="h-4 w-4" />
            غیرفعال‌کردن پوش برای همین دستگاه
          </Button>
        )}

        {/* اعلان آزمایشی */}
        {status.key === 'ACTIVE' && (
          <div className="rounded-lg border px-3 py-2.5 space-y-2">
            <Button type="button" variant="secondary" size="sm" className="w-full gap-2" onClick={sendTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              ارسال اعلان آزمایشی به این دستگاه
            </Button>
            {testResult && (
              <div
                className={`text-xs leading-5 rounded-md px-2.5 py-2 flex gap-1.5 ${
                  testResult.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'
                }`}
              >
                {testResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                <span>
                  {testResult.message}
                  {testResult.errors && testResult.errors.length > 0 && (
                    <span className="block mt-1">{testResult.errors.join(' — ')}</span>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {config && (
          <>
            <Separator />
            {/* پیش‌نمایش پیام */}
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">نمایش پیش‌نمایش متن در اعلان</div>
                <div className="text-xs text-muted-foreground">
                  خاموش = متن خصوصی پیام، بازخورد و وضعیت حضور و غیاب روی صفحه قفل نمایش داده نمی‌شود
                </div>
              </div>
              <Switch
                checked={config.previewEnabled}
                onCheckedChange={togglePreview}
                aria-label="پیش‌نمایش پیام در اعلان"
              />
            </div>

            {/* انواع رویداد */}
            <div className="rounded-lg border px-3 py-2.5">
              <div className="text-sm font-medium mb-1.5">رویدادهای دارای پوش</div>
              <p className="text-xs text-muted-foreground mb-2">
                انتخاب کنید کدام رویدادها برای این حساب پوش بفرستند. بی‌صدایی هر گفتگو مستقل از این بخش است.
              </p>
              <div className={`grid gap-1.5 transition-opacity ${savingEvents ? 'opacity-60' : ''}`}>
                {PUSH_EVENT_CATEGORIES.map((cat) => (
                  <Label
                    key={cat}
                    htmlFor={`push-ev-${cat}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-normal cursor-pointer hover:bg-accent/60"
                  >
                    <Checkbox
                      id={`push-ev-${cat}`}
                      checked={config.eventTypes.includes(cat)}
                      onCheckedChange={(v) => toggleEventType(cat, v === true)}
                      disabled={savingEvents}
                    />
                    {PUSH_EVENT_LABELS[cat]}
                  </Label>
                ))}
              </div>
            </div>

            {/* دستگاه‌ها */}
            <div className="rounded-lg border px-3 py-2.5">
              <div className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
                دستگاه‌های دارای اشتراک فعال
              </div>
              {config.devices.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">هیچ دستگاهی اشتراک فعال ندارد</p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {config.devices.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate flex items-center gap-1.5">
                          {d.label ?? 'دستگاه ناشناس'}
                          {d.deviceId === myDeviceId && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              این دستگاه
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          ثبت: {fmtDate(d.createdAt)}
                        </div>
                      </div>
                      <Switch
                        checked={d.enabled}
                        disabled={busyDevice === d.id}
                        onCheckedChange={(v) => toggleDevice(d, v)}
                        aria-label="پوش این دستگاه"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        disabled={busyDevice === d.id}
                        onClick={() => removeDevice(d)}
                        aria-label="لغو اشتراک دستگاه"
                        title="لغو اشتراک"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>

      {/* توضیح قبل از درخواست مجوز */}
      <Dialog open={explainerOpen} onOpenChange={setExplainerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-primary" />
              فعال‌سازی اعلان‌های دانیار
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm leading-6 pt-1">
                <p>
                  با فعال‌سازی، دانیار از مرورگر اجازه نمایش اعلان می‌گیرد تا پیام خصوصی، پیام گروه،
                  تکلیف، بازخورد، کلاس آنلاین، نمونه‌سؤال و اطلاعیه مدرسه را حتی وقتی صفحه باز نیست
                  نشان دهد.
                </p>
                <p className="text-muted-foreground text-xs leading-5">
                  محدودیت‌ها: نمایش اعلان به پشتیبانی مرورگر و سیستم‌عامل بستگی دارد و همیشه تضمین
                  نمی‌شود (مثلاً حالت صرفه‌جویی باتری یا بسته‌بودن مرورگر). متن خصوصی پیام‌ها به‌صورت
                  پیش‌فرض روی صفحه قفل نشان داده نمی‌شود و فقط با «پیش‌نمایش» فعال می‌شود. می‌توانید
                  هر زمان از همین بخش غیرفعال کنید.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExplainerOpen(false)} disabled={activating}>
              انصراف
            </Button>
            <Button onClick={activate} disabled={activating} className="gap-2">
              {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
              ادامه و درخواست مجوز از مرورگر
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
