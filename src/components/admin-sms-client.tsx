'use client'

import { useEffect, useState, FormEvent } from 'react'
import {
  MessageSquareText,
  KeyRound,
  Send,
  History,
  Loader2,
  CheckCircle2,
  XCircle,
  Save,
  Info,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { faDateTime } from '@/lib/format'

interface SmsConfig {
  passwordLoginEnabled: boolean
  smsLoginEnabled: boolean
  provider: string
  enabled: boolean
  codeTtlSeconds: number
  resendCooldownSeconds: number
  maxAttemptsPerCode: number
  maxRequestsPerHour: number
  credentials: Record<string, string>
}

interface FieldDef {
  key: string
  label: string
  secret: boolean
  placeholder?: string
  hint?: string
}

const PROVIDER_LABELS: Record<string, string> = {
  '': 'انتخاب نشده',
  smsir: 'SMS.ir',
  melipayamak: 'ملی پیامک',
  farazsms: 'فراز اس‌ام‌اس',
  otpy: 'OTPy (REST سازگار)',
}

const PROVIDER_FIELDS: Record<string, FieldDef[]> = {
  smsir: [
    { key: 'apiKey', label: 'کلید API (x-api-key)', secret: true },
    { key: 'templateId', label: 'شناسه قالب (TemplateId)', secret: false, hint: 'قالب باید متغیر CODE داشته باشد' },
    { key: 'codeParam', label: 'نام متغیر کد در قالب', secret: false, placeholder: 'CODE' },
    { key: 'baseUrl', label: 'آدرس پایه (اختیاری)', secret: false, placeholder: 'https://api.sms.ir/v1' },
  ],
  melipayamak: [
    { key: 'username', label: 'نام کاربری پنل ملی پیامک', secret: true },
    { key: 'password', label: 'رمز عبور پنل', secret: true },
    { key: 'from', label: 'شماره خط ارسال (from)', secret: false, placeholder: '5000... یا 3000... یا 021...', hint: 'شماره خطی که در پنل ملی پیامک به شما اختصاص داده شده است' },
    { key: 'textTemplate', label: 'متن پیام', secret: false, placeholder: 'کد ورود دانیار: {CODE}', hint: 'برای پیامک انبوه، متن آزاد مستقیم ارسال می‌شود — وب‌سرویس رسمی: rest.payamak-panel.com/api/SendSMS/SendSMS' },
    { key: 'baseUrl', label: 'آدرس پایه (اختیاری)', secret: false, placeholder: 'https://rest.payamak-panel.com/api/SendSMS' },
  ],
  farazsms: [
    { key: 'apiKey', label: 'کلید API (apikey)', secret: true },
    { key: 'patternCode', label: 'کد قالب (Pattern)', secret: false },
    { key: 'sender', label: 'شماره فرستنده', secret: false, placeholder: '+983000505' },
    { key: 'varName', label: 'نام متغیر کد در قالب', secret: false, placeholder: 'code' },
    { key: 'baseUrl', label: 'آدرس پایه (اختیاری)', secret: false, placeholder: 'https://api2.ippanel.com/api/v1/sms/pattern/normal' },
  ],
  otpy: [
    { key: 'endpoint', label: 'آدرس کامل سرویس (Endpoint)', secret: false, placeholder: 'https://...' },
    { key: 'headerName', label: 'نام هدر احراز هویت', secret: false, placeholder: 'Authorization' },
    { key: 'headerValue', label: 'مقدار هدر احراز هویت', secret: true },
    {
      key: 'bodyTemplate',
      label: 'بدنه JSON با {{phone}} و {{code}}',
      secret: false,
      placeholder: '{"mobile":"{{phone}}","code":"{{code}}"}',
      hint: 'مستندات رسمی OTPy در دسترس این پیاده‌سازی نبود؛ مقادیر را طبق مستندات خود سرویس وارد کنید — اتصال ساختگی وجود ندارد',
    },
  ],
}

interface SmsLog {
  id: number
  provider: string
  maskedPhone: string
  purpose: string
  ok: boolean
  error: string | null
  createdAt: string
}

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

/** خط دوم نتیجه تست: وضعیت اتصال پنل که سرور جداگانه بررسی می‌کند */
function connLine(conn: { ok: boolean; detail?: string; latencyMs?: number }): string {
  const ms =
    typeof conn.latencyMs === 'number'
      ? ` (${new Intl.NumberFormat('fa-IR').format(conn.latencyMs)} میلی‌ثانیه)`
      : ''
  return ` — بررسی اتصال: ${conn.ok ? 'برقرار' : 'ناموفق'}${conn.detail ? ` — ${conn.detail}` : ''}${ms}`
}

export function AdminSmsClient() {
  const [config, setConfig] = useState<SmsConfig | null>(null)
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [testPhone, setTestPhone] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState<SmsLog[] | null>(null)

  const loadLogs = async () => {
    try {
      const res = await fetch('/api/admin/sms/logs', { cache: 'no-store' })
      if (res.ok) {
        const d = await res.json()
        setLogs(d.logs)
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/admin/sms/config', { cache: 'no-store' })
      if (res.ok) {
        const d = await res.json()
        setConfig(d.config)
        setCreds(d.config.credentials ?? {})
      }
    })()
    loadLogs()
  }, [])

  if (!config) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const fields = PROVIDER_FIELDS[config.provider] ?? []

  const save = async (patch: Partial<SmsConfig> = {}, silent = false) => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { config: { ...config, ...patch } }
      // فیلدهای محرمانه فقط وقتی مقدار جدید وارد شده ارسال می‌شوند
      const credPayload: Record<string, string> = {}
      for (const f of fields) {
        const v = creds[f.key] ?? ''
        if (v && !v.startsWith('••••')) credPayload[f.key] = v
      }
      ;(payload.config as Record<string, unknown>).credentials = credPayload
      const res = await fetch('/api/admin/sms/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        if (!silent) toast({ title: data.error ?? 'ذخیره ناموفق بود', variant: 'destructive' })
        return false
      }
      setConfig(data.config)
      setCreds(data.config.credentials ?? {})
      if (!silent) toast({ title: 'پیکربندی ذخیره شد' })
      return true
    } finally {
      setSaving(false)
    }
  }

  async function runTest(e: FormEvent) {
    e.preventDefault()
    setTestResult(null)
    setTesting(true)
    try {
      // ابتدا ذخیره تا مقدارهای جدید اعمال شوند
      const ok = await save({}, true)
      if (!ok) {
        setTestResult({ ok: false, text: 'ابتدا پیکربندی را ذخیره کنید' })
        return
      }
      const res = await fetch('/api/admin/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizeFaDigits(testPhone) }),
      })
      const data = await res.json().catch(() => ({ error: 'پاسخ نامعتبر از سرور' }))
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          text: `${data.message ?? 'پیامک آزمایشی ارسال شد'} — سرویس: ${PROVIDER_LABELS[data.provider] ?? data.provider} — ${new Intl.NumberFormat('fa-IR').format(data.latencyMs)} میلی‌ثانیه (${data.maskedPhone})`,
        })
      } else {
        const connInfo = data.connection
          ? connLine(data.connection)
          : ''
        setTestResult({
          ok: false,
          text: `ارسال واقعاً ناموفق بود: ${data.error ?? 'خطای نامشخص'}${connInfo}`,
        })
      }
      loadLogs()
    } catch {
      setTestResult({ ok: false, text: 'خطا در برقراری ارتباط با سرور دانیار — اتصال خود را بررسی کنید' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-3 py-4 sm:px-4 space-y-5">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <MessageSquareText className="h-5 w-5 text-primary" />
        ورود پیامکی و سرویس پیامک
      </h1>

      {/* روش‌های ورود کاربران عادی */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4.5 w-4.5 text-primary" />
            روش‌های ورود کاربران
          </CardTitle>
          <CardDescription>
            این کلیدها فقط ورود مدیر مدرسه، معلم و دانش‌آموز را کنترل می‌کنند.
            ورود مدیر کل همیشه با رمز از صفحه مخصوص انجام می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">ورود با نام کاربری و رمز عبور</div>
              <div className="text-xs text-muted-foreground">روش اصلی ورود کاربران عادی</div>
            </div>
            <Switch
              checked={config.passwordLoginEnabled}
              onCheckedChange={(v) => {
                setConfig({ ...config, passwordLoginEnabled: v })
                save({ passwordLoginEnabled: v })
              }}
              aria-label="ورود با رمز عبور"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">ورود با پیامک (کد یک‌بارمصرف)</div>
              <div className="text-xs text-muted-foreground">
                نیازمند سرویس پیامکی پیکربندی‌شده — بدون سرویس فعال، گزینه پیامک خطای واقعی نشان می‌دهد
              </div>
            </div>
            <Switch
              checked={config.smsLoginEnabled}
              onCheckedChange={(v) => {
                setConfig({ ...config, smsLoginEnabled: v })
                save({ smsLoginEnabled: v })
              }}
              aria-label="ورود با پیامک"
            />
          </div>
        </CardContent>
      </Card>

      {/* سرویس پیامک */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">سرویس پیامکی</CardTitle>
          <CardDescription>
            کلیدها و رمزهای سرویس فقط در سرور ذخیره می‌شوند و هرگز به مرورگر یا گزارش‌ها منتقل نمی‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>ارائه‌دهنده</Label>
            <Select
              value={config.provider || 'none'}
              onValueChange={(v) => {
                const provider = v === 'none' ? '' : v
                setConfig({ ...config, provider })
                setCreds({})
                save({ provider })
              }}
            >
              <SelectTrigger aria-label="انتخاب سرویس پیامکی">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">انتخاب نشده</SelectItem>
                <SelectItem value="smsir">SMS.ir</SelectItem>
                <SelectItem value="melipayamak">ملی پیامک</SelectItem>
                <SelectItem value="farazsms">فراز اس‌ام‌اس</SelectItem>
                <SelectItem value="otpy">OTPy (REST سازگار)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {config.provider && (
            <div className="space-y-3">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`cred-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`cred-${f.key}`}
                    dir={f.secret || f.key === 'endpoint' || f.key === 'baseUrl' ? 'ltr' : undefined}
                    className={f.secret || f.key === 'endpoint' || f.key === 'baseUrl' ? 'text-left' : undefined}
                    placeholder={
                      creds[f.key]?.startsWith('••••')
                        ? 'ذخیره شده — برای تغییر مقدار جدید وارد کنید'
                        : f.placeholder
                    }
                    value={creds[f.key] ?? ''}
                    onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                  />
                  {f.hint && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <Info className="h-3 w-3 mt-0.5 shrink-0" />
                      {f.hint}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div className="text-sm font-medium">سرویس فعال باشد</div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => {
                setConfig({ ...config, enabled: v })
                save({ enabled: v })
              }}
              aria-label="فعال بودن سرویس پیامکی"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ttl">اعتبار کد (ثانیه)</Label>
              <Input
                id="ttl"
                type="number"
                min={30}
                max={600}
                value={config.codeTtlSeconds}
                onChange={(e) => setConfig({ ...config, codeTtlSeconds: Number(e.target.value) })}
                onBlur={() => save({ codeTtlSeconds: config.codeTtlSeconds })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cooldown">فاصله ارسال مجدد (ثانیه)</Label>
              <Input
                id="cooldown"
                type="number"
                min={5}
                max={600}
                value={config.resendCooldownSeconds}
                onChange={(e) =>
                  setConfig({ ...config, resendCooldownSeconds: Number(e.target.value) })
                }
                onBlur={() => save({ resendCooldownSeconds: config.resendCooldownSeconds })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attempts">سقف تلاش برای هر کد</Label>
              <Input
                id="attempts"
                type="number"
                min={2}
                max={10}
                value={config.maxAttemptsPerCode}
                onChange={(e) => setConfig({ ...config, maxAttemptsPerCode: Number(e.target.value) })}
                onBlur={() => save({ maxAttemptsPerCode: config.maxAttemptsPerCode })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hourly">سقف درخواست کد در ساعت</Label>
              <Input
                id="hourly"
                type="number"
                min={1}
                max={50}
                value={config.maxRequestsPerHour}
                onChange={(e) => setConfig({ ...config, maxRequestsPerHour: Number(e.target.value) })}
                onBlur={() => save({ maxRequestsPerHour: config.maxRequestsPerHour })}
              />
            </div>
          </div>

          <Button onClick={() => save()} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            ذخیره پیکربندی
          </Button>
        </CardContent>
      </Card>

      {/* ارسال آزمایشی */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4.5 w-4.5 text-primary" />
            ارسال آزمایشی
          </CardTitle>
          <CardDescription>
            پیامک واقعاً از سرویس انتخاب‌شده ارسال می‌شود و نتیجه واقعی (موفقیت یا خطای سرویس) نمایش داده می‌شود.
            گزارش آزمایش شامل کد ورود و شماره کامل نیست.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={runTest} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="testPhone">شماره تلفن دریافت‌کننده</Label>
              <Input
                id="testPhone"
                dir="ltr"
                className="text-left"
                placeholder="09xxxxxxxxx"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={testing || !config.enabled || !config.provider || testPhone.trim().length < 8}
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ارسال آزمایشی'}
            </Button>
            {testResult && (
              <p
                className={
                  'text-sm rounded-md px-3 py-2 flex items-start gap-2 ' +
                  (testResult.ok
                    ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
                    : 'text-destructive bg-destructive/10')
                }
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                {testResult.text}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* گزارش ارسال */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4.5 w-4.5 text-primary" />
            گزارش ارسال‌ها
          </CardTitle>
          <CardDescription>
            شماره‌ها ماسک‌شده‌اند؛ کد ورود و کلیدها در هیچ گزارشی ثبت نمی‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs === null ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">
              هنوز ارسالی ثبت نشده است
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-right px-3 py-2 font-medium">زمان</th>
                    <th className="text-right px-3 py-2 font-medium">سرویس</th>
                    <th className="text-right px-3 py-2 font-medium">شماره</th>
                    <th className="text-right px-3 py-2 font-medium">نوع</th>
                    <th className="text-right px-3 py-2 font-medium">نتیجه</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{faDateTime(l.createdAt)}</td>
                      <td className="px-3 py-2">{PROVIDER_LABELS[l.provider] ?? l.provider}</td>
                      <td className="px-3 py-2" dir="ltr">{l.maskedPhone}</td>
                      <td className="px-3 py-2">{l.purpose === 'TEST' ? 'آزمایشی' : 'ورود'}</td>
                      <td className="px-3 py-2">
                        {l.ok ? (
                          <span className="text-emerald-600 dark:text-emerald-400">موفق</span>
                        ) : (
                          <span
                            className="text-destructive"
                            title={l.error ?? undefined}
                          >
                            ناموفق
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
