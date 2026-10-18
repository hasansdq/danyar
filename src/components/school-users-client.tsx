'use client'

/**
 * فهرست کاربران مدرسه — پنل مدیر مدرسه (درخواست کاربر: باکس‌های افزودن کاربر
 * در صفحهٔ مجزای «افزودن کاربر» /modir/users/add قرار دارند):
 * جست‌وجو، فیلتر نقش، صفحه‌بندی، ویرایش، فعال/غیرفعال، حذف
 * نام کاربری همه = کدملی؛ رمز پیش‌فرض = 123456؛ رمز ضعیف (فقط عدد/حرف) مجاز است.
 */

import { useCallback, useEffect, useState, FormEvent } from 'react'
import {
  Loader2,
  KeyRound,
  Pencil,
  Trash2,
  Search,
  Smartphone,
  UserPlus,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/client-api'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { faNum } from '@/lib/format'
import { SubjectGroupPicker, LessonPicker, type GroupOption, type LessonOption } from '@/components/user-add-forms'
import { Checkbox } from '@/components/ui/checkbox'
import { UsersSubNav } from '@/components/users-subnav'

interface SchoolUser {
  id: string
  username: string
  fullName: string
  firstName?: string | null
  lastName?: string | null
  role: string
  isActive: boolean
  phone?: string | null
  createdAt: string
  enrollments: { classroom: { id: string; name: string; grade?: string | null } }[]
  teachingAssignments: {
    subjectGroup: { id: string; name: string; classroom: { name: string } }
  }[]
  // درس‌های منتسب به معلم (درخواست کاربر — نمایش/ویرایش در دیالوگ کاربر)
  teacherLessons?: { lesson: { id: string; name: string } }[]
  memberOverrides: { subjectGroupId: string; action: string }[]
}

interface ClassOptionLite {
  id: string
  name: string
  allowStudentDm: boolean
}

const PAGE_SIZE = 15

/** پیش‌فرض نام/نام خانوادگی برای کاربران قدیمی بدون تفکیک */
function splitName(u: SchoolUser): { first: string; last: string } {
  if (u.firstName || u.lastName) {
    return { first: u.firstName ?? '', last: u.lastName ?? '' }
  }
  const sp = u.fullName.indexOf(' ')
  if (sp === -1) return { first: u.fullName, last: '' }
  return { first: u.fullName.slice(0, sp), last: u.fullName.slice(sp + 1).trim() }
}

/**
 * مجوزهای معاون — null یعنی مدیر مدرسه (بدون محدودیت)؛
 * برای معاون، نقشهٔ سوییچ‌های مدیر است (/modir/deputies)
 */
export interface VicePerms {
  classes: boolean
  groups: boolean
  announcements: boolean
  push_notifications: boolean
  live: boolean
  register_teachers: boolean
  register_students: boolean
  edit_users: boolean
  delete_users: boolean
  ai_assistant: boolean
  attendance: boolean
  calendar_events: boolean
  [key: string]: boolean | undefined
}

export function SchoolUsersClient({ permissions = null }: { permissions?: VicePerms | null }) {
  // مدیر مدرسه همه‌چیز را می‌تواند؛ معاون بر اساس سوییچ‌های مدیر
  const isVice = permissions !== null
  const canRegisterStudents = !isVice || !!permissions?.register_students
  const canRegisterTeachers = !isVice || !!permissions?.register_teachers
  const canEditUsers = !isVice || !!permissions?.edit_users
  const canDeleteUsers = !isVice || !!permissions?.delete_users
  const [users, setUsers] = useState<SchoolUser[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  // فیلتر نقش — از پارامتر ?role= ورود کارت‌های آماری «معلمان / دانش‌آموزان» هم پر می‌شود
  const [role, setRole] = useState<'ALL' | 'TEACHER' | 'SCHOOL_VICE' | 'STUDENT'>('ALL')

  const [editUser, setEditUser] = useState<SchoolUser | null>(null)
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  const [editPassword, setEditPassword] = useState('')
  // شماره ورود پیامکی — عملیات حساس نیازمند تأیید رمز مدیر
  const [editPhone, setEditPhone] = useState('')
  const [editAdminPassword, setEditAdminPassword] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  // ویرایش کلاس‌ها و گروه‌های درسی کاربر (درخواست کاربر — مرحله مدیریت کاربران)
  const [editClassIds, setEditClassIds] = useState<Set<string> | null>(null)
  const [editGroupIds, setEditGroupIds] = useState<Set<string> | null>(null)
  // درس‌های منتسب در ویرایش معلم (درخواست کاربر)
  const [allLessons, setAllLessons] = useState<LessonOption[] | null>(null)
  const [editLessonIds, setEditLessonIds] = useState<Set<string> | null>(null)
  const [allClasses, setAllClasses] = useState<ClassOptionLite[] | null>(null)
  const [allGroups, setAllGroups] = useState<GroupOption[] | null>(null)

  // حذف کاربر
  const [deleteTarget, setDeleteTarget] = useState<{
    user: SchoolUser
    deps?: { enrollments: number; assignments: number; groupMessages: number; dmTotal: number }
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      q: search,
    })
    if (role !== 'ALL') params.set('role', role)
    // apiFetch: 401 (نشست باطل/زامبی) → هداشت خودکار به ورود
    const res = await apiFetch(`/api/users?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      setUsers(data.users)
      setTotal(data.total)
    } else {
      // نادیده‌گرفتن بی‌صدا = «لودینگ بی‌پایان» — پیام خطا + تلاش مجدد
      const d = await res.json().catch(() => null)
      setLoadError(d?.error ?? 'بارگذاری فهرست کاربران ناموفق بود')
      setUsers([])
    }
  }, [page, search, role])

  useEffect(() => {
    load()
  }, [load])

  // خواندن فیلتر نقش از آدرس صفحه (ورود از کارت‌های آماری مدیریت مدرسه)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const r = sp.get('role')
    if (r === 'TEACHER' || r === 'SCHOOL_VICE' || r === 'STUDENT') setRole(r)
  }, [])

  // تغییر فیلتر نقش → بازگشت به صفحه اول
  useEffect(() => {
    setPage(1)
  }, [role])

  // تأخیر جست‌وجو
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  async function toggleActive(u: SchoolUser) {
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !u.isActive }),
    })
    if (!res.ok) {
      const data = await res.json()
      toast({ title: data.error ?? 'تغییر وضعیت ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: u.isActive ? `حساب «${u.fullName}» غیرفعال شد` : `حساب «${u.fullName}» فعال شد` })
    await load()
  }

  function openEdit(u: SchoolUser) {
    setEditUser(u)
    const n = splitName(u)
    setEditFirst(n.first)
    setEditLast(n.last)
    setEditPassword('')
    setEditPhone(u.phone ?? '')
    setEditAdminPassword('')
    setEditClassIds(null)
    setEditGroupIds(null)
    setEditLessonIds(null)
    void initEditSelections(u)
  }

  /** بارگذاری کلاس‌ها، گروه‌ها و درس‌های مدرسه (یک‌بار) و مقداردهی اولیه انتخاب‌های ویرایش */
  async function initEditSelections(u: SchoolUser) {
    try {
      const [clsRes, grpRes, lsnRes] = await Promise.all([
        fetch('/api/classes'),
        fetch('/api/groups'),
        fetch('/api/lessons'),
      ])
      const cls = clsRes.ok ? ((await clsRes.json()).classrooms ?? []) : null
      const grp = grpRes.ok ? ((await grpRes.json()).groups ?? []) : null
      const lsn = lsnRes.ok ? ((await lsnRes.json()).lessons ?? []) : null
      if (cls) setAllClasses(cls)
      if (grp) setAllGroups(grp)
      if (lsn) setAllLessons(lsn)

      if (u.role === 'STUDENT') {
        setEditClassIds(new Set(u.enrollments.map((e) => e.classroom.id)))
        if (grp) {
          const enrolled = new Set(u.enrollments.map((e) => e.classroom.id))
          const ov = new Map(u.memberOverrides.map((o) => [o.subjectGroupId, o.action]))
          const eff = new Set<string>()
          for (const g of grp as GroupOption[]) {
            if (!enrolled.has(g.classroomId)) continue
            if (ov.get(g.id) === 'REMOVE') continue
            eff.add(g.id)
          }
          for (const [gid, action] of ov) if (action === 'ADD') eff.add(gid)
          setEditGroupIds(eff)
        }
      } else if (u.role === 'TEACHER') {
        setEditGroupIds(new Set(u.teachingAssignments.map((t) => t.subjectGroup.id)))
        // درس‌های فعلی معلم — پیش‌انتخاب در ویرایش
        setEditLessonIds(new Set((u.teacherLessons ?? []).map((t) => t.lesson.id)))
      }
    } catch {
      /* بارگذاری ناموفق — بخش کلاس/گروه بدون انتخاب می‌ماند و بقیه فرم سالم است */
    }
  }

  function toggleEditClass(id: string) {
    setEditClassIds((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleEditGroup(id: string) {
    setEditGroupIds((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleEditLesson(id: string) {
    setEditLessonIds((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editUser || savingEdit) return
    setSavingEdit(true)
    try {
      const payload: Record<string, unknown> = {
        firstName: editFirst.trim(),
        lastName: editLast.trim(),
      }
      if (editPassword) payload.newPassword = editPassword
      // شماره فقط هنگام تغییر ارسال می‌شود؛ تغییر شماره نیازمند رمز مدیر است
      const originalPhone = editUser.phone ?? ''
      if (editPhone.trim() !== originalPhone) {
        payload.phone = editPhone.trim() === '' ? null : editPhone.trim()
        payload.adminPassword = editAdminPassword
      }
      // تغییر کلاس‌ها و گروه‌های درسی (درخواست کاربر — ویرایش کاربران)
      if (editUser.role === 'STUDENT') {
        if (editClassIds) payload.classroomIds = [...editClassIds]
        if (editGroupIds) payload.subjectGroupIds = [...editGroupIds]
      } else if (editUser.role === 'TEACHER') {
        if (editGroupIds) payload.subjectGroupIds = [...editGroupIds]
        // درس‌های معلم (درخواست کاربر — ویرایش انتساب درس‌ها)
        if (editLessonIds) payload.lessonIds = [...editLessonIds]
      }
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ذخیره ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'اطلاعات کاربر به‌روزرسانی شد' })
      setEditUser(null)
      await load()
    } finally {
      setSavingEdit(false)
    }
  }

  /** مرحله اول حذف: اگر داده وابسته داشت سرور آمار را با 409 برمی‌گرداند */
  async function requestDelete(u: SchoolUser) {
    const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.status === 409 && data.dependencies) {
      setDeleteTarget({ user: u, deps: data.dependencies })
      return
    }
    if (!res.ok) {
      toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: `«${u.fullName}» حذف شد` })
    await load()
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/users/${deleteTarget.user.id}?confirm=true`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `«${deleteTarget.user.fullName}» و داده‌های وابسته حذف شد` })
      setDeleteTarget(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="max-w-4xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">فهرست کاربران مدرسه</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            جست‌وجو، ویرایش و مدیریت وضعیت کاربران — نام کاربری هر کاربر کدملی است؛ افزودن کاربر
            جدید در صفحهٔ «افزودن کاربر» انجام می‌شود
          </p>
          {isVice && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              بخش‌هایی که مدیر مدرسه برای شما محدود کرده، اینجا نمایش داده نمی‌شوند.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <UsersSubNav active="list" base="/modir/users" />
          {(canRegisterStudents || canRegisterTeachers || !isVice) && (
            <Button asChild size="sm" className="gap-1.5">
              <a href="/modir/users/add" aria-label="افزودن کاربر جدید">
                <UserPlus className="h-4 w-4" />
                افزودن کاربر
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* فهرست کاربران */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">فهرست کاربران</CardTitle>
          <CardDescription>
            {role === 'TEACHER'
              ? `${faNum(total)} معلم`
              : role === 'SCHOOL_VICE'
                ? `${faNum(total)} معاون مدرسه`
                : role === 'STUDENT'
                  ? `${faNum(total)} دانش‌آموز`
                  : `${faNum(total)} کاربر`}
          </CardDescription>
          <div className="flex flex-col sm:flex-row gap-2 mt-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جست‌وجوی نام یا کدملی…"
                className="ps-9"
                aria-label="جست‌وجوی کاربر"
              />
            </div>
            <Select value={role} onValueChange={(v) => setRole(v as 'ALL' | 'TEACHER' | 'SCHOOL_VICE' | 'STUDENT')}>
              <SelectTrigger className="sm:w-44" aria-label="فیلتر نقش کاربران">
                <SelectValue placeholder="همه کاربران" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">همه کاربران</SelectItem>
                <SelectItem value="TEACHER">معلمان</SelectItem>
                <SelectItem value="SCHOOL_VICE">معاونان مدرسه</SelectItem>
                <SelectItem value="STUDENT">دانش‌آموزان</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <Loader2 className="h-4 w-4 me-1" />
                تلاش مجدد
              </Button>
            </div>
          ) : users === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search ? 'کاربری با این مشخصات یافت نشد.' : 'هنوز کاربری ایجاد نشده است.'}
            </p>
          ) : (
            <div className="divide-y">
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onEdit={canEditUsers ? openEdit : undefined}
                  onToggle={canEditUsers ? toggleActive : undefined}
                  onDelete={canDeleteUsers ? requestDelete : undefined}
                  showDeputiesLink={!isVice}
                />
              ))}
            </div>
          )}

          {/* صفحه‌بندی */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 mt-3 border-t">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                قبلی
              </Button>
              <span className="text-xs text-muted-foreground">
                صفحه {faNum(page)} از {faNum(totalPages)} • {faNum(total)} کاربر
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                بعدی
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* دیالوگ ویرایش */}
      <Dialog open={editUser !== null} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4.5 w-4.5 text-primary" />
              ویرایش کاربر
            </DialogTitle>
            <DialogDescription>
              {editUser?.username && <>کدملی / نام کاربری: {editUser.username} (قابل تغییر نیست)</>}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-first">نام</Label>
                <Input
                  id="e-first"
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-last">نام خانوادگی</Label>
                <Input
                  id="e-last"
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-pass">رمز عبور جدید (اختیاری)</Label>
              <Input
                id="e-pass"
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="حداقل ۶ کاراکتر — رمز ضعیف (فقط عدد یا فقط حرف) مجاز است"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-phone" className="flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5" />
                شماره ورود پیامکی
              </Label>
              <Input
                id="e-phone"
                dir="ltr"
                className="text-left"
                placeholder="09xxxxxxxxx"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                شماره در کل پلتفرم یکتاست؛ با تغییر شماره، کاربر می‌تواند با پیامک وارد شود.
              </p>
            </div>
            {editPhone.trim() !== (editUser?.phone ?? '') && (
              <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
                <Label htmlFor="e-admin-pass" className="text-xs">
                  تأیید عملیات حساس — رمز عبور خودتان:
                </Label>
                <Input
                  id="e-admin-pass"
                  type="password"
                  value={editAdminPassword}
                  onChange={(e) => setEditAdminPassword(e.target.value)}
                  placeholder="رمز عبور مدیر مدرسه"
                  autoComplete="current-password"
                />
                <p className="text-[11px] text-muted-foreground">
                  تغییر شماره ورود فقط با تأیید رمز شما انجام می‌شود.
                </p>
              </div>
            )}

            {/* ─── کلاس‌ها و گروه‌های درسی دانش‌آموز (درخواست کاربر — ویرایش کاربران) ─── */}
            {editUser?.role === 'STUDENT' && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-medium">کلاس‌ها</Label>
                    <span className="text-[11px] text-muted-foreground">
                      {editClassIds ? `${faNum(editClassIds.size)} کلاس انتخاب شده` : ''}
                    </span>
                  </div>
                  {allClasses === null ? (
                    <div className="h-20 rounded-xl border flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : allClasses.length === 0 ? (
                    <p className="text-xs text-muted-foreground rounded-xl border border-dashed py-4 text-center">
                      هنوز کلاسی ایجاد نشده است.
                    </p>
                  ) : (
                    <div className="rounded-xl border max-h-40 overflow-y-auto divide-y">
                      {allClasses.map((c) => {
                        const checked = editClassIds?.has(c.id) ?? false
                        return (
                          <label
                            key={c.id}
                            className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50 ${checked ? 'bg-primary/5' : ''}`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleEditClass(c.id)}
                              aria-label={`کلاس ${c.name}`}
                            />
                            <span className="text-sm flex-1 min-w-0 truncate">{c.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">گروه‌های درسی</Label>
                  <p className="text-[11px] text-muted-foreground">
                    عضویت در گروه‌های کلاس از ثبت‌نام به‌طور خودکار می‌آید؛ تغییر این فهرست به‌صورت
                    استثنا (حذف از گروه کلاس یا افزودن به گروه کلاس دیگر) اعمال می‌شود.
                  </p>
                  {allGroups === null || editGroupIds === null ? (
                    <div className="h-20 rounded-xl border flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="rounded-xl border max-h-48 overflow-y-auto divide-y">
                      {allGroups.map((g) => {
                        const checked = editGroupIds.has(g.id)
                        return (
                          <label
                            key={g.id}
                            className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50 ${checked ? 'bg-primary/5' : ''}`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleEditGroup(g.id)}
                              aria-label={`گروه ${g.name}`}
                            />
                            <span className="text-sm flex-1 min-w-0 truncate">{g.name}</span>
                            {g.archivedAt ? (
                              <span className="text-[10px] text-muted-foreground shrink-0">بایگانی‌شده</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {g.classroom.name}
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ─── گروه‌های تدریس معلم (هم‌راستا با ایجاد معلم) ─── */}
            {editUser?.role === 'TEACHER' && (
              <SubjectGroupPicker
                groups={allGroups}
                selected={editGroupIds ?? new Set()}
                onToggle={toggleEditGroup}
                idPrefix="edit-teacher"
                showArchived
              />
            )}

            {/* ─── درس‌های منتسب به معلم (درخواست کاربر — فیلد چندانتخابی درس) ─── */}
            {editUser?.role === 'TEACHER' && allLessons !== null && (
              <LessonPicker
                lessons={allLessons}
                selected={editLessonIds ?? new Set()}
                onToggle={toggleEditLesson}
                idPrefix="edit-teacher"
              />
            )}

            <Button type="submit" size="sm" className="gap-1.5" disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              ذخیره تغییرات
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* دیالوگ حذف قطعی کاربر */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4.5 w-4.5" />
              حذف قطعی «{deleteTarget?.user.fullName}»
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.deps
                ? 'این کاربر داده‌های وابسته دارد؛ با حذف او موارد زیر هم پاک می‌شود:'
                : 'این کاربر هیچ داده وابسته‌ای ندارد و حذف او امن است.'}
            </DialogDescription>
          </DialogHeader>
          {deleteTarget?.deps && (
            <ul className="text-sm space-y-1.5 list-disc ps-5">
              {deleteTarget.deps.enrollments > 0 && (
                <li>{faNum(deleteTarget.deps.enrollments)} ثبت‌نام در کلاس‌ها</li>
              )}
              {deleteTarget.deps.assignments > 0 && (
                <li>{faNum(deleteTarget.deps.assignments)} انتساب به گروه‌های درسی</li>
              )}
              {deleteTarget.deps.groupMessages > 0 && (
                <li>{faNum(deleteTarget.deps.groupMessages)} پیام گروهی</li>
              )}
              {deleteTarget.deps.dmTotal > 0 && (
                <li>{faNum(deleteTarget.deps.dmTotal)} پیام خصوصی</li>
              )}
            </ul>
          )}
          <div className="flex gap-2 justify-start pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              انصراف
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting} className="gap-1.5">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              حذف قطعی
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function UserRow({
  user: u,
  onEdit,
  onToggle,
  onDelete,
  showDeputiesLink = false,
}: {
  user: SchoolUser
  onEdit?: (u: SchoolUser) => void
  onToggle?: (u: SchoolUser) => void
  onDelete?: (u: SchoolUser) => void
  /** لینک «دسترسی‌ها» روی ردیف معاون — فقط برای مدیر مدرسه */
  showDeputiesLink?: boolean
}) {
  return (
    <div className="py-3 flex items-center gap-3">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback
          className={
            u.role === 'TEACHER'
              ? 'bg-primary/10 text-primary text-sm font-bold'
              : 'bg-accent text-accent-foreground text-sm font-bold'
          }
        >
          {u.fullName.charAt(0)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-2">
          {u.fullName}
          {!u.isActive && (
            <Badge variant="destructive" className="text-[10px]">
              غیرفعال
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground" dir="ltr">
          {u.username}
        </div>
        {u.phone && (
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1" dir="ltr">
            <Smartphone className="h-3 w-3" />
            {u.phone}
          </div>
        )}
        {u.role === 'SCHOOL_VICE' && (
          <div className="text-[11px] text-muted-foreground mt-0.5">معاون مدرسه</div>
        )}
        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {u.role === 'STUDENT'
            ? u.enrollments.length > 0
              ? `کلاس‌ها: ${u.enrollments
                  .map((e) =>
                    e.classroom.grade
                      ? `${e.classroom.name} (پایه ${e.classroom.grade})`
                      : e.classroom.name,
                  )
                  .join('، ')}`
              : 'در کلاسی ثبت‌نام نشده'
            : u.teachingAssignments.length > 0
              ? `گروه‌ها: ${u.teachingAssignments
                  .map((t) => `${t.subjectGroup.name} (${t.subjectGroup.classroom.name})`)
                  .join('، ')}`
              : 'به گروهی منتسب نشده'}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {showDeputiesLink && u.role === 'SCHOOL_VICE' && (
          <Button asChild variant="outline" size="sm" className="me-1 h-8 gap-1 text-xs">
            <a href="/modir/deputies" aria-label={`دسترسی‌های ${u.fullName}`} title="مدیریت دسترسی‌های معاون">
              دسترسی‌ها
            </a>
          </Button>
        )}
        {onToggle && (
          <Switch
            checked={u.isActive}
            onCheckedChange={() => onToggle(u)}
            aria-label={`فعال/غیرفعال ${u.fullName}`}
          />
        )}
        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onEdit(u)}
            aria-label={`ویرایش ${u.fullName}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onDelete(u)}
            aria-label={`حذف ${u.fullName}`}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  )
}
