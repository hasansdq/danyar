'use client'

import { useCallback, useEffect, useState, FormEvent } from 'react'
import {
  Sparkles,
  Loader2,
  PlugZap,
  CheckCircle2,
  XCircle,
  Save,
  School as SchoolIcon,
  BarChart3,
  ShieldCheck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { faNum, faDateTime } from '@/lib/format'

interface AiConfig {
  provider: string
  baseUrl: string
  model: string
  enabled: boolean
  generalInstruction: string
  managerInstruction: string
  maxToolCalls: number
  hasApiKey: boolean
  apiKeyLast4: string | null
}

interface SchoolAi {
  id: string
  name: string
  isActive: boolean
  aiEnabled: boolean
  managerEnabled: boolean
  dailyMessageLimit: number | null
  messagesToday: number
  messagesTotal: number
  errorsToday: number
  errorsTotal: number
  lastErrorAt: string | null
  lastErrorType: string | null
}

interface AiStats {
  today: { ok: number; error: number }
  total: { ok: number; error: number }
  recentErrors: {
    id: number
    at: string
    errorType: string | null
    provider: string | null
    model: string | null
    schoolName: string | null
  }[]
}

interface TestResult {
  ok: boolean
  latencyMs?: number
  reply?: string
  error?: string
  model?: string
  provider?: string
}

const ERROR_TYPE_FA: Record<string, string> = {
  CONFIG_MISSING: 'پیکربندی ناقص',
  DISABLED_GLOBAL: 'غیرفعال سراسری',
  DISABLED_SCHOOL: 'غیرفعال برای مدرسه',
  ROLE_NOT_ALLOWED: 'نقش غیرمجاز',
  SCHOOL_INACTIVE: 'مدرسه غیرفعال',
  QUOTA_EXHAUSTED: 'پایان سهمیه',
  PROVIDER_ERROR: 'خطای سرویس‌دهنده',
  TIMEOUT: 'اتمام مهلت',
  ABORTED: 'توقف توسط کاربر',
  BUSY: 'درحال‌تولید قبلی',
}

function errorTypeFa(t: string | null): string {
  if (!t) return '—'
  return ERROR_TYPE_FA[t] ?? t
}

export function AdminAiClient() {
  const [cfg, setCfg] = useState<AiConfig | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [schools, setSchools] = useState<SchoolAi[] | null>(null)
  const [stats, setStats] = useState<AiStats | null>(null)

  const loadConfig = useCallback(async () => {
    const res = await fetch('/api/admin/ai/config', { cache: 'no-store' })
    if (res.ok) setCfg((await res.json()).config)
  }, [])

  const loadSchools = useCallback(async () => {
    const res = await fetch('/api/admin/ai/schools', { cache: 'no-store' })
    if (res.ok) setSchools((await res.json()).schools)
  }, [])

  const loadStats = useCallback(async () => {
    const res = await fetch('/api/admin/ai/stats', { cache: 'no-store' })
    if (res.ok) setStats((await res.json()).stats)
  }, [])

  useEffect(() => {
    loadConfig()
    loadSchools()
    loadStats()
  }, [loadConfig, loadSchools, loadStats])

  async function saveConfig(e: FormEvent) {
    e.preventDefault()
    if (!cfg || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/ai/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: cfg.provider,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          enabled: cfg.enabled,
          generalInstruction: cfg.generalInstruction,
          managerInstruction: cfg.managerInstruction,
          maxToolCalls: cfg.maxToolCalls,
          // کلید فقط در صورت ورود مقدار جدید ارسال می‌شود
          ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ذخیره ناموفق بود', variant: 'destructive' })
        return
      }
      setCfg(data.config)
      setApiKeyInput('')
      toast({ title: 'تنظیمات دستیار ذخیره شد' })
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/admin/ai/test', { method: 'POST' })
      const data = await res.json()
      setTestResult(data)
      if (data.ok) {
        toast({ title: `اتصال برقرار شد (${faNum(data.latencyMs ?? 0)} میلی‌ثانیه)` })
      } else {
        toast({ title: 'اتصال ناموفق — نتیجه واقعی نمایش داده شد', variant: 'destructive' })
      }
      loadStats()
    } finally {
      setTesting(false)
    }
  }

  async function updateSchool(s: SchoolAi, patch: Partial<Pick<SchoolAi, 'aiEnabled' | 'managerEnabled' | 'dailyMessageLimit'>>) {
    const res = await fetch('/api/admin/ai/schools', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, ...patch }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: data.error ?? 'ذخیره ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: `تنظیمات دستیار «${s.name}» ذخیره شد` })
    loadSchools()
  }

  if (!cfg) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-500" />
          دستیار هوش مصنوعی
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          پیکربندی سرویس، آزمایش اتصال، فعال‌سازی برای مدارس و نقش‌ها، سهمیه مصرف و آمار
        </p>
      </div>

      {/* پیکربندی سرویس */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">سرویس‌دهنده هوش مصنوعی</CardTitle>
          <CardDescription>
            درخواست‌ها از سرور برنامه ارسال می‌شوند؛ کلید API فقط سمت سرور نگهداری می‌شود و در هیچ پاسخ یا لاگی نمایش داده نمی‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveConfig} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>ارائه‌دهنده</Label>
                <Select
                  value={cfg.provider}
                  onValueChange={(v) => setCfg({ ...cfg, provider: v })}
                >
                  <SelectTrigger aria-label="ارائه‌دهنده">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI (و سرویس‌های سازگار)</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>مدل</Label>
                <Input
                  value={cfg.model}
                  onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                  placeholder={cfg.provider === 'openai' ? 'مثلاً gpt-4o-mini' : 'مثلاً claude-3-5-haiku-20241022'}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label>آدرس اتصال (Base URL) — اختیاری</Label>
                <Input
                  value={cfg.baseUrl}
                  onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                  placeholder={cfg.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'}
                  dir="ltr"
                />
                <p className="text-[11px] text-muted-foreground">
                  خالی = آدرس رسمی سرویس. برای سرویس‌های سازگار (دروگاه شرکتی یا سرویس داخلی) آدرس پایه را وارد کنید.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>کلید API</Label>
                <Input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={cfg.hasApiKey ? `ذخیره شده (پایان: ${cfg.apiKeyLast4}) — برای تغییر مقدار جدید وارد کنید` : 'کلید سرویس‌دهنده'}
                  dir="ltr"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>دستورالعمل عمومی دستیار</Label>
              <Textarea
                value={cfg.generalInstruction}
                onChange={(e) => setCfg({ ...cfg, generalInstruction: e.target.value })}
                placeholder="قواعد کلی رفتار دستیار برای همه نقش‌ها (فارسی)…"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>دستورالعمل نقش «مدیر مدرسه»</Label>
              <Textarea
                value={cfg.managerInstruction}
                onChange={(e) => setCfg({ ...cfg, managerInstruction: e.target.value })}
                placeholder="تمرکز و سبک پاسخ مخصوص مدیر مدرسه…"
                rows={3}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
                <div>
                  <div className="text-sm font-medium">دستیار در کل پلتفرم فعال باشد</div>
                  <div className="text-[11px] text-muted-foreground">
                    علاوه بر این، فعال‌سازی هر مدرسه و نقش هم لازم است
                  </div>
                </div>
              </label>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">بیشینه دور ابزار در هر پاسخ:</Label>
                <Input
                  type="number"
                  min={0}
                  max={8}
                  value={cfg.maxToolCalls}
                  onChange={(e) => setCfg({ ...cfg, maxToolCalls: Math.max(0, Math.min(8, Number(e.target.value) || 0)) })}
                  className="w-16 h-8 text-center"
                  aria-label="بیشینه دور ابزار"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit" disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                ذخیره تنظیمات
              </Button>
              <Button type="button" variant="outline" onClick={testConnection} disabled={testing} className="gap-1.5">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                آزمایش اتصال
              </Button>
            </div>
          </form>

          {/* نتیجه واقعی آزمایش */}
          {testResult && (
            <div
              className={`mt-4 rounded-xl border p-3.5 text-sm space-y-1.5 ${
                testResult.ok
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-destructive/10 border-destructive/30'
              }`}
            >
              <div className={`flex items-center gap-2 font-medium ${testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                {testResult.ok ? <CheckCircle2 className="h-4.5 w-4.5" /> : <XCircle className="h-4.5 w-4.5" />}
                {testResult.ok
                  ? `اتصال واقعی برقرار شد — ${faNum(testResult.latencyMs ?? 0)} میلی‌ثانیه`
                  : 'اتصال واقعی ناموفق بود'}
              </div>
              {testResult.ok ? (
                <p className="text-muted-foreground text-[13px] leading-6">
                  پاسخ مدل «{testResult.model}»: {testResult.reply}
                </p>
              ) : (
                <p className="text-destructive/90 text-[13px] leading-6 break-words">{testResult.error}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* آمار مصرف */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4.5 w-4.5 text-primary" />
            آمار مصرف و خطاها
          </CardTitle>
          <CardDescription>
            فقط شمارنده‌ها است؛ متن گفتگوهای خصوصی کاربران در دسترس نیست و نمایش داده نمی‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat label="پاسخ امروز" value={stats.today.ok} />
                <MiniStat label="خطای امروز" value={stats.today.error} warn />
                <MiniStat label="کل پاسخ‌ها" value={stats.total.ok} />
                <MiniStat label="کل خطاها" value={stats.total.error} warn />
              </div>
              {stats.recentErrors.length > 0 && (
                <div className="mt-4">
                  <div className="text-sm font-medium mb-2">آخرین خطاها</div>
                  <div className="divide-y rounded-lg border">
                    {stats.recentErrors.slice(0, 8).map((e) => (
                      <div key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                        <Badge variant="destructive" className="text-[10px]">
                          {errorTypeFa(e.errorType)}
                        </Badge>
                        <span className="text-muted-foreground">{faDateTime(e.at)}</span>
                        {e.schoolName && <span>{e.schoolName}</span>}
                        {e.model && <span className="text-muted-foreground" dir="ltr">{e.model}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* تنظیم مدارس */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <SchoolIcon className="h-4.5 w-4.5 text-primary" />
            فعال‌سازی برای مدارس و نقش‌ها
          </CardTitle>
          <CardDescription>
            دستیار تنها برای نقش مدیر مدرسه در دسترس است؛ برای هر مدرسه جداگانه فعال می‌شود و سهمیه پیام روزانه به ازای هر کاربر تعیین می‌کند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {schools === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : schools.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">هنوز مدرسه‌ای ایجاد نشده است.</p>
          ) : (
            <div className="divide-y">
              {schools.map((s) => (
                <div key={s.id} className="py-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{s.name}</span>
                        {!s.isActive && <Badge variant="secondary" className="text-[10px]">مدرسه غیرفعال</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        امروز: {faNum(s.messagesToday)} پاسخ{faNum(s.errorsToday) !== '۰' ? ` • ${faNum(s.errorsToday)} خطا` : ''}
                        {' • '}کل: {faNum(s.messagesTotal)} پاسخ
                        {s.lastErrorType && ` • آخرین خطا: ${errorTypeFa(s.lastErrorType)}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                          checked={s.managerEnabled}
                          onCheckedChange={(v) => updateSchool(s, { managerEnabled: v })}
                          aria-label={`دستیار برای نقش مدیر مدرسه در ${s.name}`}
                        />
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          نقش مدیر مدرسه
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                          checked={s.aiEnabled}
                          onCheckedChange={(v) => updateSchool(s, { aiEnabled: v })}
                          aria-label={`دستیار ${s.name}`}
                        />
                        <span className="text-xs font-medium">{s.aiEnabled ? 'فعال' : 'غیرفعال'}</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ps-0 sm:ps-8">
                    <Label className="text-xs text-muted-foreground shrink-0">سهمیه پیام روزانه هر کاربر:</Label>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      defaultValue={s.dailyMessageLimit ?? ''}
                      placeholder='بدون محدودیت'
                      className="w-24 h-8 text-center"
                      aria-label={`سهمیه روزانه ${s.name}`}
                      onBlur={(e) => {
                        const raw = e.target.value.trim()
                        const val = raw === '' ? null : Number(raw)
                        if (val !== s.dailyMessageLimit) updateSchool(s, { dailyMessageLimit: val })
                      }}
                    />
                    <span className="text-[11px] text-muted-foreground">خالی = بدون محدودیت</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MiniStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warn && value > 0 ? 'bg-destructive/5 border-destructive/30' : ''}`}>
      <div className={`text-xl font-bold ${warn && value > 0 ? 'text-destructive' : ''}`}>{faNum(value)}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}
