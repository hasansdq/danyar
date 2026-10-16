'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Send,
  Loader2,
  MessageSquareText,
  Bell,
  School,
  Layers,
  History,
  ShieldCheck,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { toast } from '@/hooks/use-toast'
import { faNum, faDateTime } from '@/lib/format'

interface SchoolOption {
  id: string
  name: string
}

interface BulkLog {
  id: string
  channel: string
  schoolName: string | null
  classroomName: string | null
  roles: string
  text: string
  total: number
  sent: number
  failed: number
  skipped: number
  ok: boolean
  error: string | null
  createdAt: string
}

const ROLE_OPTIONS = [
  { value: 'STUDENT', label: 'دانش‌آموزان' },
  { value: 'TEACHER', label: 'معلمان' },
  { value: 'SCHOOL_ADMIN', label: 'مدیران مدرسه' },
]

/** ارسال انبوه پیامک/اعلان — فقط مدیر کل، با فیلتر مدرسه/کلاس/نقش و پیش‌شمارش واقعی */
export function AdminBulkClient() {
  const [channel, setChannel] = useState<'sms' | 'push'>('push')
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [schoolId, setSchoolId] = useState('ALL')
  const [classrooms, setClassrooms] = useState<{ id: string; name: string }[]>([])
  const [classroomId, setClassroomId] = useState('ALL')
  const [roles, setRoles] = useState<string[]>(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN'])
  const [smsText, setSmsText] = useState('')
  const [pushTitle, setPushTitle] = useState('')
  const [pushBody, setPushBody] = useState('')
  const [preview, setPreview] = useState<{ total: number; withPhone: number; byRole: Record<string, number> } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; skipped: number; errors: string[]; channel: string } | null>(null)
  const [logs, setLogs] = useState<BulkLog[] | null>(null)

  const loadLogs = useCallback(async () => {
    const res = await fetch('/api/admin/bulk', { cache: 'no-store' })
    if (res.ok) {
      const d = await res.json()
      setLogs(d.logs)
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      // فهرست مدارس از API فیلتر کاربران
      const res = await fetch('/api/admin/users', { method: 'POST' })
      if (res.ok) setSchools((await res.json()).schools)
    })()
    loadLogs()
  }, [loadLogs])

  // کلاس‌های مدرسه انتخابی
  useEffect(() => {
    setClassroomId('ALL')
    setPreview(null)
    if (schoolId === 'ALL') {
      setClassrooms([])
      return
    }
    ;(async () => {
      const res = await fetch(`/api/admin/classrooms?schoolId=${encodeURIComponent(schoolId)}`)
      if (res.ok) setClassrooms((await res.json()).classrooms)
    })()
  }, [schoolId])

  function toggleRole(r: string) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
    setPreview(null)
  }

  function validateFilters(): string | null {
    if (roles.length === 0) return 'حداقل یک نقش باید انتخاب شود'
    return null
  }

  function validateContent(): string | null {
    if (channel === 'sms') {
      if (smsText.trim().length < 2) return 'متن پیامک را وارد کنید'
      if (smsText.trim().length > 500) return 'متن پیامک حداکثر ۵۰۰ کاراکتر است'
    } else {
      if (pushTitle.trim().length < 2) return 'عنوان اعلان را وارد کنید'
      if (pushBody.trim().length > 1000) return 'متن اعلان حداکثر ۱۰۰۰ کاراکتر است'
    }
    return null
  }

  async function doPreview() {
    const err = validateFilters()
    if (err) {
      toast({ title: err, variant: 'destructive' })
      return
    }
    setPreviewing(true)
    try {
      const res = await fetch('/api/admin/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          dryRun: true,
          roles,
          schoolId: schoolId === 'ALL' ? null : schoolId,
          classroomId: classroomId === 'ALL' ? null : classroomId,
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast({ title: d.error ?? 'شمارش مخاطبان ناموفق بود', variant: 'destructive' })
        return
      }
      setPreview(d)
    } finally {
      setPreviewing(false)
    }
  }

  async function doSend() {
    const ferr = validateFilters()
    const cerr = validateContent()
    const err = ferr ?? cerr
    if (err) {
      toast({ title: err, variant: 'destructive' })
      setConfirmOpen(false)
      return
    }
    try {
      const payload: Record<string, unknown> = {
        channel,
        dryRun: false,
        roles,
        schoolId: schoolId === 'ALL' ? null : schoolId,
        classroomId: classroomId === 'ALL' ? null : classroomId,
      }
      if (channel === 'sms') payload.text = smsText.trim()
      else {
        payload.title = pushTitle.trim()
        payload.body = pushBody.trim()
      }
      const res = await fetch('/api/admin/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (!res.ok) {
        toast({ title: d.error ?? 'ارسال ناموفق بود', variant: 'destructive' })
        return
      }
      setResult({ sent: d.sent, failed: d.failed, skipped: d.skipped, errors: d.errors ?? [], channel })
      toast({
        title: channel === 'sms' ? 'ارسال پیامک انجام شد' : 'اعلان برای مخاطبان ثبت شد',
        description: `${faNum(d.sent)} موفق — ${faNum(d.failed)} ناموفق${d.skipped ? ` — ${faNum(d.skipped)} بدون شماره` : ''}`,
      })
      setConfirmOpen(false)
      await loadLogs()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Send className="h-5 w-5 text-primary" />
          ارسال انبوه
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          پیامک یا اعلان برای گروهی از کاربران با فیلتر مدرسه، کلاس و نقش
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">مقصد و محتوا</CardTitle>
          <CardDescription>
            فقط کاربران فعال دریافت می‌کنند؛ مخاطبان دقیقاً قبل از ارسال شمرده می‌شوند
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* کانال */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'push' as const, label: 'اعلان دانیار', icon: Bell, hint: 'اعلان درون‌برنامه‌ای + پوش مرورگر' },
              { key: 'sms' as const, label: 'پیامک', icon: MessageSquareText, hint: 'با سرویس پیامکی پیکربندی‌شده' },
            ].map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  setChannel(c.key)
                  setPreview(null)
                }}
                className={`rounded-lg border px-3 py-3 text-start transition-colors ${
                  channel === c.key
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-accent/60'
                }`}
                aria-pressed={channel === c.key}
              >
                <c.icon className={`h-4.5 w-4.5 mb-1 ${channel === c.key ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-[11px] text-muted-foreground">{c.hint}</div>
              </button>
            ))}
          </div>

          {/* فیلترها */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <School className="h-3.5 w-3.5" />
                مدرسه
              </Label>
              <Select value={schoolId} onValueChange={setSchoolId}>
                <SelectTrigger aria-label="فیلتر مدرسه">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">همه مدارس</SelectItem>
                  {schools.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                کلاس
              </Label>
              <Select value={classroomId} onValueChange={(v) => { setClassroomId(v); setPreview(null) }} disabled={schoolId === 'ALL'}>
                <SelectTrigger aria-label="فیلتر کلاس">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">همه کلاس‌ها</SelectItem>
                  {classrooms.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* نقش‌ها */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">نقش‌های مخاطب</Label>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((r) => (
                <Label
                  key={r.value}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-normal cursor-pointer has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <Checkbox
                    checked={roles.includes(r.value)}
                    onCheckedChange={() => toggleRole(r.value)}
                  />
                  {r.label}
                </Label>
              ))}
            </div>
          </div>

          {/* محتوا */}
          {channel === 'sms' ? (
            <div className="space-y-1.5">
              <Label htmlFor="sms-text">متن پیامک (حداکثر ۵۰۰ کاراکتر)</Label>
              <Textarea
                id="sms-text"
                value={smsText}
                onChange={(e) => setSmsText(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="مثلاً: فردا جلسه اولیای دانش‌آموزان ساعت ۱۰ برگزار می‌شود."
              />
              <div className="text-[11px] text-muted-foreground text-left" dir="ltr">
                {faNum(smsText.length)}/۵۰۰
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="push-title">عنوان اعلان (حداکثر ۱۰۰ کاراکتر)</Label>
                <Input
                  id="push-title"
                  value={pushTitle}
                  onChange={(e) => setPushTitle(e.target.value)}
                  maxLength={100}
                  placeholder="مثلاً: تعطیلی فردا"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="push-body">متن اعلان (اختیاری — حداکثر ۱۰۰۰ کاراکتر)</Label>
                <Textarea
                  id="push-body"
                  value={pushBody}
                  onChange={(e) => setPushBody(e.target.value)}
                  rows={4}
                  maxLength={1000}
                />
              </div>
            </div>
          )}

          {/* پیش‌شمارش */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <Button type="button" variant="outline" onClick={doPreview} disabled={previewing} className="gap-1.5">
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              شمارش مخاطبان
            </Button>
            <Button
              type="button"
              className="gap-1.5"
              disabled={sending || !preview || preview.total === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Send className="h-4 w-4" />
              ارسال
            </Button>
          </div>

          {preview && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm space-y-1">
              <div className="font-medium">
                {faNum(preview.total)} کاربر با این فیلترها یافت شد
                {channel === 'sms' && (
                  <span className="text-muted-foreground text-xs"> — {faNum(preview.withPhone)} نفر شماره ثبت‌شده دارند</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {ROLE_OPTIONS.map((r) => preview.byRole[r.value] ? `${r.label}: ${faNum(preview.byRole[r.value])}` : null)
                  .filter(Boolean)
                  .join(' • ')}
              </div>
            </div>
          )}

          {/* نتیجه ارسال */}
          {result && (
            <div className={`rounded-lg border px-3 py-2.5 text-sm space-y-1 ${result.failed > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5'}`}>
              <div className="font-medium">
                نتیجه واقعی ارسال {result.channel === 'sms' ? 'پیامک' : 'اعلان'}:
                {' '}{faNum(result.sent)} موفق، {faNum(result.failed)} ناموفق
                {result.skipped > 0 && `، ${faNum(result.skipped)} بدون شماره (رد شد)`}
              </div>
              {result.errors.length > 0 && (
                <ul className="text-xs text-muted-foreground list-disc ps-5 space-y-0.5">
                  {result.errors.map((e, i) => (
                    <li key={i} className="truncate">{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* تأیید ارسال */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأیید ارسال انبوه</AlertDialogTitle>
            <AlertDialogDescription>
              {preview
                ? `این ${channel === 'sms' ? 'پیامک' : 'اعلان'} برای ${faNum(preview.total)} کاربر ارسال می‌شود. برای پیامک، هر پیامک از اعتبار سرویس پیامکی مصرف می‌کند.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                doSend()
              }}
              disabled={sending}
              className="gap-1.5"
            >
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              ارسال قطعی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* گزارش‌های اخیر */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4.5 w-4.5 text-primary" />
            گزارش ارسال‌های اخیر
          </CardTitle>
          <CardDescription>۲۰ ارسال آخر — شماره تلفن‌ها ماسک می‌شوند</CardDescription>
        </CardHeader>
        <CardContent>
          {logs === null ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">هنوز ارسال انبوهی ثبت نشده است</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {logs.map((l) => (
                <div key={l.id} className="rounded-lg border px-3 py-2 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Badge variant={l.channel === 'SMS' ? 'secondary' : 'default'}>
                      {l.channel === 'SMS' ? 'پیامک' : 'اعلان'}
                    </Badge>
                    <span className="text-muted-foreground">
                      {l.schoolName ?? 'همه مدارس'}
                      {l.classroomName ? ` — ${l.classroomName}` : ''}
                    </span>
                    <Badge variant={l.ok ? 'outline' : 'destructive'} className="text-[10px]">
                      {l.ok ? 'کامل' : 'با خطا'}
                    </Badge>
                    <span className="text-muted-foreground ms-auto">{faDateTime(l.createdAt)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate" title={l.text}>
                    «{l.text.slice(0, 80)}{l.text.length > 80 ? '…' : ''}»
                  </div>
                  <div className="text-xs">
                    {faNum(l.total)} مخاطب — {faNum(l.sent)} موفق، {faNum(l.failed)} ناموفق
                    {l.skipped > 0 && `، ${faNum(l.skipped)} بدون شماره`}
                    {l.error && <span className="text-destructive"> — {l.error}</span>}
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
