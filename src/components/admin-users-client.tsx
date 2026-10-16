'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Loader2,
  Users,
  Search,
  ShieldCheck,
  Pencil,
  KeyRound,
  LogIn,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Separator } from '@/components/ui/separator'
import { toast } from '@/hooks/use-toast'
import { faNum, faDate, roleLabel } from '@/lib/format'
import {
  BulkStudentAddForm,
  SingleAddUserForm,
  ExcelImportForm,
  type SchoolOption,
} from '@/components/user-add-forms'

interface PlatformUser {
  id: string
  username: string
  fullName: string
  role: string
  isActive: boolean
  createdAt: string
  phone?: string | null
  school: { id: string; name: string; isActive: boolean } | null
  _count?: { enrollments: number; teachingAssignments: number }
}

interface UserDetail {
  id: string
  username: string
  fullName: string
  firstName?: string | null
  lastName?: string | null
  role: string
  phone: string | null
  isActive: boolean
  schoolId: string | null
  classroomId: string | null
  className?: string | null
}

const PAGE_SIZE = 20

export function AdminUsersClient() {
  const [users, setUsers] = useState<PlatformUser[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('ALL')
  const [schoolId, setSchoolId] = useState('ALL')
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [toggling, setToggling] = useState<string | null>(null)

  // ویرایش کاربر
  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [editSchools, setEditSchools] = useState<SchoolOption[]>([])
  const [editClassrooms, setEditClassrooms] = useState<{ id: string; name: string }[]>([])
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editSchool, setEditSchool] = useState('NONE')
  const [editClassroom, setEditClassroom] = useState('NONE')
  const [editActive, setEditActive] = useState(true)
  const [saving, setSaving] = useState(false)

  // تغییر رمز
  const [pwOpen, setPwOpen] = useState(false)
  const [pwUser, setPwUser] = useState<PlatformUser | null>(null)
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  // جعل هویت
  const [impUser, setImpUser] = useState<PlatformUser | null>(null)
  const [impLoading, setImpLoading] = useState(false)

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      q: search,
    })
    if (role !== 'ALL') params.set('role', role)
    if (schoolId !== 'ALL') params.set('schoolId', schoolId)
    const res = await fetch(`/api/admin/users?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      setUsers(data.users)
      setTotal(data.total)
    }
  }, [page, search, role, schoolId])

  const loadFilters = useCallback(async () => {
    const res = await fetch('/api/admin/users', { method: 'POST' })
    if (res.ok) setSchools((await res.json()).schools)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadFilters()
  }, [loadFilters])

  // تأخیر جست‌وجو
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  async function toggleActive(u: PlatformUser) {
    if (toggling) return
    setToggling(u.id)
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !u.isActive }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'تغییر وضعیت ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: u.isActive ? `حساب «${u.fullName}» غیرفعال شد` : `حساب «${u.fullName}» فعال شد` })
      await load()
    } finally {
      setToggling(null)
    }
  }

  async function openEdit(u: PlatformUser) {
    setEditOpen(true)
    setEditLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/admin/users/${u.id}`)
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast({ title: d?.error ?? 'بارگذاری اطلاعات ناموفق بود', variant: 'destructive' })
        setEditOpen(false)
        return
      }
      const d = await res.json()
      setDetail(d.user)
      setEditSchools(d.schools ?? [])
      setEditClassrooms(d.classrooms ?? [])
      // تفکیک نام — از فیلدهای جدید یا شکستن نام کامل برای کاربران قدیمی
      if (d.user.firstName || d.user.lastName) {
        setEditFirst(d.user.firstName ?? '')
        setEditLast(d.user.lastName ?? '')
      } else {
        const sp = (d.user.fullName ?? '').indexOf(' ')
        setEditFirst(sp === -1 ? d.user.fullName ?? '' : (d.user.fullName ?? '').slice(0, sp))
        setEditLast(sp === -1 ? '' : (d.user.fullName ?? '').slice(sp + 1).trim())
      }
      setEditPhone(d.user.phone ?? '')
      setEditSchool(d.user.schoolId ?? 'NONE')
      setEditClassroom(d.user.classroomId ?? 'NONE')
      setEditActive(d.user.isActive)
    } finally {
      setEditLoading(false)
    }
  }

  async function saveEdit() {
    if (!detail) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: editFirst.trim(),
          lastName: editLast.trim(),
          phone: editPhone,
          schoolId: editSchool === 'NONE' ? null : editSchool,
          classroomId: detail.role === 'STUDENT' ? (editClassroom === 'NONE' ? null : editClassroom) : undefined,
          isActive: editActive,
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast({ title: d.error ?? 'ذخیره ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'اطلاعات کاربر به‌روزرسانی شد' })
      setEditOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function savePassword() {
    if (!pwUser) return
    if (pwNew.length < 6) {
      toast({ title: 'رمز جدید باید حداقل ۶ کاراکتر باشد (رمز ضعیف فقط عدد یا فقط حرف مجاز است)', variant: 'destructive' })
      return
    }
    if (pwNew !== pwConfirm) {
      toast({ title: 'تکرار رمز مطابقت ندارد', variant: 'destructive' })
      return
    }
    setPwSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${pwUser.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: pwNew }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast({ title: d.error ?? 'تغییر رمز ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `رمز «${pwUser.fullName}» تغییر کرد` })
      setPwOpen(false)
      setPwNew('')
      setPwConfirm('')
    } finally {
      setPwSaving(false)
    }
  }

  async function doImpersonate() {
    if (!impUser) return
    setImpLoading(true)
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: impUser.id }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast({ title: d.error ?? 'ورود به‌جای کاربر ناموفق بود', variant: 'destructive' })
        return
      }
      // بارگذاری کامل تا کوکی جعل هویت در همه مسیرها اعمال شود
      window.location.href = d.redirect ?? '/'
    } finally {
      setImpLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="max-w-5xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          کاربران پلتفرم
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          مدیریت کامل کاربران: افزودن تکی و گروهی، ایمپورت اکسل، ویرایش، تغییر رمز، ورود به‌جای کاربر
          و فعال/غیرفعال‌سازی — نام کاربری هر کاربر کدملی و رمز اولیه او ۱۲۳۴۵۶ است
        </p>
      </div>

      {/* افزودن گروهی دانش‌آموزان — بالای صفحه */}
      <BulkStudentAddForm scope="platform" schools={schools} onDone={load} />

      {/* افزودن کاربر تکی */}
      <SingleAddUserForm scope="platform" schools={schools} onCreated={load} />

      {/* ایمپورت اکسل */}
      <ExcelImportForm scope="platform" schools={schools} onDone={load} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">فهرست کاربران</CardTitle>
          <CardDescription>{faNum(total)} کاربر یافت شد</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* فیلترها */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جست‌وجوی نام یا نام کاربری…"
                className="ps-9"
                aria-label="جست‌وجوی کاربر"
              />
            </div>
            <Select
              value={schoolId}
              onValueChange={(v) => {
                setSchoolId(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-52" aria-label="فیلتر مدرسه">
                <SelectValue placeholder="همه مدارس" />
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

          <Tabs
            value={role}
            onValueChange={(v) => {
              setRole(v)
              setPage(1)
            }}
          >
            <TabsList className="grid grid-cols-5 w-full h-auto">
              <TabsTrigger value="ALL" className="text-xs sm:text-sm">همه</TabsTrigger>
              <TabsTrigger value="SCHOOL_ADMIN" className="text-xs sm:text-sm">مدیر مدرسه</TabsTrigger>
              <TabsTrigger value="SCHOOL_VICE" className="text-xs sm:text-sm">معاون مدرسه</TabsTrigger>
              <TabsTrigger value="TEACHER" className="text-xs sm:text-sm">معلم</TabsTrigger>
              <TabsTrigger value="STUDENT" className="text-xs sm:text-sm">دانش‌آموز</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* لیست — جدول با سرستون‌های مشخص و ستون جداگانه برای مدرسه */}
          {users === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              کاربری با این مشخصات یافت نشد.
            </p>
          ) : (
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="text-start text-xs font-semibold text-muted-foreground">کاربر</TableHead>
                  <TableHead className="text-start text-xs font-semibold text-muted-foreground">نام کاربری (کدملی)</TableHead>
                  <TableHead className="text-start text-xs font-semibold text-muted-foreground">نقش</TableHead>
                  <TableHead className="text-start text-xs font-semibold text-muted-foreground">مدرسه</TableHead>
                  <TableHead className="text-start text-xs font-semibold text-muted-foreground">تاریخ ثبت</TableHead>
                  <TableHead className="text-start text-xs font-semibold text-muted-foreground">وضعیت</TableHead>
                  <TableHead className="text-center text-xs font-semibold text-muted-foreground">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback
                            className={
                              u.role === 'SUPER_ADMIN'
                                ? 'bg-destructive/10 text-destructive text-sm font-bold'
                                : 'bg-primary/10 text-primary text-sm font-bold'
                            }
                          >
                            {u.fullName.trim().charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span
                          className="text-sm font-medium truncate max-w-[11rem]"
                          title={u.fullName}
                        >
                          {u.fullName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground" dir="ltr">
                      {u.username}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px] whitespace-nowrap">
                        {roleLabel(u.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.school ? (
                        <span
                          className="text-sm truncate max-w-[9.5rem] inline-block align-middle"
                          title={u.school.name}
                        >
                          {u.school.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">بدون مدرسه</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {faDate(u.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={u.isActive}
                          disabled={toggling === u.id || u.role === 'SUPER_ADMIN'}
                          onCheckedChange={() => toggleActive(u)}
                          aria-label={`فعال/غیرفعال ${u.fullName}`}
                        />
                        <span
                          className={
                            u.isActive
                              ? 'text-xs text-muted-foreground'
                              : 'text-xs font-medium text-destructive'
                          }
                        >
                          {u.isActive ? 'فعال' : 'غیرفعال'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.role !== 'SUPER_ADMIN' ? (
                        <div className="flex items-center gap-1 justify-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(u)}
                            aria-label={`ویرایش ${u.fullName}`}
                            title="ویرایش مشخصات"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setPwUser(u)
                              setPwOpen(true)
                            }}
                            aria-label={`تغییر رمز ${u.fullName}`}
                            title="تغییر رمز عبور"
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-primary"
                            disabled={!u.isActive}
                            onClick={() => setImpUser(u)}
                            aria-label={`ورود به‌جای ${u.fullName}`}
                            title="ورود به‌جای این کاربر (جعل هویت)"
                          >
                            <LogIn className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* صفحه‌بندی */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 mt-3 border-t">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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
              >
                بعدی
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* راهنما */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <span>
            رمزهای عبور به‌صورت هش امن (bcrypt) ذخیره می‌شوند و قابل نمایش نیستند؛ می‌توانید رمز جدید
            تعیین کنید. «ورود به‌جای کاربر» با نوار هشدار در بالای برنامه همراه است، حداکثر ۲ ساعت
            اعتبار دارد و در گزارش حسابرسی ثبت می‌شود. با غیرفعال‌کردن حساب، کاربر از ورود منع
            می‌شود ولی داده‌هایش حفظ می‌ماند.
          </span>
        </CardContent>
      </Card>

      {/* دیالوگ ویرایش کاربر */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ویرایش کاربر</DialogTitle>
            <DialogDescription>
              {detail ? `${detail.fullName} — ${roleLabel(detail.role)} (${detail.username})` : ''}
            </DialogDescription>
          </DialogHeader>
          {editLoading || !detail ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-first">نام</Label>
                  <Input
                    id="edit-first"
                    value={editFirst}
                    onChange={(e) => setEditFirst(e.target.value)}
                    minLength={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-last">نام خانوادگی</Label>
                  <Input
                    id="edit-last"
                    value={editLast}
                    onChange={(e) => setEditLast(e.target.value)}
                    minLength={2}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-phone">شماره تلفن (ورود پیامکی — یکتا در کل پلتفرم)</Label>
                <Input
                  id="edit-phone"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="09123456789"
                  dir="ltr"
                  inputMode="tel"
                />
              </div>
              <div className="space-y-1.5">
                <Label>مدرسه</Label>
                <Select
                  value={editSchool}
                  onValueChange={(v) => {
                    setEditSchool(v)
                    setEditClassroom('NONE')
                  }}
                >
                  <SelectTrigger aria-label="مدرسه">
                    <SelectValue placeholder="بدون مدرسه" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">بدون مدرسه</SelectItem>
                    {editSchools.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {detail.role === 'STUDENT' && editSchool !== 'NONE' && (
                <div className="space-y-1.5">
                  <Label>کلاس</Label>
                  <ClassroomPicker
                    schoolId={editSchool}
                    value={editClassroom}
                    onChange={setEditClassroom}
                    fallback={editClassrooms}
                  />
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <span className="text-sm font-medium">حساب فعال</span>
                <Switch checked={editActive} onCheckedChange={setEditActive} aria-label="حساب فعال" />
              </div>
              <Separator />
              <p className="text-xs text-muted-foreground">
                تغییر مدرسه، ثبت‌نام کلاسی و انتساب‌های آموزشی قبلی کاربر را پاک می‌کند.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={saveEdit} disabled={saving || editLoading || !detail} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              ذخیره تغییرات
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* دیالوگ تغییر رمز */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4.5 w-4.5 text-primary" />
              تعیین رمز عبور جدید
            </DialogTitle>
            <DialogDescription>
              برای «{pwUser?.fullName}» — رمزها به‌صورت هش ذخیره می‌شوند و رمز فعلی قابل نمایش نیست.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pw-new">رمز جدید (حداقل ۶ کاراکتر — رمز ضعیف مجاز)</Label>
              <Input
                id="pw-new"
                type="text"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                dir="ltr"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm">تکرار رمز جدید</Label>
              <Input
                id="pw-confirm"
                type="text"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                dir="ltr"
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwOpen(false)} disabled={pwSaving}>
              انصراف
            </Button>
            <Button onClick={savePassword} disabled={pwSaving} className="gap-1.5">
              {pwSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              ثبت رمز جدید
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید جعل هویت */}
      <AlertDialog open={!!impUser} onOpenChange={(o) => !o && setImpUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ورود به‌جای کاربر</AlertDialogTitle>
            <AlertDialogDescription>
              با تأیید، تا خروج شما یا حداکثر ۲ ساعت، همه اقدامات با هویت «{impUser?.fullName}» (
              {impUser ? roleLabel(impUser.role) : ''}) انجام می‌شود و در گزارش حسابرسی ثبت می‌گردد.
              نوار زرد هشدار بالای برنامه نشان‌دهنده این حالت است.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={impLoading}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                doImpersonate()
              }}
              disabled={impLoading}
              className="gap-1.5"
            >
              {impLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              ورود به‌جای کاربر
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** انتخاب کلاس بر اساس مدرسه انتخابی — کلاس‌ها از سرور خوانده می‌شود */
function ClassroomPicker({
  schoolId,
  value,
  onChange,
  fallback,
}: {
  schoolId: string
  value: string
  onChange: (v: string) => void
  fallback: { id: string; name: string }[]
}) {
  const [items, setItems] = useState<{ id: string; name: string }[]>(fallback)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // کلاس‌های هر مدرسه از جزئیات همان کاربر یا API عمومی مدیر کل
      const res = await fetch(`/api/admin/classrooms?schoolId=${encodeURIComponent(schoolId)}`)
      if (res.ok && alive) {
        const d = await res.json()
        setItems(d.classrooms ?? [])
      } else if (alive) {
        setItems(fallback)
      }
    })()
    return () => {
      alive = false
    }
  }, [schoolId, fallback])

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="کلاس">
        <SelectValue placeholder="بدون کلاس" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="NONE">بدون کلاس</SelectItem>
        {items.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
