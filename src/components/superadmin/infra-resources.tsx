'use client'

/**
 * پنل منابع سرور/کانتینر — نمایش با برچسب منبع (کانتینر / میزبان VPS / محیط پیش‌نمایش)
 * و «در دسترس نیست» صریح برای هر شاخص غیرقابل جمع‌آوری (حدس زده نمی‌شود).
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, Cpu, MemoryStick, HardDrive, Activity, Clock, ShieldAlert } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { faNum } from '@/lib/format'
import type {
  AlertState,
  InfraThresholds,
  ResourcesSnapshot,
} from '@/lib/infra/types'
import { fmtBytes, fmtDuration, Sparkline, fmtBytesRate } from './infra-shared'

export function ResourcesPanel({
  snapshot,
  alerts,
  thresholds,
  stale,
  onThresholdsSaved,
}: {
  snapshot: ResourcesSnapshot | null
  alerts: AlertState[]
  thresholds: InfraThresholds
  stale: boolean
  onThresholdsSaved: (t: InfraThresholds) => void
}) {
  const [cpuT, setCpuT] = useState(String(thresholds.cpuThreshold))
  const [ramT, setRamT] = useState(String(thresholds.ramThreshold))
  const [diskT, setDiskT] = useState(String(thresholds.diskThreshold))
  const [sustained, setSustained] = useState(String(thresholds.sustainedCount))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setCpuT(String(thresholds.cpuThreshold))
    setRamT(String(thresholds.ramThreshold))
    setDiskT(String(thresholds.diskThreshold))
    setSustained(String(thresholds.sustainedCount))
  }, [thresholds])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/superadmin/infrastructure/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cpuThreshold: Number(cpuT),
          ramThreshold: Number(ramT),
          diskThreshold: Number(diskT),
          sustainedCount: Number(sustained),
        }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null
        toast({ title: 'خطا', description: d?.error ?? 'ذخیرهٔ آستانه‌ها ناموفق بود', variant: 'destructive' })
        return
      }
      const d = (await res.json()) as { thresholds: InfraThresholds }
      onThresholdsSaved(d.thresholds)
      toast({ title: 'آستانه‌های هشدار ذخیره شد' })
    } catch {
      toast({ title: 'خطا', description: 'ارتباط با سرور برقرار نشد', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }, [cpuT, ramT, diskT, sustained, onThresholdsSaved])

  const hist = (k: 'cpuPercent' | 'ramPercent' | 'diskPercent') =>
    snapshot ? snapshot.history.map((s) => s[k]) : []

  // دیسک نمایشی: مصرف پوشهٔ آپلود (مرجع رشد نامحدود) — با fallback به دیسک اول
  const uploadDisk = snapshot?.disks.find((d) => d.usedPercent !== null) ?? snapshot?.disks[0]

  const scopeLabel = snapshot?.cpu.scope?.label ?? null
  const activeAlerts = alerts.filter((a) => a.active)

  return (
    <div className="space-y-4">
      {activeAlerts.length > 0 ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 flex items-start gap-2">
          <ShieldAlert className="h-4.5 w-4.5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
          <div className="text-sm space-y-1">
            {activeAlerts.map((a) => (
              <div key={a.metric}>
                <span className="font-medium text-red-700 dark:text-red-400">
                  هشدار پایدار {a.metric === 'cpu' ? 'پردازنده' : a.metric === 'ram' ? 'حافظه' : 'دیسک'}:
                </span>{' '}
                <span className="text-red-700/90 dark:text-red-400/90">
                  مصرف {faNum(a.percent ?? 0)}٪ برای {faNum(a.consecutiveOver)} نمونهٔ متوالی بالای آستانه{' '}
                  {faNum(a.threshold)}٪ بوده است (مصرف لحظه‌ای هشدار نیست).
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* CPU */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" /> پردازنده (CPU)
              </span>
              {stale ? <StaleBadge /> : null}
            </CardTitle>
            {scopeLabel ? <CardDescription className="text-[11px]">منبع: {scopeLabel}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {snapshot ? (
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold tabular-nums">
                    {snapshot.cpu.percent !== null ? faNum(snapshot.cpu.percent) : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground">٪ مصرف لحظه‌ای</span>
                </div>
                <Sparkline values={hist('cpuPercent')} threshold={thresholds.cpuThreshold} className="mt-2" />
                <div className="mt-1.5 text-[11px] text-muted-foreground space-y-0.5">
                  <div>هسته‌های قابل استفاده: {faNum(snapshot.cpu.cores)}</div>
                  {snapshot.cpu.containerCoreLimit ? (
                    <div>سقف کانتینر: {faNum(snapshot.cpu.containerCoreLimit)} هسته</div>
                  ) : null}
                  {snapshot.cpu.load1 !== null ? (
                    <div>بار سیستم (۱ دقیقه): {faNum(Math.round(snapshot.cpu.load1 * 100) / 100)}</div>
                  ) : null}
                </div>
              </>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>

        {/* RAM */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <MemoryStick className="h-4 w-4 text-primary" /> حافظه (RAM)
              </span>
              {stale ? <StaleBadge /> : null}
            </CardTitle>
            {scopeLabel ? <CardDescription className="text-[11px]">منبع: {scopeLabel}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {snapshot ? (
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold tabular-nums">
                    {snapshot.memory.usedPercent !== null ? faNum(snapshot.memory.usedPercent) : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground">٪ مصرف</span>
                </div>
                <Sparkline values={hist('ramPercent')} threshold={thresholds.ramThreshold} className="mt-2" />
                <div className="mt-1.5 text-[11px] text-muted-foreground space-y-0.5">
                  <div>کل: {fmtBytes(snapshot.memory.totalBytes)}</div>
                  <div>مصرف: {fmtBytes(snapshot.memory.usedBytes)}</div>
                  {snapshot.memory.containerLimitBytes ? (
                    <div>سقف کانتینر: {fmtBytes(snapshot.memory.containerLimitBytes)}</div>
                  ) : null}
                  <div>پروسهٔ وب: {fmtBytes(snapshot.memory.processRssBytes)}</div>
                </div>
              </>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>

        {/* دیسک */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" /> دیسک (دیتابیس و آپلود)
              </span>
              {stale ? <StaleBadge /> : null}
            </CardTitle>
            {scopeLabel ? <CardDescription className="text-[11px]">منبع: {scopeLabel}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {snapshot ? (
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold tabular-nums">
                    {uploadDisk?.usedPercent !== null && uploadDisk?.usedPercent !== undefined
                      ? faNum(uploadDisk.usedPercent)
                      : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground">٪ مصرف مسیر آپلود</span>
                </div>
                <Sparkline values={hist('diskPercent')} threshold={thresholds.diskThreshold} className="mt-2" />
                <div className="mt-1.5 text-[11px] text-muted-foreground space-y-0.5">
                  {snapshot.disks.map((d, i) => (
                    <div key={d.path}>
                      {i === 0 ? 'دیتابیس' : 'آپلود'}: {fmtBytes(d.freeBytes)} آزاد از {fmtBytes(d.totalBytes)}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>

        {/* شبکه + uptime */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> شبکه و uptime
              </span>
              {stale ? <StaleBadge /> : null}
            </CardTitle>
            {scopeLabel ? <CardDescription className="text-[11px]">منبع: {scopeLabel}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {snapshot ? (
              <div className="text-[11px] text-muted-foreground space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold tabular-nums text-foreground">
                    {fmtBytesRate(snapshot.network.rxBytesPerSec)}
                  </span>
                  <span>دریابی</span>
                </div>
                <div>ارسال: {fmtBytesRate(snapshot.network.txBytesPerSec)}</div>
                <div className="flex items-center gap-1.5 pt-1">
                  <Clock className="h-3.5 w-3.5" />
                  سرویس وب: {fmtDuration(snapshot.uptime.processSeconds)}
                </div>
                <div>میزبان: {fmtDuration(snapshot.uptime.hostSeconds)}</div>
              </div>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* شاخص‌های دردسترس‌ناپذیر — صادقانه، بدون حدس */}
      {snapshot && snapshot.unavailable.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">شاخص‌های در دسترس‌نیافتنی</CardTitle>
            <CardDescription>
              برای این شاخص‌ها منبع معتیری در این محیط وجود ندارد؛ مقدار حدسی نمایش داده نمی‌شود.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            {snapshot.unavailable.map((u) => (
              <div key={u.metric} className="flex flex-wrap items-baseline gap-1.5">
                <span className="font-medium text-foreground/80">{u.metric}:</span>
                <span>در دسترس نیست — {u.reason}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* آستانه‌های هشدار */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">آستانه‌های هشدار</CardTitle>
          <CardDescription>
            هشدار فقط برای «مصرف پایدار» فعال می‌شود: {faNum(thresholds.sustainedCount)} نمونهٔ متوالی بالای آستانه
            (هر نمونه ≈ یک تازه‌سازی). مصرف لحظه‌ای بالای آستانه، هشدار نیست.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="thr-cpu" className="text-xs">آستانهٔ CPU (٪)</Label>
              <Input id="thr-cpu" inputMode="numeric" value={cpuT} onChange={(e) => setCpuT(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="thr-ram" className="text-xs">آستانهٔ RAM (٪)</Label>
              <Input id="thr-ram" inputMode="numeric" value={ramT} onChange={(e) => setRamT(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="thr-disk" className="text-xs">آستانهٔ دیسک (٪)</Label>
              <Input id="thr-disk" inputMode="numeric" value={diskT} onChange={(e) => setDiskT(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="thr-sustained" className="text-xs">نمونه‌های متوالی</Label>
              <Input id="thr-sustained" inputMode="numeric" value={sustained} onChange={(e) => setSustained(e.target.value)} className="h-8" />
            </div>
          </div>
          <Button onClick={save} disabled={saving} size="sm" className="mt-3">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> ذخیره…
              </>
            ) : (
              'ذخیرهٔ آستانه‌ها'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function StaleBadge() {
  return (
    <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-500/40 text-[10px] whitespace-nowrap">
      داده قدیمی
    </Badge>
  )
}
