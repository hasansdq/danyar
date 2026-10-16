'use client'

/**
 * مدیریت گروه‌ها — بخش مجزای سایدبار پنل مدیر مدرسه (/modir/groups):
 *  ۱) فهرست همه گروه‌ها (درسی/همکاران/عمومی/پایه/سفارشی) با مدیریت سریع:
 *     تغییر نام، قفل گروه برای دانش‌آموزان (فقط ارسالشان بسته می‌شود؛ گروه مخفی/حذف نمی‌شود) و حذف با آیکون
 *  ۲) دو روش ایجاد گروه با دو دکمه مجزا در بالای بخش:
 *     روش اول «ایجاد گروه با عضوگیری خودکار» با ۴ فرم:
 *       - گروه درسی: نام درس + کلاس + معلمان (چندانتخابی) → «ریاضی هفتم ۷۰۳»
 *       - گروه همکاران: فقط دکمه ایجاد (معلم/معاون/مدیر خودکار عضو)
 *       - گروه کلاسی: کلاس + معلمان → «هفتم ۷۰۳»
 *       - گروه عمومی: فقط دکمه ایجاد (همه کاربران مدرسه خودکار عضو)
 *     روش دوم «ایجاد گروه سفارشی»: نام گروه + انتخاب عضو با چک‌باکس از فهرست کاربران
 */

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus,
  Loader2,
  Layers,
  BookOpen,
  GraduationCap,
  Search,
  Users,
  UsersRound,
  Pencil,
  Lock,
  LockOpen,
  Trash2,
  Wand2,
  ListChecks,
  X,
  CheckSquare,
  Square,
  Megaphone,
  School,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { faNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SUBJECT_OPTIONS, composeGroupName, toPersianDigits } from '@/lib/school'

interface ClassOption {
  id: string
  name: string
}

interface TeacherOption {
  id: string
  fullName: string
}

interface CustomUser {
  id: string
  username: string
  fullName: string
  role: string
  isActive: boolean
}

interface GroupRow {
  id: string
  name: string
  scope: string
  grade: string | null
  archivedAt: string | null
  lockedForStudents: boolean
  classroomId?: string | null
  classroomName?: string | null
  messageCount: number
  extraCount: number
}

const SCOPE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  CLASS: { label: 'گروه درسی', icon: BookOpen },
  SCHOOL_STAFF: { label: 'گروه همکاران', icon: UsersRound },
  SCHOOL_ALL: { label: 'گروه عمومی', icon: Megaphone },
  GRADE: { label: 'گروه پایه', icon: Layers },
  CUSTOM: { label: 'گروه سفارشی', icon: ListChecks },
}

function scopeLabel(scope: string, grade: string | null): string {
  if (scope === 'GRADE') return `گروه پایه ${grade ?? ''}`.trim()
  return SCOPE_META[scope]?.label ?? 'گروه'
}

function roleLabelFa(role: string): string {
  switch (role) {
    case 'SCHOOL_ADMIN':
      return 'مدیر مدرسه'
    case 'SCHOOL_VICE':
      return 'معاون مدرسه'
    case 'TEACHER':
      return 'معلم'
    default:
      return 'دانش‌آموز'
  }
}

/** چندانتخابی معلمان — تکس‌باکس با نشان‌های انتخاب‌شده + پاپ‌آور چک‌باکسی */
function TeacherMultiSelect({
  teachers,
  selected,
  onChange,
  disabled,
}: {
  teachers: TeacherOption[] | null
  selected: Set<string>
  onChange: (next: Set<string>) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filtered = (teachers ?? []).filter((t) => (q.trim() ? t.fullName.includes(q.trim()) : true))

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="انتخاب معلمان"
            className="w-full min-h-10 rounded-md border bg-background px-3 py-1.5 text-start text-sm flex flex-wrap items-center gap-1.5 hover:bg-accent/40 transition-colors disabled:opacity-50"
          >
            {selected.size === 0 ? (
              <span className="text-muted-foreground text-sm">
                {teachers === null ? 'در حال بارگذاری معلمان…' : 'انتخاب معلمان (اختیاری)'}
              </span>
            ) : (
              (teachers ?? [])
                .filter((t) => selected.has(t.id))
                .map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium"
                  >
                    {t.fullName}
                    <X
                      className="h-3 w-3 cursor-pointer hover:opacity-70"
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = new Set(selected)
                        next.delete(t.id)
                        onChange(next)
                      }}
                    />
                  </span>
                ))
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جست‌وجوی معلم…"
                className="ps-8 h-8 text-xs"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {teachers === null ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                {teachers.length === 0 ? 'معلمی ثبت نشده است.' : 'معلمی با این نام یافت نشد.'}
              </p>
            ) : (
              filtered.map((t) => {
                const checked = selected.has(t.id)
                return (
                  <label
                    key={t.id}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 cursor-pointer hover:bg-muted/60 text-sm',
                      checked && 'bg-primary/5',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => {
                        const next = new Set(selected)
                        if (next.has(t.id)) next.delete(t.id)
                        else next.add(t.id)
                        onChange(next)
                      }}
                      aria-label={`انتخاب ${t.fullName}`}
                    />
                    <span className="flex-1 min-w-0 truncate">{t.fullName}</span>
                  </label>
                )
              })
            )}
          </div>
          {selected.size > 0 && (
            <div className="border-t p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => onChange(new Set())}
              >
                پاک‌کردن انتخاب‌ها
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function SchoolGroupsClient() {
  const router = useRouter()
  // فهرست همه گروه‌ها (درسی + مدرسه‌ای) ادغام‌شده
  const [groups, setGroups] = useState<GroupRow[] | null>(null)
  const [classes, setClasses] = useState<ClassOption[] | null>(null)
  const [teachers, setTeachers] = useState<TeacherOption[] | null>(null)
  const [query, setQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')

  // روش ایجاد: 'auto' | 'custom' | null (بسته)
  const [method, setMethod] = useState<'auto' | 'custom' | null>(null)
  // تب‌های روش خودکار: درسی | همکاران | کلاسی | عمومی
  const [autoTab, setAutoTab] = useState('course')

  // فرم گروه درسی
  const [courseSubject, setCourseSubject] = useState('')
  const [courseClassId, setCourseClassId] = useState('')
  const [courseTeachers, setCourseTeachers] = useState<Set<string>>(new Set())
  const [creatingCourse, setCreatingCourse] = useState(false)

  // فرم گروه کلاسی
  const [classGroupClassId, setClassGroupClassId] = useState('')
  const [classGroupTeachers, setClassGroupTeachers] = useState<Set<string>>(new Set())
  const [creatingClassGroup, setCreatingClassGroup] = useState(false)

  // فرم‌های همکاران/عمومی
  const [creatingStaff, setCreatingStaff] = useState(false)
  const [creatingAll, setCreatingAll] = useState(false)

  // فرم گروه سفارشی
  const [customName, setCustomName] = useState('')
  const [customUsers, setCustomUsers] = useState<CustomUser[] | null>(null)
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set())
  const [customRoleFilter, setCustomRoleFilter] = useState<'ALL' | 'TEACHER' | 'STUDENT'>('ALL')
  const [customQuery, setCustomQuery] = useState('')
  const [creatingCustom, setCreatingCustom] = useState(false)

  // عملیات سریع فهرست
  const [renameTarget, setRenameTarget] = useState<GroupRow | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [lockTarget, setLockTarget] = useState<GroupRow | null>(null)
  const [locking, setLocking] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ row: GroupRow; deps?: { messages: number } } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadGroups = useCallback(async () => {
    try {
      const [clsRes, schRes] = await Promise.all([fetch('/api/groups'), fetch('/api/groups/school')])
      const cls = clsRes.ok ? ((await clsRes.json()).groups ?? []) : []
      const sch = schRes.ok ? ((await schRes.json()).groups ?? []) : []
      const merged: GroupRow[] = [
        ...cls.map(
          (g: {
            id: string
            name: string
            archivedAt: string | null
            lockedForStudents: boolean
            classroomId: string
            classroom: { id: string; name: string }
            _count: { assignments: number; memberOverrides: number; messages: number }
          }) => ({
            id: g.id,
            name: g.name,
            scope: 'CLASS',
            grade: null,
            archivedAt: g.archivedAt,
            lockedForStudents: g.lockedForStudents,
            classroomId: g.classroomId,
            classroomName: g.classroom?.name ?? null,
            messageCount: g._count.messages,
            extraCount: g._count.assignments,
          }),
        ),
        ...sch.map(
          (g: {
            id: string
            name: string
            scope: string
            grade: string | null
            archivedAt: string | null
            lockedForStudents: boolean
            _count: { messages: number; memberOverrides: number }
          }) => ({
            id: g.id,
            name: g.name,
            scope: g.scope,
            grade: g.grade,
            archivedAt: g.archivedAt,
            lockedForStudents: g.lockedForStudents,
            classroomId: null,
            classroomName: null,
            messageCount: g._count.messages,
            extraCount: g._count.memberOverrides,
          }),
        ),
      ]
      setGroups(merged)
    } catch {
      toast({ title: 'بارگذاری گروه‌ها ناموفق بود', variant: 'destructive' })
      setGroups([])
    }
  }, [])

  const loadBase = useCallback(async () => {
    try {
      const [clsRes, teaRes] = await Promise.all([fetch('/api/classes'), fetch('/api/users?role=TEACHER')])
      if (clsRes.ok) setClasses((await clsRes.json()).classrooms ?? [])
      if (teaRes.ok) {
        const rows = ((await teaRes.json()).users ?? []) as { id: string; fullName: string; isActive: boolean }[]
        setTeachers(rows.filter((u) => u.isActive).map((u) => ({ id: u.id, fullName: u.fullName })))
      }
    } catch {
      /* بارگذاری کلاس/معلم — فرم با پیام سرور هم خطا می‌دهد */
    }
  }, [])

  const loadCustomUsers = useCallback(async () => {
    if (customUsers !== null) return
    try {
      const res = await fetch('/api/users')
      if (res.ok) {
        const rows = ((await res.json()).users ?? []) as CustomUser[]
        setCustomUsers(rows.filter((u) => u.isActive))
      } else {
        setCustomUsers([])
      }
    } catch {
      setCustomUsers([])
    }
  }, [customUsers])

  useEffect(() => {
    loadGroups()
    loadBase()
  }, [loadGroups, loadBase])

  // باز شدن روش سفارشی → بارگذاری کاربران (یک‌بار)
  useEffect(() => {
    if (method === 'custom') void loadCustomUsers()
  }, [method, loadCustomUsers])

  const courseClass = (classes ?? []).find((c) => c.id === courseClassId) ?? null
  const classGroupClass = (classes ?? []).find((c) => c.id === classGroupClassId) ?? null
  const coursePreview =
    courseClass && courseSubject.trim()
      ? composeGroupName(courseSubject.trim(), courseClass.name)
      : ''
  const classGroupPreview = classGroupClass?.name ?? ''

  const filteredGroups = (groups ?? []).filter((g) => {
    if (scopeFilter !== 'all' && g.scope !== scopeFilter) return false
    if (!query.trim()) return true
    const q = toPersianDigits(query.trim())
    return g.name.includes(q) || (g.classroomName ?? '').includes(q)
  })

  const customFiltered = (customUsers ?? []).filter((u) => {
    if (u.role === 'SCHOOL_ADMIN') return false // مدیر مدرسه خودکار عضو است
    if (customRoleFilter === 'TEACHER' && u.role !== 'TEACHER' && u.role !== 'SCHOOL_VICE') return false
    if (customRoleFilter === 'STUDENT' && u.role !== 'STUDENT') return false
    if (customQuery.trim()) {
      const q = toPersianDigits(customQuery.trim())
      return u.fullName.includes(q) || u.username.includes(q)
    }
    return true
  })

  async function createCourseGroup(e: FormEvent) {
    e.preventDefault()
    if (creatingCourse || !courseClass || courseSubject.trim().length < 2) return
    setCreatingCourse(true)
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: composeGroupName(courseSubject.trim(), courseClass.name),
          classroomId: courseClass.id,
          teacherIds: [...courseTeachers],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد گروه ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `گروه «${data.group.name}» ایجاد شد`, description: 'دانش‌آموزان کلاس و مدیر مدرسه خودکار عضو شدند' })
      setCourseSubject('')
      setCourseTeachers(new Set())
      await loadGroups()
    } finally {
      setCreatingCourse(false)
    }
  }

  async function createClassGroup(e: FormEvent) {
    e.preventDefault()
    if (creatingClassGroup || !classGroupClass) return
    setCreatingClassGroup(true)
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: classGroupClass.name,
          classroomId: classGroupClass.id,
          teacherIds: [...classGroupTeachers],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد گروه ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `گروه «${data.group.name}» ایجاد شد`, description: 'دانش‌آموزان کلاس و مدیر مدرسه خودکار عضو شدند' })
      setClassGroupTeachers(new Set())
      await loadGroups()
    } finally {
      setCreatingClassGroup(false)
    }
  }

  async function createAutoGroup(type: 'STAFF' | 'ALL') {
    const busy = type === 'STAFF' ? creatingStaff : creatingAll
    if (busy) return
    if (type === 'STAFF') setCreatingStaff(true)
    else setCreatingAll(true)
    try {
      const res = await fetch('/api/groups/school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد گروه ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: `گروه «${data.group.name}» ایجاد شد`,
        description:
          type === 'STAFF'
            ? 'همه معلمان، معاونان و مدیر مدرسه خودکار عضو شدند'
            : 'همه کاربران مدرسه با هر نقشی خودکار عضو شدند',
      })
      await loadGroups()
    } finally {
      if (type === 'STAFF') setCreatingStaff(false)
      else setCreatingAll(false)
    }
  }

  async function createCustomGroup(e: FormEvent) {
    e.preventDefault()
    if (creatingCustom) return
    if (customName.trim().length < 2) {
      toast({ title: 'نام گروه باید حداقل ۲ کاراکتر باشد', variant: 'destructive' })
      return
    }
    if (customSelected.size === 0) {
      toast({ title: 'حداقل یک عضو برای گروه سفارشی انتخاب کنید', variant: 'destructive' })
      return
    }
    setCreatingCustom(true)
    try {
      const res = await fetch('/api/groups/school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'CUSTOM', name: customName.trim(), memberIds: [...customSelected] }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد گروه ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `گروه «${data.group.name}» ایجاد شد`, description: `${faNum(customSelected.size)} عضو انتخابی افزوده شد` })
      setCustomName('')
      setCustomSelected(new Set())
      await loadGroups()
    } finally {
      setCreatingCustom(false)
    }
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault()
    if (!renameTarget || renaming) return
    setRenaming(true)
    try {
      const res = await fetch(`/api/groups/${renameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'تغییر نام ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'نام گروه به‌روزرسانی شد' })
      setRenameTarget(null)
      await loadGroups()
    } finally {
      setRenaming(false)
    }
  }

  /** قفل/برداشتن قفل گروه برای دانش‌آموزان — گروه مخفی/حذف نمی‌شود؛ فقط ارسال دانش‌آموز بسته می‌شود */
  async function confirmLock() {
    if (!lockTarget || locking) return
    setLocking(true)
    try {
      const res = await fetch(`/api/groups/${lockTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedForStudents: !lockTarget.lockedForStudents }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'تغییر وضعیت قفل گروه ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: lockTarget.lockedForStudents
          ? `قفل گروه «${lockTarget.name}» برداشته شد`
          : `گروه «${lockTarget.name}» برای دانش‌آموزان قفل شد`,
        description: lockTarget.lockedForStudents
          ? 'دانش‌آموزان دوباره می‌توانند پیام و فایل بفرستند'
          : 'ارسال پیام و فایل دانش‌آموزان بسته شد؛ گروه مخفی نشد و مشاهده پیام‌ها آزاد است',
      })
      setLockTarget(null)
      await loadGroups()
    } finally {
      setLocking(false)
    }
  }

  async function requestDelete(row: GroupRow) {
    const res = await fetch(`/api/groups/${row.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    if (res.status === 409 && data?.dependencies) {
      setDeleteTarget({ row, deps: data.dependencies })
      return
    }
    if (!res.ok) {
      toast({ title: data?.error ?? 'حذف ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: `گروه «${row.name}» حذف شد` })
    await loadGroups()
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/groups/${deleteTarget.row.id}?confirm=true`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: data?.error ?? 'حذف ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `گروه «${deleteTarget.row.name}» و همه پیام‌های آن حذف شد` })
      setDeleteTarget(null)
      await loadGroups()
    } finally {
      setDeleting(false)
    }
  }

  const canCreateCourse = !!courseClass && courseSubject.trim().length >= 2 && !creatingCourse
  const canCreateClassGroup = !!classGroupClass && !creatingClassGroup
  const hasStaffGroup = (groups ?? []).some((g) => g.scope === 'SCHOOL_STAFF' && !g.archivedAt)
  const hasAllGroup = (groups ?? []).some((g) => g.scope === 'SCHOOL_ALL' && !g.archivedAt)

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold">مدیریت گروه‌ها</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          ایجاد گروه با عضوگیری خودکار یا سفارشی، تغییر نام، بستن و حذف سریع همه گروه‌های مدرسه
        </p>
      </div>

      {/* دو روش ایجاد گروه — دو دکمه مجزا */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setMethod(method === 'auto' ? null : 'auto')}
          className={cn(
            'rounded-xl border p-4 text-start transition-colors flex items-center gap-3',
            method === 'auto'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'bg-card hover:bg-accent/40',
          )}
        >
          <span className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Wand2 className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold">ایجاد گروه با عضوگیری خودکار</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              درسی، همکاران، کلاسی و عمومی — اعضا خودکار ثبت می‌شوند
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMethod(method === 'custom' ? null : 'custom')}
          className={cn(
            'rounded-xl border p-4 text-start transition-colors flex items-center gap-3',
            method === 'custom'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'bg-card hover:bg-accent/40',
          )}
        >
          <span className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <ListChecks className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold">ایجاد گروه سفارشی</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              انتخاب نام و تیک‌زدن اعضا از فهرست کاربران
            </span>
          </span>
        </button>
      </div>

      {/* ─── روش اول: عضوگیری خودکار — ۴ فرم ─── */}
      {method === 'auto' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wand2 className="h-4.5 w-4.5 text-primary" />
              ایجاد گروه با عضوگیری خودکار
            </CardTitle>
            <CardDescription>نوع گروه را انتخاب کنید؛ اعضا بر اساس کلاس/نقش خودکار عضو می‌شوند</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={autoTab} onValueChange={setAutoTab}>
              <TabsList className="grid grid-cols-4 w-full mb-4">
                <TabsTrigger value="course" className="gap-1 text-[11px] sm:text-xs">
                  <BookOpen className="h-3.5 w-3.5" />
                  درسی
                </TabsTrigger>
                <TabsTrigger value="staff" className="gap-1 text-[11px] sm:text-xs">
                  <UsersRound className="h-3.5 w-3.5" />
                  همکاران
                </TabsTrigger>
                <TabsTrigger value="classroom" className="gap-1 text-[11px] sm:text-xs">
                  <School className="h-3.5 w-3.5" />
                  کلاسی
                </TabsTrigger>
                <TabsTrigger value="public" className="gap-1 text-[11px] sm:text-xs">
                  <Megaphone className="h-3.5 w-3.5" />
                  عمومی
                </TabsTrigger>
              </TabsList>

              {/* ۱) گروه درسی */}
              <TabsContent value="course" className="mt-0">
                <form onSubmit={createCourseGroup} className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="course-subject">نام درس</Label>
                      <Input
                        id="course-subject"
                        value={courseSubject}
                        onChange={(e) => setCourseSubject(e.target.value)}
                        placeholder="مثلاً ریاضی"
                        list="subject-suggestions-groups"
                        maxLength={40}
                      />
                      <datalist id="subject-suggestions-groups">
                        {SUBJECT_OPTIONS.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-1.5">
                      <Label>انتخاب کلاس</Label>
                      <Select value={courseClassId} onValueChange={setCourseClassId}>
                        <SelectTrigger aria-label="انتخاب کلاس گروه درسی">
                          <SelectValue placeholder={classes === null ? 'در حال بارگذاری…' : 'انتخاب کلاس'} />
                        </SelectTrigger>
                        <SelectContent>
                          {(classes ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>معلمان گروه (چندانتخابی از فهرست معلمان)</Label>
                    <TeacherMultiSelect teachers={teachers} selected={courseTeachers} onChange={setCourseTeachers} />
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    {coursePreview ? (
                      <p className="text-xs text-muted-foreground" aria-live="polite">
                        نام گروه: <span className="font-semibold text-foreground">«{coursePreview}»</span>
                      </p>
                    ) : (
                      <span />
                    )}
                    <Button type="submit" disabled={!canCreateCourse} className="gap-1.5">
                      {creatingCourse ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      ایجاد گروه
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-5">
                    دانش‌آموزان کلاس انتخابی و مدیر مدرسه به‌صورت خودکار عضو گروه می‌شوند.
                  </p>
                </form>
              </TabsContent>

              {/* ۲) گروه همکاران */}
              <TabsContent value="staff" className="mt-0">
                <div className="space-y-3">
                  <p className="text-sm leading-6">
                    با کلیک روی «ایجاد»، گروه «گروه همکاران» ساخته می‌شود و همه کاربران با نقش
                    معلم، معاون و مدیر مدرسه به‌صورت خودکار عضو می‌شوند.
                  </p>
                  <Button onClick={() => createAutoGroup('STAFF')} disabled={creatingStaff || hasStaffGroup} className="gap-1.5">
                    {creatingStaff ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    ایجاد
                  </Button>
                  {hasStaffGroup && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      گروه همکاران از قبل وجود دارد.
                    </p>
                  )}
                </div>
              </TabsContent>

              {/* ۳) گروه کلاسی */}
              <TabsContent value="classroom" className="mt-0">
                <form onSubmit={createClassGroup} className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>انتخاب کلاس</Label>
                      <Select value={classGroupClassId} onValueChange={setClassGroupClassId}>
                        <SelectTrigger aria-label="انتخاب کلاس گروه کلاسی">
                          <SelectValue placeholder={classes === null ? 'در حال بارگذاری…' : 'انتخاب کلاس'} />
                        </SelectTrigger>
                        <SelectContent>
                          {(classes ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>معلمان کلاس (چندانتخابی)</Label>
                      <TeacherMultiSelect teachers={teachers} selected={classGroupTeachers} onChange={setClassGroupTeachers} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    {classGroupPreview ? (
                      <p className="text-xs text-muted-foreground" aria-live="polite">
                        نام گروه: <span className="font-semibold text-foreground">«{classGroupPreview}»</span>
                      </p>
                    ) : (
                      <span />
                    )}
                    <Button type="submit" disabled={!canCreateClassGroup} className="gap-1.5">
                      {creatingClassGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      ایجاد گروه
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-5">
                    دانش‌آموزان کلاس انتخابی و مدیر مدرسه به‌صورت خودکار عضو گروه می‌شوند.
                  </p>
                </form>
              </TabsContent>

              {/* ۴) گروه عمومی */}
              <TabsContent value="public" className="mt-0">
                <div className="space-y-3">
                  <p className="text-sm leading-6">
                    با کلیک روی «ایجاد»، گروه «گروه عمومی مدرسه» ساخته می‌شود و تمام کاربران مدرسه
                    با هر نقشی (دانش‌آموز، معلم، معاون و مدیر) به‌صورت خودکار عضو می‌شوند.
                  </p>
                  <Button onClick={() => createAutoGroup('ALL')} disabled={creatingAll || hasAllGroup} className="gap-1.5">
                    {creatingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    ایجاد
                  </Button>
                  {hasAllGroup && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      گروه عمومی از قبل وجود دارد.
                    </p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* ─── روش دوم: گروه سفارشی ─── */}
      {method === 'custom' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-4.5 w-4.5 text-primary" />
              ایجاد گروه سفارشی
            </CardTitle>
            <CardDescription>
              نام گروه را انتخاب کنید و از فهرست کاربران با چک‌باکس اعضا را انتخاب کنید
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createCustomGroup} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="custom-name">نام گروه</Label>
                <Input
                  id="custom-name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="مثلاً: شورای دانش‌آموزی"
                  maxLength={80}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label>انتخاب اعضا ({faNum(customSelected.size)} نفر انتخاب شده)</Label>
                  <div className="flex gap-2">
                    <Select value={customRoleFilter} onValueChange={(v) => setCustomRoleFilter(v as 'ALL' | 'TEACHER' | 'STUDENT')}>
                      <SelectTrigger className="w-36 h-8 text-xs" aria-label="فیلتر نقش">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">همه کاربران</SelectItem>
                        <SelectItem value="TEACHER">معلمان و معاونان</SelectItem>
                        <SelectItem value="STUDENT">دانش‌آموزان</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={customQuery}
                    onChange={(e) => setCustomQuery(e.target.value)}
                    placeholder="جست‌وجوی نام یا کدملی…"
                    className="ps-9"
                  />
                </div>
                <div className="rounded-xl border max-h-64 overflow-y-auto divide-y">
                  {customUsers === null ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : customFiltered.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      کاربری با این فیلترها یافت نشد.
                    </p>
                  ) : (
                    customFiltered.map((u) => {
                      const checked = customSelected.has(u.id)
                      return (
                        <label
                          key={u.id}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50',
                            checked && 'bg-primary/5',
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => {
                              const next = new Set(customSelected)
                              if (next.has(u.id)) next.delete(u.id)
                              else next.add(u.id)
                              setCustomSelected(next)
                            }}
                            aria-label={`انتخاب ${u.fullName}`}
                          />
                          <span className="text-sm flex-1 min-w-0 truncate">{u.fullName}</span>
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            {roleLabelFa(u.role)}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground shrink-0" dir="ltr">
                            {u.username}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  مدیر مدرسه به‌صورت خودکار عضو گروه است و در فهرست انتخاب نیست.
                </p>
              </div>

              <Button type="submit" disabled={creatingCustom || customSelected.size === 0 || customName.trim().length < 2} className="gap-1.5">
                {creatingCustom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                ایجاد گروه سفارشی
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ─── فهرست همه گروه‌ها با مدیریت سریع ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">فهرست گروه‌ها</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2 mt-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جست‌وجوی نام گروه…"
                className="ps-9"
                aria-label="جست‌وجوی گروه"
              />
            </div>
            <Select value={scopeFilter} onValueChange={setScopeFilter}>
              <SelectTrigger className="sm:w-48" aria-label="فیلتر نوع گروه">
                <SelectValue placeholder="همه انواع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه انواع</SelectItem>
                <SelectItem value="CLASS">گروه درسی</SelectItem>
                <SelectItem value="SCHOOL_STAFF">گروه همکاران</SelectItem>
                <SelectItem value="SCHOOL_ALL">گروه عمومی</SelectItem>
                <SelectItem value="GRADE">گروه پایه</SelectItem>
                <SelectItem value="CUSTOM">گروه سفارشی</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {groups === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {query || scopeFilter !== 'all'
                ? 'گروهی با این فیلترها یافت نشد.'
                : 'هنوز گروهی ایجاد نشده است؛ از دو روش بالا شروع کنید.'}
            </p>
          ) : (
            <div className="divide-y">
              {filteredGroups.map((g) => {
                const Meta = SCOPE_META[g.scope] ?? SCOPE_META.CLASS
                const Icon = Meta.icon
                return (
                  <div key={g.id} className="py-3 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                        {g.name}
                        {g.archivedAt && <Badge variant="secondary">بسته‌شده</Badge>}
                        {g.lockedForStudents && (
                          <Badge variant="secondary" className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            <Lock className="h-3 w-3" />
                            قفل برای دانش‌آموزان
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        <Badge variant="secondary" className="gap-1 text-[11px]">
                          <Meta.icon className="h-3 w-3" />
                          {scopeLabel(g.scope, g.grade)}
                        </Badge>
                        {g.classroomName && (
                          <Badge variant="secondary" className="gap-1 text-[11px]">
                            <School className="h-3 w-3" />
                            {g.classroomName}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="gap-1 text-[11px]">
                          <GraduationCap className="h-3 w-3" />
                          {faNum(g.extraCount)} {g.scope === 'CLASS' ? 'تکلیف' : 'عضو'}
                        </Badge>
                      </div>
                    </div>
                    {/* مدیریت سریع: تغییر نام، قفل برای دانش‌آموزان، حذف */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`تغییر نام گروه ${g.name}`}
                        title="تغییر نام"
                        onClick={() => {
                          setRenameTarget(g)
                          setRenameValue(g.name)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={g.lockedForStudents ? `برداشتن قفل گروه ${g.name}` : `قفل گروه ${g.name}`}
                        title={g.lockedForStudents ? 'برداشتن قفل گروه' : 'قفل گروه برای دانش‌آموزان'}
                        onClick={() => setLockTarget(g)}
                      >
                        {g.lockedForStudents ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`حذف گروه ${g.name}`}
                        title="حذف"
                        onClick={() => requestDelete(g)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* دیالوگ تغییر نام */}
      <Dialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4.5 w-4.5 text-primary" />
              تغییر نام گروه
            </DialogTitle>
            <DialogDescription>نام جدید گروه «{renameTarget?.name}» را وارد کنید</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRename} className="space-y-3">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              autoFocus
            />
            <Button type="submit" disabled={renaming || renameValue.trim().length < 2} className="gap-1.5 w-full">
              {renaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckSquare className="h-4 w-4" />}
              ذخیره نام جدید
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* تأیید قفل/برداشتن قفل گروه برای دانش‌آموزان */}
      <AlertDialog open={lockTarget !== null} onOpenChange={(o) => !o && setLockTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lockTarget?.lockedForStudents
                ? `برداشتن قفل گروه «${lockTarget?.name}»؟`
                : `قفل گروه «${lockTarget?.name}» برای دانش‌آموزان؟`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lockTarget?.lockedForStudents
                ? 'با برداشتن قفل، دانش‌آموزان دوباره می‌توانند پیام و فایل بفرستند.'
                : 'با قفل گروه، فقط ارسال پیام و فایل دانش‌آموزان بسته می‌شود؛ گروه مخفی یا حذف نمی‌شود، دانش‌آموزان پیام‌ها را همچنان می‌بینند و معلمان/مدیران عادی پیام می‌فرستند.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLock} disabled={locking}>
              {locking && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}
              تأیید
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* تأیید حذف گروه (با پیام) */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف قطعی گروه «{deleteTarget?.row.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.deps
                ? `این گروه ${faNum(deleteTarget.deps.messages)} پیام دارد؛ با حذف گروه همه پیام‌های آن نیز حذف می‌شود.`
                : 'این گروه هیچ پیامی ندارد و حذف آن امن است.'}{' '}
              این عمل بازگشت‌پذیر نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Trash2 className="h-4 w-4 me-1.5" />}
              حذف قطعی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
