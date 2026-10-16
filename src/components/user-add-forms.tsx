'use client'

/**
 * فرم‌های مشترک افزودن کاربر (درخواست کاربر — مرحله مدیریت کاربران):
 *  ۱) افزودن گروهی دانش‌آموزان — بالای صفحه، لیست خالی قابل گسترش با «ثبت کل لیست»
 *  ۲) افزودن کاربر تکی — فیلدها: نام، نام خانوادگی، نقش، کدملی، شماره تماس، کلاس (+مدرسه برای مدیر کل)
 *  ۳) ایمپورت اکسل — انتخاب کلاس قبل از آپلود + دانلود فایل نمونه
 * نام کاربری همه کاربران = کدملی؛ رمز عبور همه = 123456 (پیش‌فرض پلتفرم)
 * scope='school' → پنل مدیر مدرسه (مدرسه از نشست)
 * scope='platform' → پنل مدیر کل (انتخاب مدرسه الزامی؛ نقش مدیر مدرسه هم ممکن است)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Loader2,
  UserPlus,
  UserCheck,
  Users,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  XCircle,
  Info,
  ListPlus,
  GraduationCap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/hooks/use-toast'
import { faNum, roleLabel } from '@/lib/format'
import { toPersianDigits } from '@/lib/school'
import * as XLSX from 'xlsx'

export type AddScope = 'school' | 'platform'

export interface SchoolOption {
  id: string
  name: string
}

interface ClassroomOption {
  id: string
  name: string
}

interface RowResultItem {
  row: number
  fullName: string
  nationalId: string
  role: string
  status: 'ok' | 'error'
  error?: string
}

interface SummaryItem {
  total: number
  valid?: number
  invalid?: number
  created?: number
  failed?: number
  classroom?: string
  school?: string
}

export const DEFAULT_PASS_HINT = 'نام کاربری هر کاربر کدملی او و رمز عبور اولیه ۱۲۳۴۵۶ است'

/** نرمال‌سازی کلید ستون اکسل برای تطبیق انعطاف‌پذیر */
function normCol(v: string): string {
  return v
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** تبدیل ارقام فارسی/عربی به انگلیسی (سمت کلاینت برای نمایش پیش‌نمایش) */
function toEnDigits(v: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹'
  const ar = '٠١٢٣٤٥٦٧٨٩'
  let out = ''
  for (const ch of v) {
    const fi = fa.indexOf(ch)
    if (fi !== -1) {
      out += String(fi)
      continue
    }
    const ai = ar.indexOf(ch)
    if (ai !== -1) {
      out += String(ai)
      continue
    }
    out += ch
  }
  return out
}

/** خواندن و تبدیل فایل اکسل به ردیف‌های افزودن کاربر */
export async function parseUserRowsFromExcel(
  file: File,
): Promise<{ rows: Record<string, string>[]; error?: string }> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { rows: [], error: 'فایل هیچ شیتی ندارد' }
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  const rows = json
    .map((r) => {
      const get = (...keys: string[]) => {
        for (const k of keys) {
          const found = Object.keys(r).find((rk) => normCol(rk) === normCol(k))
          if (found !== undefined) {
            const val = r[found]
            if (val !== '' && val !== null && val !== undefined) return toEnDigits(String(val)).trim()
          }
        }
        return ''
      }

      let firstName = get('نام', 'first name', 'firstname')
      let lastName = get('نام خانوادگی', 'family name', 'lastname', 'surname')
      // سازگاری با فایل‌تک‌ستونی قدیمی: «نام و نام خانوادگی»
      if (!firstName && !lastName) {
        const combined = get('نام و نام خانوادگی', 'full name', 'fullname', 'name')
        if (combined) {
          const sp = combined.indexOf(' ')
          if (sp === -1) {
            firstName = combined
          } else {
            firstName = combined.slice(0, sp)
            lastName = combined.slice(sp + 1).trim()
          }
        }
      }

      return {
        firstName,
        lastName,
        role: get('نقش', 'role'),
        nationalId: get('کدملی', 'کد ملی', 'national id', 'nationalid', 'national code'),
        phone: get('شماره همراه', 'شماره تماس', 'موبایل', 'تلفن همراه', 'همراه', 'phone', 'mobile', 'tel'),
      }
    })
    // ردیف‌های کاملاً خالی حذف می‌شوند
    .filter((r) => r.firstName !== '' || r.lastName !== '' || r.nationalId !== '')

  if (rows.length === 0) {
    return {
      rows,
      error: 'فایل خالی است یا ستون‌ها شناسایی نشدند — ستون‌های لازم: نام، نام خانوادگی، نقش، کدملی، شماره همراه',
    }
  }
  return { rows }
}

/** ساخت و دانلود فایل اکسل نمونه با ستون‌های خواسته‌شده */
export function downloadUserTemplate() {
  const data = [
    {
      'نام': 'علی',
      'نام خانوادگی': 'رضایی',
      'نقش': 'دانش‌آموز',
      'کدملی': '0012345678',
      'شماره همراه': '',
    },
    {
      'نام': 'مریم',
      'نام خانوادگی': 'احمدی',
      'نقش': 'معلم',
      'کدملی': '0098765432',
      'شماره همراه': '',
    },
  ]
  const ws = XLSX.utils.json_to_sheet(data)
  // ستون کدملی و شماره به‌صورت متن تا صفرِ ابتدای کدملی حفظ شود
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (const col of [3, 4]) {
      const addr = XLSX.utils.encode_cell({ r: R, c: col })
      if (ws[addr]) ws[addr].z = '@'
    }
  }
  ws['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 16 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'کاربران')
  XLSX.writeFile(wb, 'daniar-users-template.xlsx')
}

/** هوک خواندن کلاس‌ها — مدرسه‌ای یا کلان (بدون setState همگام در effect) */
function useClassrooms(scope: AddScope, schoolId: string | null) {
  const [state, setState] = useState<{ key: string; data: ClassroomOption[] } | null>(null)
  const key = scope === 'school' ? 'school' : (schoolId ?? '')

  useEffect(() => {
    if (!key) return
    let alive = true
    ;(async () => {
      try {
        const url =
          scope === 'school'
            ? '/api/classes'
            : `/api/admin/classrooms?schoolId=${encodeURIComponent(key)}`
        const res = await fetch(url)
        if (res.ok && alive) {
          const d = await res.json()
          setState({ key, data: (d.classrooms ?? []).map((c: ClassroomOption) => ({ id: c.id, name: c.name })) })
        } else if (alive) {
          setState({ key, data: [] })
        }
      } catch {
        if (alive) setState({ key, data: [] })
      }
    })()
    return () => {
      alive = false
    }
  }, [scope, key])

  return state && state.key === key ? state.data : null
}

/** جدول نتایج per-row مشترک */
function ResultRows({ results }: { results: RowResultItem[] }) {
  return (
    <div className="rounded-xl border max-h-72 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            <th className="p-2 text-right font-medium">ردیف</th>
            <th className="p-2 text-right font-medium">نام</th>
            <th className="p-2 text-right font-medium">کدملی</th>
            <th className="p-2 text-right font-medium">نقش</th>
            <th className="p-2 text-right font-medium">وضعیت</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {results.map((r, i) => (
            <tr key={`${r.row}-${i}`} className={r.status === 'error' ? 'bg-destructive/5' : ''}>
              <td className="p-2">{faNum(r.row)}</td>
              <td className="p-2 max-w-32 truncate">{r.fullName || '—'}</td>
              <td className="p-2" dir="ltr">{r.nationalId || '—'}</td>
              <td className="p-2">{r.role || '—'}</td>
              <td className="p-2">
                {r.status === 'ok' ? (
                  <span className="text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ثبت شد
                  </span>
                ) : (
                  <span className="text-destructive" title={r.error}>
                    <XCircle className="h-3.5 w-3.5 inline shrink-0" /> {r.error}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResultBadges({ summary }: { summary: SummaryItem }) {
  const valid = summary.created ?? summary.valid ?? 0
  const invalid = summary.failed ?? summary.invalid ?? 0
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="secondary">{faNum(summary.total)} ردیف</Badge>
      <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        {faNum(valid)} سالم
      </Badge>
      {invalid > 0 && (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          {faNum(invalid)} خطادار
        </Badge>
      )}
      {summary.classroom && <Badge variant="outline">کلاس: {summary.classroom}</Badge>}
    </div>
  )
}

// ─── انتخاب مدرسه (فقط مدیر کل) ───

function SchoolSelect({
  schools,
  value,
  onChange,
  idPrefix,
}: {
  schools: SchoolOption[]
  value: string
  onChange: (v: string) => void
  idPrefix: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-school`}>مدرسه</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={`${idPrefix}-school`} aria-label="انتخاب مدرسه">
          <SelectValue placeholder="مدرسه را انتخاب کنید…" />
        </SelectTrigger>
        <SelectContent>
          {schools.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** انتخاب کلاس — مشترک بین هر سه فرم */
function ClassroomSelect({
  classrooms,
  value,
  onChange,
  idPrefix,
  allowEmpty = false,
}: {
  classrooms: ClassroomOption[] | null
  value: string
  onChange: (v: string) => void
  idPrefix: string
  allowEmpty?: boolean
}) {
  if (classrooms === null) {
    return (
      <div className="space-y-1.5">
        <Label>کلاس</Label>
        <div className="h-9 rounded-md border flex items-center px-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin me-2" /> در حال خواندن کلاس‌ها…
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-class`}>کلاس</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={`${idPrefix}-class`} aria-label="انتخاب کلاس">
          <SelectValue placeholder={classrooms.length === 0 ? 'کلاسی وجود ندارد' : 'کلاس را انتخاب کنید…'} />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty && <SelectItem value="NONE">بدون کلاس</SelectItem>}
          {classrooms.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {classrooms.length === 0 && (
        <p className="text-[11px] text-amber-600">
          هنوز کلاسی ساخته نشده است؛ ابتدا از بخش «کلاس‌ها» یک کلاس بسازید.
        </p>
      )}
    </div>
  )
}

// ─── ۱) افزودن گروهی دانش‌آموزان ───

interface BulkRow {
  key: number
  firstName: string
  lastName: string
  nationalId: string
  phone: string
}

export function BulkStudentAddForm({
  scope,
  schools = [],
  onDone,
}: {
  scope: AddScope
  schools?: SchoolOption[]
  onDone?: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [schoolId, setSchoolId] = useState('')
  const effectiveSchool = scope === 'school' ? null : schoolId || null
  const classrooms = useClassrooms(scope, effectiveSchool)

  const [classroomId, setClassroomId] = useState('')
  const [rows, setRows] = useState<BulkRow[]>([])
  const keyRef = useMemo(() => ({ current: 0 }), [])
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<RowResultItem[] | null>(null)
  const [summary, setSummary] = useState<SummaryItem | null>(null)

  /** با تغییر مدرسه، کلاس و نتایج ریست شود */
  function changeSchool(v: string) {
    setSchoolId(v)
    setClassroomId('')
    setResults(null)
    setSummary(null)
  }

  const addRow = useCallback(() => {
    keyRef.current += 1
    setRows((prev) => [...prev, { key: keyRef.current, firstName: '', lastName: '', nationalId: '', phone: '' }])
  }, [keyRef])

  function updateRow(key: number, patch: Partial<BulkRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  async function submitAll() {
    if (submitting) return
    const filled = rows.filter((r) => r.firstName.trim() || r.lastName.trim() || r.nationalId.trim())
    if (filled.length === 0) {
      toast({ title: 'لیست خالی است', description: 'حداقل یک ردیف را پر کنید', variant: 'destructive' })
      return
    }
    if (!classroomId) {
      toast({ title: 'کلاس انتخاب نشده است', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      const url = scope === 'school' ? '/api/users/bulk' : '/api/admin/users/bulk'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroomId,
          ...(scope === 'platform' ? { schoolId } : {}),
          rows: filled.map((r) => ({
            firstName: r.firstName.trim(),
            lastName: r.lastName.trim(),
            nationalId: toEnDigits(r.nationalId).trim(),
            phone: toEnDigits(r.phone).trim(),
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ثبت لیست ناموفق بود', variant: 'destructive' })
        return
      }
      setResults(data.results)
      setSummary(data.summary)
      toast({ title: data.message ?? 'لیست ثبت شد' })
      await onDone?.()
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  function resetAll() {
    setRows([])
    setResults(null)
    setSummary(null)
    keyRef.current = 0
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full text-start"
          aria-expanded={open}
        >
          <CardTitle className="text-base flex items-center gap-2">
            <ListPlus className="h-4.5 w-4.5 text-primary" />
            افزودن گروهی دانش‌آموزان
            <span className="ms-auto text-muted-foreground">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </CardTitle>
          <CardDescription>
            لیست دانش‌آموزان را پر کنید و با یک کلیک همه را در کلاس انتخابی ثبت‌نام کنید
          </CardDescription>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            {scope === 'platform' && (
              <SchoolSelect schools={schools} value={schoolId} onChange={changeSchool} idPrefix="bulk" />
            )}
            {(scope === 'school' || schoolId) && (
              <ClassroomSelect
                classrooms={classrooms}
                value={classroomId}
                onChange={setClassroomId}
                idPrefix="bulk"
              />
            )}
          </div>

          {results && summary ? (
            <div className="space-y-3">
              <ResultBadges summary={summary} />
              <ResultRows results={results} />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={resetAll} className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  لیست جدید
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* لیست قابل گسترش دانش‌آموزان */}
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-lg border border-dashed py-6 text-center">
                  لیست خالی است — با دکمه زیر ردیف اضافه کنید
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto] gap-2 text-[11px] text-muted-foreground px-1">
                    <span>نام *</span>
                    <span>نام خانوادگی *</span>
                    <span>کدملی *</span>
                    <span>شماره همراه (اختیاری)</span>
                    <span />
                  </div>
                  {rows.map((r, idx) => (
                    <div
                      key={r.key}
                      className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto] gap-2 items-center"
                    >
                      <Input
                        value={r.firstName}
                        onChange={(e) => updateRow(r.key, { firstName: e.target.value })}
                        placeholder={`نام ${faNum(idx + 1)}`}
                        aria-label={`نام ردیف ${faNum(idx + 1)}`}
                      />
                      <Input
                        value={r.lastName}
                        onChange={(e) => updateRow(r.key, { lastName: e.target.value })}
                        placeholder="نام خانوادگی"
                        aria-label={`نام خانوادگی ردیف ${faNum(idx + 1)}`}
                      />
                      <Input
                        value={r.nationalId}
                        onChange={(e) => updateRow(r.key, { nationalId: e.target.value })}
                        placeholder="کدملی"
                        inputMode="numeric"
                        dir="ltr"
                        className="text-left"
                        aria-label={`کدملی ردیف ${faNum(idx + 1)}`}
                      />
                      <Input
                        value={r.phone}
                        onChange={(e) => updateRow(r.key, { phone: e.target.value })}
                        placeholder="۰۹…"
                        inputMode="tel"
                        dir="ltr"
                        className="text-left"
                        aria-label={`شماره همراه ردیف ${faNum(idx + 1)}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeRow(r.key)}
                        aria-label={`حذف ردیف ${faNum(idx + 1)}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={addRow} className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  افزودن ردیف
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={submitAll}
                  disabled={submitting || rows.length === 0 || (scope === 'platform' && !schoolId) || !classroomId}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  ثبت کل لیست
                </Button>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  {DEFAULT_PASS_HINT}
                </span>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ─── ۲) افزودن کاربر تکی ───

export function SingleAddUserForm({
  scope,
  schools = [],
  onCreated,
}: {
  scope: AddScope
  schools?: SchoolOption[]
  onCreated?: () => void | Promise<void>
}) {
  const [schoolId, setSchoolId] = useState('')
  const effectiveSchool = scope === 'school' ? null : schoolId || null
  const classrooms = useClassrooms(scope, effectiveSchool)

  const [role, setRole] = useState<'STUDENT' | 'TEACHER' | 'SCHOOL_VICE' | 'SCHOOL_ADMIN'>('STUDENT')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [phone, setPhone] = useState('')
  const [classroomId, setClassroomId] = useState('')
  const [creating, setCreating] = useState(false)

  /** تغییر نقش/مدرسه — انتخاب کلاس ریست شود */
  function changeRole(v: string) {
    setRole(v as 'STUDENT' | 'TEACHER' | 'SCHOOL_VICE' | 'SCHOOL_ADMIN')
    setClassroomId('')
  }
  function changeSingleSchool(v: string) {
    setSchoolId(v)
    setClassroomId('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const url = scope === 'school' ? '/api/users' : '/api/admin/users/create'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role,
          nationalId: toEnDigits(nationalId).trim(),
          phone: toEnDigits(phone).trim(),
          classroomId: role === 'STUDENT' ? classroomId : null,
          ...(scope === 'platform' ? { schoolId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد کاربر ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: `${roleLabel(role)} «${data.user.fullName}» ایجاد شد`,
        description: 'نام کاربری: کدملی — رمز عبور: 123456',
      })
      setFirstName('')
      setLastName('')
      setNationalId('')
      setPhone('')
      setClassroomId('')
      await onCreated?.()
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const canSubmit =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    toEnDigits(nationalId).trim().length >= 4 &&
    (scope === 'school' || !!schoolId) &&
    (role !== 'STUDENT' || !!classroomId)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-4.5 w-4.5 text-primary" />
          افزودن کاربر
        </CardTitle>
        <CardDescription>{DEFAULT_PASS_HINT}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <Tabs value={role} onValueChange={changeRole}>
            {scope === 'school' ? (
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="TEACHER" className="gap-1.5">
                  <Users className="h-4 w-4" />
                  معلم
                </TabsTrigger>
                <TabsTrigger value="SCHOOL_VICE" className="gap-1.5">
                  <UserCheck className="h-4 w-4" />
                  معاون مدرسه
                </TabsTrigger>
                <TabsTrigger value="STUDENT" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  دانش‌آموز
                </TabsTrigger>
              </TabsList>
            ) : (
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="STUDENT">دانش‌آموز</TabsTrigger>
                <TabsTrigger value="TEACHER">معلم</TabsTrigger>
                <TabsTrigger value="SCHOOL_VICE">معاون مدرسه</TabsTrigger>
                <TabsTrigger value="SCHOOL_ADMIN">مدیر مدرسه</TabsTrigger>
              </TabsList>
            )}
          </Tabs>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {scope === 'platform' && (
              <SchoolSelect schools={schools} value={schoolId} onChange={changeSingleSchool} idPrefix="single" />
            )}
            <div className="space-y-1.5">
              <Label htmlFor="su-first">نام</Label>
              <Input
                id="su-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="su-last">نام خانوادگی</Label>
              <Input
                id="su-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="su-nid">کدملی</Label>
              <Input
                id="su-nid"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="کدملی ۱۰ رقمی"
                inputMode="numeric"
                dir="ltr"
                className="text-left"
                required
              />
              <p className="text-[11px] text-muted-foreground">همان نام کاربری کاربر خواهد بود</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="su-phone">شماره تماس (اختیاری)</Label>
              <Input
                id="su-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09xxxxxxxxx"
                inputMode="tel"
                dir="ltr"
                className="text-left"
              />
            </div>
            {role === 'STUDENT' && (scope === 'school' || schoolId) && (
              <ClassroomSelect
                classrooms={classrooms}
                value={classroomId}
                onChange={setClassroomId}
                idPrefix="single"
              />
            )}
          </div>

          <Button type="submit" size="sm" className="gap-1.5" disabled={creating || !canSubmit}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            ایجاد {roleLabel(role)}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── ۳) ایمپورت اکسل ───

export function ExcelImportForm({
  scope,
  schools = [],
  onDone,
}: {
  scope: AddScope
  schools?: SchoolOption[]
  onDone?: () => void | Promise<void>
}) {
  const [schoolId, setSchoolId] = useState('')
  const effectiveSchool = scope === 'school' ? null : schoolId || null
  const classrooms = useClassrooms(scope, effectiveSchool)

  const [classroomId, setClassroomId] = useState('')
  const [validating, setValidating] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const [results, setResults] = useState<RowResultItem[] | null>(null)
  const [summary, setSummary] = useState<SummaryItem | null>(null)
  const [committed, setCommitted] = useState(false)

  function resetAll() {
    setRows(null)
    setResults(null)
    setSummary(null)
    setCommitted(false)
  }

  /** تغییر مدرسه — کلاس و فایل ریست شود */
  function changeImportSchool(v: string) {
    setSchoolId(v)
    setClassroomId('')
    resetAll()
  }

  const endpoint = scope === 'school' ? '/api/users/import' : '/api/admin/users/import'

  async function send(commit: boolean, parsedRows: Record<string, string>[]) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: parsedRows,
        classroomId,
        commit,
        ...(scope === 'platform' ? { schoolId } : {}),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'بررسی فایل ناموفق بود')
    return data
  }

  async function handleFile(f: File) {
    if (!classroomId) {
      toast({ title: 'قبل از آپلود، کلاس موردنظر را انتخاب کنید', variant: 'destructive' })
      return
    }
    setValidating(true)
    resetAll()
    try {
      const { rows: parsedRows, error } = await parseUserRowsFromExcel(f)
      if (error) {
        toast({ title: 'فایل قابل خواندن نیست', description: error, variant: 'destructive' })
        return
      }
      setRows(parsedRows)
      const data = await send(false, parsedRows)
      setResults(data.results)
      setSummary(data.summary)
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'خواندن فایل ناموفق بود', variant: 'destructive' })
    } finally {
      setValidating(false)
    }
  }

  async function commitImport() {
    if (!rows || committing) return
    setCommitting(true)
    try {
      const data = await send(true, rows)
      setResults(data.results)
      setSummary(data.summary)
      setCommitted(true)
      toast({ title: `${faNum(data.summary.created)} کاربر ثبت شد` })
      await onDone?.()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'ثبت ناموفق بود', variant: 'destructive' })
    } finally {
      setCommitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4.5 w-4.5 text-primary" />
          ایمپورت از فایل اکسل
        </CardTitle>
        <CardDescription>
          فایل xlsx با ستون‌های «نام، نام خانوادگی، نقش، کدملی، شماره همراه»؛ ابتدا کلاس را انتخاب کنید
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          {scope === 'platform' && (
            <SchoolSelect schools={schools} value={schoolId} onChange={changeImportSchool} idPrefix="imp" />
          )}
          {(scope === 'school' || schoolId) && (
            <ClassroomSelect
              classrooms={classrooms}
              value={classroomId}
              onChange={setClassroomId}
              idPrefix="imp"
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={downloadUserTemplate}
          >
            <Download className="h-4 w-4" />
            دانلود فایل اکسل نمونه
          </Button>
          <div>
            <label
              className={`inline-flex items-center gap-1.5 h-9 rounded-md border px-3 text-sm font-medium cursor-pointer ${
                classroomId ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
            >
              {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              بارگذاری فایل اکسل
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                disabled={!classroomId || validating || committed}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>

        {!classroomId && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" />
            تا زمانی که کلاس انتخاب نکنید، بارگذاری فایل غیرفعال است.
          </p>
        )}

        {validating && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            در حال بررسی فایل…
          </div>
        )}

        {results && summary && (
          <div className="space-y-3">
            <ResultBadges summary={summary} />
            <ResultRows results={results} />
            {committed ? (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                عملیات کامل شد.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={committing || (summary.valid ?? 0) === 0}
                  onClick={commitImport}
                >
                  {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  ثبت {faNum(summary.valid ?? 0)} کاربر سالم
                </Button>
                <Button size="sm" variant="outline" onClick={resetAll}>
                  انتخاب فایل دیگر
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── ۴) ایجاد معلم — فرم مستقل با انتخاب الزامی گروه‌های درسی ───

export interface GroupOption {
  id: string
  name: string
  archivedAt: string | null
  classroomId: string
  classroom: { id: string; name: string }
}

/** فهرست چک‌باکسی گروه‌های درسی — انتخاب چندتایی با جست‌وجو */
export function SubjectGroupPicker({
  groups,
  selected,
  onToggle,
  idPrefix,
  showArchived = false,
}: {
  groups: GroupOption[] | null
  selected: Set<string>
  onToggle: (id: string) => void
  idPrefix: string
  /** در فرم ایجاد، گروه‌های بایگانی نشان داده نمی‌شوند؛ در ویرایش برای حفظ انتساب‌های فعلی نشان داده می‌شوند */
  showArchived?: boolean
}) {
  const [query, setQuery] = useState('')
  const filtered = (groups ?? []).filter((g) => {
    if (!showArchived && g.archivedAt) return false
    if (!query.trim()) return true
    const q = toPersianDigits(query.trim())
    return g.name.includes(q) || g.classroom.name.includes(q)
  })
  const activeCount = (groups ?? []).filter((g) => showArchived || !g.archivedAt).length

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${idPrefix}-group-search`}>گروه‌های درسی</Label>
        <span className="text-[11px] text-muted-foreground">
          {faNum(selected.size)} گروه انتخاب شده
        </span>
      </div>
      <Input
        id={`${idPrefix}-group-search`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="جست‌وجوی گروه یا کلاس…"
        className="h-8"
        aria-label="جست‌وجوی گروه درسی"
      />
      {groups === null ? (
        <div className="h-32 rounded-xl border flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : activeCount === 0 ? (
        <p className="text-xs text-amber-600 rounded-xl border border-dashed py-6 text-center px-3">
          هنوز گروه درسی ایجاد نشده است؛ ابتدا از بخش «گروه‌های درسی» پنل مدیریت، گروه بسازید.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-xl border border-dashed py-6 text-center">
          گروهی با این جست‌وجو یافت نشد.
        </p>
      ) : (
        <div className="rounded-xl border max-h-64 overflow-y-auto divide-y">
          {filtered.map((g) => {
            const checked = selected.has(g.id)
            return (
              <label
                key={g.id}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50 ${checked ? 'bg-primary/5' : ''}`}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => onToggle(g.id)}
                  aria-label={`گروه ${g.name}`}
                />
                <span className="text-sm flex-1 min-w-0 truncate">{g.name}</span>
                {g.archivedAt ? (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    بایگانی‌شده
                  </Badge>
                ) : (
                  <span className="text-[10px] text-muted-foreground shrink-0">{g.classroom.name}</span>
                )}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** فرم مستقل ایجاد معلم — انتخاب گروه‌های درسی معلم الزامی است (درخواست کاربر) */
export function TeacherAddForm({
  scope,
  onCreated,
}: {
  scope: 'school'
  onCreated?: () => void | Promise<void>
}) {
  const [groups, setGroups] = useState<GroupOption[] | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [phone, setPhone] = useState('')
  const [creating, setCreating] = useState(false)

  // گروه‌های درسی مدرسه — برای انتخاب انتساب معلم
  useEffect(() => {
    if (scope !== 'school') return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/groups')
        if (res.ok && alive) {
          const d = await res.json()
          setGroups(d.groups ?? [])
        } else if (alive) setGroups([])
      } catch {
        if (alive) setGroups([])
      }
    })()
    return () => {
      alive = false
    }
  }, [scope])

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: 'TEACHER',
          nationalId: toEnDigits(nationalId).trim(),
          phone: toEnDigits(phone).trim(),
          subjectGroupIds: [...selectedGroups],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد معلم ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: `معلم «${data.user.fullName}» ایجاد شد`,
        description: `نام کاربری: کدملی — رمز عبور: 123456 — ${faNum(selectedGroups.size)} گروه درسی منتسب شد`,
      })
      setFirstName('')
      setLastName('')
      setNationalId('')
      setPhone('')
      setSelectedGroups(new Set())
      await onCreated?.()
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const canSubmit =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    toEnDigits(nationalId).trim().length >= 4 &&
    selectedGroups.size > 0 &&
    !creating

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-4.5 w-4.5 text-primary" />
          ایجاد معلم
        </CardTitle>
        <CardDescription>
          برای هر معلم، گروه‌های درسی او باید انتخاب شوند — نام کاربری کدملی و رمز اولیه ۱۲۳۴۵۶ است
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-first">نام</Label>
              <Input
                id="t-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-last">نام خانوادگی</Label>
              <Input
                id="t-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-nid">کدملی</Label>
              <Input
                id="t-nid"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="کدملی ۱۰ رقمی"
                inputMode="numeric"
                dir="ltr"
                className="text-left"
                required
              />
              <p className="text-[11px] text-muted-foreground">همان نام کاربری معلم خواهد بود</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-phone">شماره تماس (اختیاری)</Label>
              <Input
                id="t-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09xxxxxxxxx"
                inputMode="tel"
                dir="ltr"
                className="text-left"
              />
            </div>
          </div>

          <SubjectGroupPicker
            groups={groups}
            selected={selectedGroups}
            onToggle={toggleGroup}
            idPrefix="teacher"
          />
          {selectedGroups.size === 0 && (
            <p className="text-[11px] text-amber-600 flex items-center gap-1">
              <Info className="h-3 w-3" />
              انتخاب حداقل یک گروه درسی برای ایجاد معلم الزامی است.
            </p>
          )}

          <Button type="submit" size="sm" className="gap-1.5" disabled={!canSubmit}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            ایجاد معلم
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/** فرم مستقل ایجاد معاون مدرسه — گروه‌های درسی اختیاری است (معاون لزوماً درس تدریس نمی‌کند) */
export function ViceAddForm({
  scope,
  onCreated,
}: {
  scope: 'school'
  onCreated?: () => void | Promise<void>
}) {
  const [groups, setGroups] = useState<GroupOption[] | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [phone, setPhone] = useState('')
  const [creating, setCreating] = useState(false)

  // گروه‌های درسی مدرسه — برای انتساب اختیاری معاون
  useEffect(() => {
    if (scope !== 'school') return
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/groups')
        if (res.ok && alive) {
          const d = await res.json()
          setGroups(d.groups ?? [])
        } else if (alive) setGroups([])
      } catch {
        if (alive) setGroups([])
      }
    })()
    return () => {
      alive = false
    }
  }, [scope])

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: 'SCHOOL_VICE',
          nationalId: toEnDigits(nationalId).trim(),
          phone: toEnDigits(phone).trim(),
          subjectGroupIds: [...selectedGroups],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد معاون ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: `معاون مدرسه «${data.user.fullName}» ایجاد شد`,
        description: `نام کاربری: کدملی — رمز عبور: 123456`,
      })
      setFirstName('')
      setLastName('')
      setNationalId('')
      setPhone('')
      setSelectedGroups(new Set())
      await onCreated?.()
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const canSubmit =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    toEnDigits(nationalId).trim().length >= 4 &&
    !creating

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserCheck className="h-4.5 w-4.5 text-primary" />
          ایجاد معاون مدرسه
        </CardTitle>
        <CardDescription>
          معاون مدرسه عضو ستاد مدرسه است — در گروه‌های همکاران و عمومی خودکار عضو می‌شود؛
          نام کاربری کدملی و رمز اولیه ۱۲۳۴۵۶ است
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-first">نام</Label>
              <Input
                id="v-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-last">نام خانوادگی</Label>
              <Input
                id="v-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-nid">کدملی</Label>
              <Input
                id="v-nid"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="کدملی ۱۰ رقمی"
                inputMode="numeric"
                dir="ltr"
                className="text-left"
                required
              />
              <p className="text-[11px] text-muted-foreground">همان نام کاربری معاون خواهد بود</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-phone">شماره تماس (اختیاری)</Label>
              <Input
                id="v-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09xxxxxxxxx"
                inputMode="tel"
                dir="ltr"
                className="text-left"
              />
            </div>
          </div>

          <SubjectGroupPicker
            groups={groups}
            selected={selectedGroups}
            onToggle={toggleGroup}
            idPrefix="vice"
          />
          <p className="text-[11px] text-muted-foreground">
            انتخاب گروه درسی برای معاون اختیاری است — فقط اگر معاون درسی هم تدریس می‌کند انتخاب کنید.
          </p>

          <Button type="submit" size="sm" className="gap-1.5" disabled={!canSubmit}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            ایجاد معاون مدرسه
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── ۵) ایجاد دانش‌آموز — فرم مستقل ───

/** فرم مستقل ایجاد دانش‌آموز — انتخاب کلاس الزامی است */
export function StudentAddForm({
  scope,
  onCreated,
}: {
  scope: 'school'
  onCreated?: () => void | Promise<void>
}) {
  const classrooms = useClassrooms(scope, null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [phone, setPhone] = useState('')
  const [classroomId, setClassroomId] = useState('')
  const [creating, setCreating] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: 'STUDENT',
          nationalId: toEnDigits(nationalId).trim(),
          phone: toEnDigits(phone).trim(),
          classroomId,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد دانش‌آموز ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: `دانش‌آموز «${data.user.fullName}» ایجاد شد`,
        description: 'نام کاربری: کدملی — رمز عبور: 123456',
      })
      setFirstName('')
      setLastName('')
      setNationalId('')
      setPhone('')
      setClassroomId('')
      await onCreated?.()
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const canSubmit =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    toEnDigits(nationalId).trim().length >= 4 &&
    !!classroomId &&
    !creating

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GraduationCap className="h-4.5 w-4.5 text-primary" />
          ایجاد دانش‌آموز
        </CardTitle>
        <CardDescription>{DEFAULT_PASS_HINT}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="st-first">نام</Label>
              <Input
                id="st-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-last">نام خانوادگی</Label>
              <Input
                id="st-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-nid">کدملی</Label>
              <Input
                id="st-nid"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="کدملی ۱۰ رقمی"
                inputMode="numeric"
                dir="ltr"
                className="text-left"
                required
              />
              <p className="text-[11px] text-muted-foreground">همان نام کاربری دانش‌آموز خواهد بود</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-phone">شماره تماس (اختیاری)</Label>
              <Input
                id="st-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09xxxxxxxxx"
                inputMode="tel"
                dir="ltr"
                className="text-left"
              />
            </div>
          </div>

          {scope === 'school' && (
            <ClassroomSelect
              classrooms={classrooms}
              value={classroomId}
              onChange={setClassroomId}
              idPrefix="student"
            />
          )}

          <Button type="submit" size="sm" className="gap-1.5" disabled={!canSubmit}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            ایجاد دانش‌آموز
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
