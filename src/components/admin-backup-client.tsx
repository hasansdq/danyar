'use client'

/**
 * پنل «بکاپ گیری و ایمپورت» (درخواست کاربر):
 *  - بکاپ انتخابی و جداگانه: کاربران، رسانه‌ها، گفتگوها، … یا «کل سایت»
 *    → دانلود فایل JSON (رسانه‌ها با خود فایل‌ها)
 *  - ایمپورت: انتخاب فایل بکاپ + حالت ادغام/جایگزینی → گزارش شمارشی
 *  - رونوشت امنیتی: کدهای یکبارمصرف ورود هرگز وارد بکاپ نمی‌شوند
 */

import { useMemo, useRef, useState } from 'react'
import {
  DatabaseBackup,
  Download,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileJson,
  ShieldCheck,
  RotateCcw,
  PlusCircle,
  PencilLine,
  Ban,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface SectionLite {
  key: string
  label: string
  hint: string
}

interface ModelReport {
  inserted: number
  updated: number
  skipped: number
}

interface SectionReport {
  inserted: number
  updated: number
  skipped: number
  models: Record<string, ModelReport>
}

interface ImportResult {
  ok: boolean
  mode: 'merge' | 'replace'
  backupCreatedAt: string | null
  report: Record<string, SectionReport>
  labels: Record<string, string>
  filesRestored: number
}

const MODEL_FA: Record<string, string> = {
  school: 'مدارس',
  user: 'کاربران',
  vicePermission: 'دسترسی معاون‌ها',
  classroom: 'کلاس‌ها',
  classroomEnrollment: 'ثبت‌نام دانش‌آموزان',
  subjectGroup: 'گروه‌ها',
  teachingAssignment: 'انتساب معلمان',
  groupMemberOverride: 'عضویت دستی',
  upload: 'فایل‌ها',
  message: 'پیام‌ها',
  groupReadState: 'وضعیت خواندن',
  mutedChat: 'بی‌صدایی‌ها',
  attendanceSession: 'جلسات حضور و غیاب',
  attendanceRecord: 'رکوردهای حضور',
  attendanceEditLog: 'ویرایش‌های حضور',
  studentViolation: 'تخلفات',
  classEvent: 'رویدادهای تقویم',
  assignment: 'تکالیف',
  assignmentSubmission: 'پاسخ تکالیف',
  notification: 'اعلان‌ها',
  notificationPref: 'تنظیمات اعلان',
  sampleQuestion: 'نمونه‌سؤالات',
  sampleQuestionClass: 'کلاس‌های نمونه‌سؤال',
  sampleQuestionFile: 'فایل‌های نمونه‌سؤال',
  sampleQuestionBookmark: 'نشان‌گذاری‌ها',
  aiConfig: 'تنظیمات AI',
  aiSchoolSetting: 'تنظیمات AI مدرسه',
  aiConversation: 'گفتگوهای AI',
  aiMessage: 'پیام‌های AI',
  liveSession: 'جلسات زنده',
  liveChatMessage: 'گفتگوی زنده',
  liveParticipantLog: 'حضور زنده',
  smsSendLog: 'گزارش پیامک',
  pushSubscription: 'دستگاه‌های پوش',
  pushDelivery: 'تحویل پوش',
  impersonationLog: 'جعل هویت',
  bulkSendLog: 'ارسال انبوه',
  aiUsageLog: 'مصرف AI',
  infraEventLog: 'رویداد زیرساخت',
  platformSetting: 'تنظیمات پلتفرم',
  mediaSetting: 'سیاست رسانه',
  smsConfig: 'تنظیمات پیامک',
  pushConfig: 'تنظیمات پوش',
  infraSetting: 'زیرساخت',
}

export function AdminBackupClient({ sections }: { sections: SectionLite[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(['users']))
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isFull = useMemo(
    () => sections.length > 0 && selected.size === sections.length,
    [selected, sections],
  )

  function toggleSection(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === sections.length ? new Set() : new Set(sections.map((s) => s.key))))
  }

  async function onExport() {
    if (selected.size === 0) {
      toast.error('حداقل یک بخش انتخاب کنید')
      return
    }
    setExporting(true)
    try {
      const sectionsParam = isFull ? 'all' : [...selected].join(',')
      const res = await fetch(`/api/admin/backup?sections=${encodeURIComponent(sectionsParam)}`)
      const ct = res.headers.get('content-type') ?? ''
      if (!res.ok || !ct.includes('json')) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? 'بکاپ‌گیری ناموفق بود')
        return
      }
      const blob = await res.blob()
      const dispo = res.headers.get('content-disposition') ?? ''
      const match = dispo.match(/filename="([^"]+)"/)
      const fileName = match?.[1] ?? 'daniar-backup.json'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast.success(`بکاپ «${isFull ? 'کل سایت' : [...selected].length + ' بخش'}» دانلود شد`)
    } catch {
      toast.error('خطا در دریافت بکاپ')
    } finally {
      setExporting(false)
    }
  }

  async function onImport() {
    if (!file) {
      toast.error('فایل بکاپ را انتخاب کنید')
      return
    }
    if (importMode === 'replace') {
      const ok = window.confirm(
        'حالت «جایگزینی» داده‌های فعلی همین بخش‌ها را حذف و از بکاپ بازسازی می‌کند — مطمئن هستید؟',
      )
      if (!ok) return
    }
    setImporting(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', importMode)
      const res = await fetch('/api/admin/backup/import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error ?? 'ایمپورت ناموفق بود', {
          description: data?.detail,
        })
        return
      }
      setResult(data)
      toast.success('ایمپورت با موفقیت انجام شد')
    } catch {
      toast.error('خطا در ارسال فایل')
    } finally {
      setImporting(false)
    }
  }

  const totalRows =
    result &&
    Object.values(result.report).reduce((sum, r) => sum + r.inserted + r.updated, 0)

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      {/* هدر */}
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <DatabaseBackup className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold">بکاپ گیری و ایمپورت</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            بکاپ انتخابی از هر بخش سایت + بازگردانی از فایل بکاپ
          </p>
        </div>
      </div>

      {/* ─── بکاپ‌گیری ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4.5 w-4.5 text-primary" />
            بکاپ‌گیری از سایت
          </CardTitle>
          <CardDescription>
            بخش‌های دلخواه را جداگانه انتخاب کنید یا همه را یکجا — خروجی فایل JSON است و
            رسانه‌ها همراه خود فایل‌ها ذخیره می‌شوند
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Label className="text-sm font-medium">بخش‌های بکاپ:</Label>
            <div className="flex items-center gap-2">
              <Badge variant={isFull ? 'default' : 'secondary'} className="gap-1">
                {selected.size} از {sections.length} بخش
              </Badge>
              <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
                {isFull ? 'پاک‌کردن انتخاب‌ها' : 'انتخاب کل سایت'}
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="بخش‌های بکاپ">
            {sections.map((s) => {
              const on = selected.has(s.key)
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleSection(s.key)}
                  aria-pressed={on}
                  className={cn(
                    'rounded-xl border p-3 text-start transition-all duration-150',
                    on
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'bg-card hover:bg-accent/40 hover:scale-[1.01]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        'h-4.5 w-4.5 rounded border flex items-center justify-center shrink-0',
                        on ? 'bg-primary border-primary text-primary-foreground' : 'border-input',
                      )}
                    >
                      {on && <CheckCircle2 className="h-3.5 w-3.5" />}
                    </div>
                    <span className="text-sm font-bold">{s.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed ps-6.5">
                    {s.hint}
                  </p>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-3 pt-1 flex-wrap">
            <Button onClick={onExport} disabled={exporting || selected.size === 0} className="gap-2">
              {exporting ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Download className="h-4.5 w-4.5" />}
              {exporting
                ? 'در حال ساخت بکاپ…'
                : isFull
                  ? 'دانلود بکاپ کل سایت'
                  : `دانلود بکاپ (${selected.size} بخش)`}
            </Button>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              کدهای یکبارمصرف ورود به دلایل امنیتی وارد بکاپ نمی‌شوند
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ─── ایمپورت ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4.5 w-4.5 text-primary" />
            ایمپورت بکاپ
          </CardTitle>
          <CardDescription>
            فایل بکاپ دانیار را انتخاب کنید — بازگردانی داخل یک تراکنش اتمیک انجام می‌شود و
            در صورت خطا هیچ تغییری اعمال نمی‌شود
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={importMode}
            onValueChange={(v) => setImportMode(v as 'merge' | 'replace')}
            className="grid gap-2 sm:grid-cols-2"
          >
            <Label
              htmlFor="mode-merge"
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors',
                importMode === 'merge' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent/40',
              )}
            >
              <RadioGroupItem value="merge" id="mode-merge" className="mt-0.5" />
              <div>
                <div className="text-sm font-bold">ادغام (پیش‌فرض و امن)</div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  رکوردهای موجود به‌روزرسانی و رکوردهای جدید اضافه می‌شوند — چیزی حذف نمی‌شود
                </p>
              </div>
            </Label>
            <Label
              htmlFor="mode-replace"
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors',
                importMode === 'replace'
                  ? 'border-amber-500 bg-amber-500/5 ring-1 ring-amber-500'
                  : 'hover:bg-accent/40',
              )}
            >
              <RadioGroupItem value="replace" id="mode-replace" className="mt-0.5" />
              <div>
                <div className="text-sm font-bold flex items-center gap-1.5">
                  جایگزینی
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  داده‌های فعلی همین بخش‌ها حذف و از بکاپ بازسازی می‌شود — وابستگی‌هایشان هم
                  پاک می‌شود
                </p>
              </div>
            </Label>
          </RadioGroup>

          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setResult(null)
              }}
            />
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
              <FileJson className="h-4.5 w-4.5" />
              {file ? 'تغییر فایل' : 'انتخاب فایل بکاپ'}
            </Button>
            {file && (
              <span className="text-sm text-muted-foreground truncate max-w-[240px]">
                {file.name} ({(file.size / 1024).toFixed(1)} کیلوبایت)
              </span>
            )}
            <Button onClick={onImport} disabled={importing || !file} className="gap-2">
              {importing ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <RotateCcw className="h-4.5 w-4.5" />}
              {importing ? 'در حال ایمپورت…' : 'شروع ایمپورت'}
            </Button>
          </div>

          {/* گزارش ایمپورت */}
          {result && (
            <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                <b>ایمپورت انجام شد</b>
                <Badge variant="secondary">{result.mode === 'merge' ? 'ادغام' : 'جایگزینی'}</Badge>
                <span className="text-muted-foreground text-xs">
                  {totalRows} رکورد اعمال شد
                  {result.filesRestored > 0 && ` · ${result.filesRestored} فایل رسانه بازگردانده شد`}
                </span>
              </div>
              <div className="max-h-96 overflow-y-auto space-y-2.5">
                {Object.entries(result.report).map(([key, sec]) => (
                  <div key={key} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-sm font-bold">{result.labels[key] ?? key}</div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15">
                          <PlusCircle className="h-3 w-3" /> {sec.inserted}
                        </Badge>
                        <Badge variant="secondary" className="gap-1">
                          <PencilLine className="h-3 w-3" /> {sec.updated}
                        </Badge>
                        {sec.skipped > 0 && (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <Ban className="h-3 w-3" /> {sec.skipped} رد شده
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      رد‌شده‌ها = وابستگی‌شان در این بکاپ نبود یا با رکورد دیگری تداخل داشتند
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
