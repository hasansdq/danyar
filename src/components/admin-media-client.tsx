'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { toast } from 'sonner'
import {
  Images,
  Settings2,
  School as SchoolIcon,
  Search,
  Image as ImageIcon,
  Music,
  FileVideo,
  FileText,
  Download,
  Trash2,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react'
import { faNum, faDateTime } from '@/lib/format'
import { formatBytes, MEDIA_TYPE_BADGE } from '@/lib/media-format'
import { AdminMediaSettings } from '@/components/admin-media-settings'
import { cn } from '@/lib/utils'

interface MediaItem {
  key: string
  name: string
  mime: string
  size: number
  type: string
  downloadCount: number
  createdAt: string
  uploader: { id: string; fullName: string; role: string }
  school: { id: string; name: string } | null
}

interface MediaListResponse {
  items: MediaItem[]
  page: number
  pageSize: number
  total: number
  summary: { count: number; sizeBytes: number }
  platform: { count: number; sizeBytes: number }
}

interface SchoolBrief {
  id: string
  name: string
  isActive: boolean
  mediaQuotaGB: number
}

type RangeKey = 'all' | 'today' | '7d' | '30d'

const RANGE_LABELS: Record<RangeKey, string> = {
  all: 'همه زمان‌ها',
  today: 'امروز',
  '7d': '۷ روز گذشته',
  '30d': '۳۰ روز گذشته',
}

const TYPE_ICONS: Record<string, typeof ImageIcon> = {
  IMAGE: ImageIcon,
  AUDIO: Music,
  VIDEO: FileVideo,
  FILE: FileText,
}

function rangeDates(r: RangeKey): { from?: string; to?: string } {
  if (r === 'all') return {}
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const now = new Date()
  if (r === 'today') return { from: fmt(now), to: fmt(now) }
  const days = r === '7d' ? 7 : 30
  const past = new Date(now.getTime() - days * 86400000)
  return { from: fmt(past), to: fmt(now) }
}

/**
 * پنل مدیریت رسانه‌های مدیر کل — دو بخش:
 * گالری (مشاهده/فیلتر/مرتب‌سازی/دانلود/حذف همه رسانه‌های مدارس) و
 * تنظیمات (فرمت‌های مجاز آپلود + سقف حجم هر فرمت + سهمیه گیگابایتی هر مدرسه)
 */
export function AdminMediaClient() {
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto w-full">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="h-10 w-10 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center">
          <Images className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-bold leading-tight">مدیریت رسانه‌ها</h1>
          <p className="text-xs text-muted-foreground">
            گالری رسانه‌های همه مدارس و سیاست آپلود پلتفرم (فرمت مجاز، سقف حجم و سهمیه مدرسه)
          </p>
        </div>
      </div>

      <Tabs defaultValue="gallery" className="mt-4">
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="gallery" className="gap-1.5">
            <Images className="h-4 w-4" />
            گالری
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings2 className="h-4 w-4" />
            تنظیمات
          </TabsTrigger>
        </TabsList>
        <TabsContent value="gallery">
          <GalleryTab />
        </TabsContent>
        <TabsContent value="settings">
          <AdminMediaSettings />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ─────────────────────────── تب گالری ─────────────────────────── */

interface Filters {
  schoolId: string
  type: string
  fmt: string
  minMB: string
  maxMB: string
  range: RangeKey
  q: string
  sort: 'createdAt' | 'size'
  order: 'asc' | 'desc'
}

const DEFAULT_FILTERS: Filters = {
  schoolId: '',
  type: '',
  fmt: '',
  minMB: '',
  maxMB: '',
  range: 'all',
  q: '',
  sort: 'createdAt',
  order: 'desc',
}

function GalleryTab() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  // فیلتر اعمال‌شده — با تأخیر کوتاه از state زنده همگام می‌شود
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS)
  const [data, setData] = useState<MediaListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [schools, setSchools] = useState<SchoolBrief[]>([])
  const [deleting, setDeleting] = useState<MediaItem | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSchools = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/media/settings')
      if (r.ok) {
        const d = await r.json()
        setSchools(d.schools ?? [])
      }
    } catch {
      /* فهرست مدرسه برای فیلتر حیاتی نیست */
    }
  }, [])

  const load = useCallback(async (f: Filters, p: number) => {
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (f.schoolId) sp.set('schoolId', f.schoolId)
      if (f.type) sp.set('type', f.type)
      if (f.fmt.trim()) sp.set('fmt', f.fmt.trim())
      const min = Number(f.minMB)
      if (Number.isFinite(min) && min > 0) sp.set('minSize', String(min * 1024 * 1024))
      const max = Number(f.maxMB)
      if (Number.isFinite(max) && max > 0) sp.set('maxSize', String(max * 1024 * 1024))
      const { from, to } = rangeDates(f.range)
      if (from) sp.set('from', from)
      if (to) sp.set('to', to)
      if (f.q.trim()) sp.set('q', f.q.trim())
      sp.set('sort', f.sort)
      sp.set('order', f.order)
      sp.set('page', String(p))
      sp.set('pageSize', '20')
      const r = await fetch(`/api/admin/media?${sp.toString()}`)
      if (!r.ok) {
        toast.error('خطا در دریافت فهرست رسانه‌ها')
        return
      }
      setData(await r.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSchools()
  }, [loadSchools])

  // اعمال خودکار فیلترها با تأخیر + بازگشت به صفحه ۱ با هر تغییر فیلتر
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setApplied(filters)
      setPage(1)
    }, 450)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [filters])

  useEffect(() => {
    load(applied, page)
  }, [applied, page, load])

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))

  async function doDelete() {
    if (!deleting) return
    setBusyDelete(true)
    try {
      const r = await fetch(`/api/admin/media/${deleting.key}`, { method: 'DELETE' })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        toast.error(d?.error ?? 'حذف رسانه ناموفق بود')
        return
      }
      toast.success(`رسانه «${deleting.name}» حذف شد`)
      setDeleting(null)
      loadSchools()
      load(applied, page)
    } finally {
      setBusyDelete(false)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="mt-4 space-y-4">
      {/* ─── فیلترها ─── */}
      <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <FilterSelect
            placeholder="همه مدارس"
            value={filters.schoolId || 'all'}
            onChange={(v) => set({ schoolId: v === 'all' ? '' : v })}
          >
            <SelectItem value="all">همه مدارس</SelectItem>
            {schools.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </FilterSelect>

          <FilterSelect
            placeholder="همه انواع"
            value={filters.type || 'all'}
            onChange={(v) => set({ type: v === 'all' ? '' : v })}
          >
            <SelectItem value="all">همه انواع</SelectItem>
            <SelectItem value="IMAGE">تصویر</SelectItem>
            <SelectItem value="AUDIO">صوت</SelectItem>
            <SelectItem value="VIDEO">ویدئو</SelectItem>
            <SelectItem value="FILE">فایل</SelectItem>
          </FilterSelect>

          <FilterSelect
            placeholder={RANGE_LABELS[filters.range]}
            value={filters.range}
            onChange={(v) => set({ range: v as RangeKey })}
          >
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {RANGE_LABELS[k]}
              </SelectItem>
            ))}
          </FilterSelect>

          <FilterSelect
            placeholder="مرتب‌سازی"
            value={`${filters.sort}:${filters.order}`}
            onChange={(v) => {
              const [sort, order] = v.split(':') as [Filters['sort'], Filters['order']]
              set({ sort, order })
            }}
          >
            <SelectItem value="createdAt:desc">جدیدترین</SelectItem>
            <SelectItem value="createdAt:asc">قدیمی‌ترین</SelectItem>
            <SelectItem value="size:desc">حجیم‌ترین</SelectItem>
            <SelectItem value="size:asc">کم‌حجم‌ترین</SelectItem>
          </FilterSelect>

          <Input
            placeholder="فرمت: pdf یا image/png"
            value={filters.fmt}
            onChange={(e) => set({ fmt: e.target.value })}
            className="h-9 text-xs"
            dir="ltr"
          />

          <div className="flex gap-2">
            <Input
              placeholder="از (MB)"
              value={filters.minMB}
              onChange={(e) => set({ minMB: e.target.value.replace(/[^0-9.]/g, '') })}
              inputMode="decimal"
              className="h-9 text-xs"
              aria-label="حداقل حجم مگابایت"
            />
            <Input
              placeholder="تا (MB)"
              value={filters.maxMB}
              onChange={(e) => set({ maxMB: e.target.value.replace(/[^0-9.]/g, '') })}
              inputMode="decimal"
              className="h-9 text-xs"
              aria-label="حداکثر حجم مگابایت"
            />
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="جست‌وجوی نام فایل…"
              value={filters.q}
              onChange={(e) => set({ q: e.target.value })}
              className="h-9 text-xs ps-8"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              setFilters(DEFAULT_FILTERS)
              setApplied(DEFAULT_FILTERS)
              setPage(1)
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            بازنشانی
          </Button>
        </div>
      </div>

      {/* ─── خلاصه ─── */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary" className="gap-1.5 py-1.5">
          <Images className="h-3.5 w-3.5" />
          نتایج: {faNum(data?.summary.count ?? 0)} رسانه — {formatBytes(data?.summary.sizeBytes ?? 0)}
        </Badge>
        <Badge variant="outline" className="gap-1.5 py-1.5">
          <SchoolIcon className="h-3.5 w-3.5" />
          کل پلتفرم: {faNum(data?.platform.count ?? 0)} رسانه — {formatBytes(data?.platform.sizeBytes ?? 0)}
        </Badge>
      </div>

      {/* ─── جدول ─── */}
      {loading && !data ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/50 p-10 text-center">
          <Images className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">رسانه‌ای با این فیلترها یافت نشد</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">نوع</TableHead>
                  <TableHead className="text-right">نام فایل</TableHead>
                  <TableHead className="text-right">مدرسه</TableHead>
                  <TableHead className="text-right">آپلودکننده</TableHead>
                  <TableHead className="text-right">حجم</TableHead>
                  <TableHead className="text-right">دانلود</TableHead>
                  <TableHead className="text-right">تاریخ ایجاد</TableHead>
                  <TableHead className="w-20 text-center">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((m) => {
                  const badge = MEDIA_TYPE_BADGE[m.type] ?? MEDIA_TYPE_BADGE.FILE
                  const Icon = TYPE_ICONS[m.type] ?? FileText
                  return (
                    <TableRow key={m.key}>
                      <TableCell>
                        {m.type === 'IMAGE' ? (
                          <img
                            src={`/api/admin/media/${m.key}/file?preview=1`}
                            alt={m.name}
                            className="h-10 w-10 rounded-lg object-cover border"
                            loading="lazy"
                          />
                        ) : (
                          <span className={cn('h-9 w-9 rounded-lg flex items-center justify-center', badge.cls)}>
                            <Icon className="h-4.5 w-4.5" />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-48">
                        <div className="font-medium text-xs truncate" title={m.name} dir="auto">
                          {m.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate" dir="ltr">
                          {m.mime}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {m.school ? (
                          m.school.name
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{m.uploader.fullName}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatBytes(m.size)}</TableCell>
                      <TableCell>
                        <span className="text-xs font-bold tabular-nums">{faNum(m.downloadCount)}</span>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{faDateTime(m.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <a
                            href={`/api/admin/media/${m.key}/file?dl=1`}
                            title="دانلود"
                            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            title="حذف رسانه"
                            onClick={() => setDeleting(m)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* صفحه‌بندی */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t p-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="gap-1"
              >
                <ChevronRight className="h-4 w-4" />
                قبلی
              </Button>
              <span className="text-xs text-muted-foreground">
                صفحه {faNum(page)} از {faNum(totalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="gap-1"
              >
                بعدی
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* تأیید حذف */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف این رسانه؟</AlertDialogTitle>
            <AlertDialogDescription>
              فایل «{deleting?.name}» ({deleting ? formatBytes(deleting.size) : ''}) از دیسک و
              پایگاه داده حذف می‌شود و دیگر در هیچ پیام، تکلیف یا نمونه‌سؤالی قابل دسترسی نیست.
              این عمل بازگشت‌پذیر نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              disabled={busyDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyDelete ? 'در حال حذف…' : 'حذف قطعی'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FilterSelect({
  placeholder,
  value,
  onChange,
  children,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-xs w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  )
}
