'use client'

import { useCallback, useEffect, useState, FormEvent } from 'react'
import {
  ArrowRight,
  Loader2,
  BookOpen,
  Plus,
  Trash2,
  UserPlus,
  UserMinus,
  Pencil,
  GraduationCap,
  Users,
  Archive,
  Lock,
  LockOpen,
  Settings2,
  MessageSquareLock,
  CalendarDays,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from '@/hooks/use-toast'
import { faNum } from '@/lib/format'

interface GroupInfo {
  id: string
  name: string
  teachingAssignments: { teacher: { id: string; fullName: string; username: string } }[]
  _count: { messages: number }
  archived: boolean
  lockedForStudents: boolean
  messagePolicy: string
  overrideCount: number
}

interface ClassroomInfo {
  id: string
  name: string
  allowStudentDm: boolean
}

interface GroupMember {
  id: string
  fullName: string
  username: string
  isActive: boolean
  status: 'AUTO' | 'ADDED' | 'REMOVED'
}

const POLICY_LABELS: Record<string, string> = {
  ALL: 'همه اعضا',
  STAFF: 'فقط معلم و مدیر',
  ADMINS: 'فقط مدیر مدرسه',
}

interface StudentInfo {
  id: string
  username: string
  fullName: string
  isActive: boolean
}

interface Candidate {
  id: string
  fullName: string
  username: string
  role: string
}

export function ClassDetailClient() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const classId = params.id

  const [className, setClassName] = useState('')
  const [classroom, setClassroom] = useState<ClassroomInfo | null>(null)
  const [groups, setGroups] = useState<GroupInfo[] | null>(null)
  const [students, setStudents] = useState<StudentInfo[]>([])
  const [loading, setLoading] = useState(true)

  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // تنظیمات گروه: سیاست ارسال + بایگانی + اعضا
  const [settingsGroupId, setSettingsGroupId] = useState<string | null>(null)
  const [membersData, setMembersData] = useState<{ members: GroupMember[] } | null>(null)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const [savingPolicy, setSavingPolicy] = useState(false)

  const [teacherDialogGroupId, setTeacherDialogGroupId] = useState<string | null>(null)
  const [teacherCandidates, setTeacherCandidates] = useState<Candidate[] | null>(null)
  const [teacherQuery, setTeacherQuery] = useState('')

  const [studentDialogOpen, setStudentDialogOpen] = useState(false)
  const [studentCandidates, setStudentCandidates] = useState<Candidate[] | null>(null)
  const [studentQuery, setStudentQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/classes/${classId}`)
      if (res.status === 404) {
        toast({ title: 'کلاس یافت نشد', variant: 'destructive' })
        router.push('/modir/classes')
        return
      }
      if (res.ok) {
        const data = await res.json()
        setClassName(data.classroom.name)
        setClassroom({ id: data.classroom.id, name: data.classroom.name, allowStudentDm: data.classroom.allowStudentDm })
        setGroups(data.groups)
        setStudents(data.students)
      }
    } finally {
      setLoading(false)
    }
  }, [classId, router])

  useEffect(() => {
    load()
  }, [load])

  async function loadTeacherCandidates() {
    setTeacherCandidates(null)
    setTeacherQuery('')
    const res = await fetch('/api/users?role=TEACHER')
    if (res.ok) {
      const data = await res.json()
      setTeacherCandidates(data.users)
    }
  }

  async function loadStudentCandidates() {
    setStudentCandidates(null)
    setStudentQuery('')
    const res = await fetch('/api/users?role=STUDENT')
    if (res.ok) {
      const data = await res.json()
      setStudentCandidates(data.users)
    }
  }

  async function createGroup(e: FormEvent) {
    e.preventDefault()
    if (creatingGroup) return
    setCreatingGroup(true)
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName, classroomId: classId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد گروه ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `گروه «${data.group.name}» ایجاد شد` })
      setNewGroupName('')
      await load()
    } finally {
      setCreatingGroup(false)
    }
  }

  async function renameGroup(e: FormEvent) {
    e.preventDefault()
    if (!renamingId) return
    const res = await fetch(`/api/groups/${renamingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameValue }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: data.error ?? 'تغییر نام ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: 'نام گروه به‌روزرسانی شد' })
    setRenamingId(null)
    await load()
  }

  async function deleteGroup(id: string, name: string) {
    const res = await fetch(`/api/groups/${id}?confirm=true`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json()
      toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: `گروه «${name}» حذف شد` })
    await load()
  }

  /** قفل/برداشتن قفل گروه برای دانش‌آموزان — گروه مخفی/حذف نمی‌شود؛ فقط ارسال دانش‌آموز بسته می‌شود */
  async function toggleLock(g: GroupInfo) {
    const res = await fetch(`/api/groups/${g.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockedForStudents: !g.lockedForStudents }),
    })
    if (!res.ok) {
      const data = await res.json()
      toast({ title: data.error ?? 'عملیات ناموفق بود', variant: 'destructive' })
      return
    }
    toast({
      title: g.lockedForStudents
        ? `قفل گروه «${g.name}» برداشته شد`
        : `گروه «${g.name}» برای دانش‌آموزان قفل شد`,
      description: g.lockedForStudents
        ? 'دانش‌آموزان دوباره می‌توانند پیام و فایل بفرستند'
        : 'فقط ارسال پیام و فایل دانش‌آموزان بسته شد؛ گروه مخفی نشد',
    })
    await load()
  }

  async function changePolicy(groupId: string, policy: string) {
    setSavingPolicy(true)
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messagePolicy: policy }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast({ title: data.error ?? 'ثبت سیاست ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'سیاست ارسال پیام به‌روزرسانی شد' })
      await load()
    } finally {
      setSavingPolicy(false)
    }
  }

  async function openMembers(groupId: string) {
    setSettingsGroupId(groupId)
    setMembersData(null)
    setAddMemberOpen(false)
    setMemberQuery('')
    const res = await fetch(`/api/groups/${groupId}/members`)
    if (res.ok) setMembersData(await res.json())
  }

  async function setMemberOverride(userId: string, action: 'ADD' | 'REMOVE') {
    if (!settingsGroupId) return
    const res = await fetch(`/api/groups/${settingsGroupId}/members`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'ADD' ? { adds: [userId] } : { removes: [userId] }),
    })
    if (!res.ok) {
      const data = await res.json()
      toast({ title: data.error ?? 'عملیات ناموفق بود', variant: 'destructive' })
      return
    }
    await openMembers(settingsGroupId)
    await load()
  }

  async function toggleClassroomDm(allow: boolean) {
    const res = await fetch(`/api/classes/${classId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowStudentDm: allow }),
    })
    if (!res.ok) {
      const data = await res.json()
      toast({ title: data.error ?? 'ثبت تنظیم ناموفق بود', variant: 'destructive' })
      return
    }
    setClassroom((c) => (c ? { ...c, allowStudentDm: allow } : c))
    toast({
      title: allow
        ? 'گفتگوی خصوصی هم‌کلاسی‌ها فعال شد'
        : 'گفتگوی خصوصی هم‌کلاسی‌ها غیرفعال شد',
    })
  }

  async function assignTeacher(groupId: string, teacherId: string) {
    const res = await fetch(`/api/groups/${groupId}/teachers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherId }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: data.error ?? 'انتساب ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: 'معلم به گروه منتسب شد' })
    setTeacherDialogGroupId(null)
    await load()
  }

  async function unassignTeacher(groupId: string, teacherId: string) {
    const res = await fetch(`/api/groups/${groupId}/teachers?teacherId=${teacherId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const data = await res.json()
      toast({ title: data.error ?? 'حذف انتساب ناموفق بود', variant: 'destructive' })
      return
    }
    await load()
  }

  async function enrollStudent(studentId: string) {
    const res = await fetch(`/api/classes/${classId}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: data.error ?? 'ثبت‌نام ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: 'دانش‌آموز در کلاس ثبت شد' })
    setStudentDialogOpen(false)
    await load()
  }

  async function removeStudent(studentId: string, fullName: string) {
    const res = await fetch(`/api/classes/${classId}/students?studentId=${studentId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const data = await res.json()
      toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: `${fullName} از کلاس حذف شد` })
    await load()
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const enrolledIds = new Set(students.map((s) => s.id))

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="بازگشت">
          <a href="/modir/classes">
            <ArrowRight className="h-5 w-5" />
          </a>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">کلاس {className}</h1>
          <p className="text-sm text-muted-foreground">
            {faNum(groups?.length ?? 0)} گروه درسی • {faNum(students.length)} دانش‌آموز
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5">
          <a href={`/calendar?class=${classId}`} aria-label="تقویم آموزشی کلاس">
            <CalendarDays className="h-4 w-4" />
            تقویم آموزشی
          </a>
        </Button>
      </div>

      {/* گروه‌های درسی */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4.5 w-4.5 text-primary" />
            گروه‌های درسی (گفتگو)
          </CardTitle>
          <CardDescription>
            مثلاً «ریاضی {className}». دانش‌آموزان کلاس به‌صورت خودکار عضو همه گروه‌ها می‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={createGroup} className="flex flex-col sm:flex-row gap-2">
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="نام گروه درسی"
              required
              minLength={2}
              className="flex-1"
            />
            <Button
              type="submit"
              size="sm"
              disabled={creatingGroup || newGroupName.trim().length < 2}
              className="gap-1.5"
            >
              {creatingGroup ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              ایجاد گروه
            </Button>
          </form>

          {groups === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              هنوز گروهی ایجاد نشده است.
            </p>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.id} className="rounded-xl border p-3 space-y-2.5">
                  {renamingId === g.id ? (
                    <form onSubmit={renameGroup} className="flex gap-2">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        required
                        minLength={2}
                        className="flex-1"
                      />
                      <Button type="submit" size="sm">ذخیره</Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setRenamingId(null)}
                      >
                        انصراف
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm flex-1 min-w-0 truncate">
                        {g.name}
                        {g.archived && (
                          <Badge variant="secondary" className="ms-2 text-[10px] gap-0.5">
                            <Archive className="h-3 w-3" />
                            بایگانی‌شده
                          </Badge>
                        )}
                        {g.lockedForStudents && (
                          <Badge variant="secondary" className="ms-2 text-[10px] gap-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            <Lock className="h-3 w-3" />
                            قفل برای دانش‌آموزان
                          </Badge>
                        )}
                      </span>
                      <Badge variant="outline" className="text-[10px] shrink-0 hidden sm:inline-flex">
                        {POLICY_LABELS[g.messagePolicy] ?? g.messagePolicy}
                      </Badge>
                      <Badge variant="secondary" className="text-[11px] shrink-0">
                        {faNum(g._count.messages)} پیام
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="مدیریت اعضا و تنظیمات"
                        title="اعضا و تنظیمات"
                        onClick={() => openMembers(g.id)}
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={g.lockedForStudents ? `برداشتن قفل گروه ${g.name}` : `قفل گروه ${g.name} برای دانش‌آموزان`}
                        title={g.lockedForStudents ? 'برداشتن قفل گروه' : 'قفل برای دانش‌آموزان'}
                        onClick={() => toggleLock(g)}
                      >
                        {g.lockedForStudents ? (
                          <LockOpen className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Lock className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`تغییر نام ${g.name}`}
                        onClick={() => {
                          setRenamingId(g.id)
                          setRenameValue(g.name)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`حذف گروه ${g.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>حذف گروه «{g.name}»؟</AlertDialogTitle>
                            <AlertDialogDescription>
                              همه پیام‌ها و انتساب‌های این گروه حذف می‌شود و قابل بازگشت نیست.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>انصراف</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteGroup(g.id, g.name)}
                              className="bg-destructive text-white hover:bg-destructive/90"
                            >
                              حذف قطعی
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}

                  {/* معلمان گروه */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">معلمان:</span>
                    {g.teachingAssignments.length === 0 && (
                      <span className="text-[11px] text-muted-foreground">هنوز معلمی منتسب نشده</span>
                    )}
                    {g.teachingAssignments.map((t) => (
                      <Badge key={t.teacher.id} variant="secondary" className="gap-1 pl-1">
                        {t.teacher.fullName}
                        <button
                          className="rounded-full hover:bg-destructive/20 p-0.5 transition-colors"
                          onClick={() => unassignTeacher(g.id, t.teacher.id)}
                          aria-label={`حذف ${t.teacher.fullName} از گروه`}
                          title="حذف انتساب"
                        >
                          <UserMinus className="h-3 w-3 text-destructive" />
                        </button>
                      </Badge>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2 gap-1"
                      onClick={() => {
                        setTeacherDialogGroupId(g.id)
                        loadTeacherCandidates()
                      }}
                    >
                      <UserPlus className="h-3 w-3" />
                      انتساب معلم
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* تنظیمات گفتگوی کلاس */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquareLock className="h-4.5 w-4.5 text-primary" />
            تنظیمات گفتگوی کلاس
          </CardTitle>
          <CardDescription>
            گفتگوی خصوصی دانش‌آموزان به‌صورت پیش‌فرض غیرفعال است؛ در صورت فعال‌سازی فقط هم‌کلاسی‌های همان کلاس می‌توانند گفتگو کنند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <div>
              <Label className="text-sm font-medium">گفتگوی خصوصی هم‌کلاسی‌ها</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                دانش‌آموزان کلاس «{className}» بتوانند با یکدیگر پیام خصوصی بفرستند
              </p>
            </div>
            <Switch
              checked={classroom?.allowStudentDm ?? false}
              onCheckedChange={toggleClassroomDm}
              aria-label="فعال‌سازی گفتگوی هم‌کلاسی‌ها"
            />
          </div>
        </CardContent>
      </Card>

      {/* دانش‌آموزان */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="h-4.5 w-4.5 text-primary" />
            دانش‌آموزان کلاس
          </CardTitle>
          <CardDescription>
            با ثبت‌نام در کلاس، دانش‌آموز به همه گروه‌های درسی آن دسترسی پیام‌رسانی پیدا می‌کند.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              setStudentDialogOpen(true)
              loadStudentCandidates()
            }}
          >
            <UserPlus className="h-4 w-4" />
            ثبت‌نام دانش‌آموز در کلاس
          </Button>

          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              هنوز دانش‌آموزی در این کلاس ثبت‌نام نشده است.
            </p>
          ) : (
            <div className="divide-y">
              {students.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
                      {s.fullName.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {s.fullName}
                      {!s.isActive && (
                        <Badge variant="destructive" className="ms-2 text-[10px]">
                          غیرفعال
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {s.username}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => removeStudent(s.id, s.fullName)}
                    aria-label={`حذف ${s.fullName} از کلاس`}
                  >
                    <UserMinus className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* دیالوگ اعضا و تنظیمات گروه */}
      <Dialog
        open={settingsGroupId !== null}
        onOpenChange={(open) => !open && setSettingsGroupId(null)}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-4.5 w-4.5 text-primary" />
              تنظیمات گروه {groups?.find((g) => g.id === settingsGroupId)?.name}
            </DialogTitle>
            <DialogDescription>
              اعضای خودکار از ثبت‌نام کلاس می‌آیند؛ تغییر عضویت کلاس خودکار اعمال می‌شود.
            </DialogDescription>
          </DialogHeader>

          {/* سیاست ارسال */}
          <div className="space-y-1.5">
            <Label className="text-sm">مجوز ارسال پیام</Label>
            <Select
              value={groups?.find((g) => g.id === settingsGroupId)?.messagePolicy ?? 'ALL'}
              onValueChange={(v) => settingsGroupId && changePolicy(settingsGroupId, v)}
              disabled={savingPolicy}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">همه اعضا (معلم، دانش‌آموز، مدیر)</SelectItem>
                <SelectItem value="STAFF">فقط معلمان و مدیر مدرسه</SelectItem>
                <SelectItem value="ADMINS">فقط مدیر مدرسه</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* اعضا */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm">اعضای گروه</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setAddMemberOpen(true)}
              >
                <UserPlus className="h-3.5 w-3.5" />
                افزودن دانش‌آموز
              </Button>
            </div>
            {membersData === null ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : membersData.members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                کلاس هنوز دانش‌آموزی ندارد.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto divide-y rounded-lg border">
                {membersData.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2.5 px-3 py-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                        {m.fullName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">
                        {m.fullName}
                        {!m.isActive && (
                          <Badge variant="destructive" className="ms-1.5 text-[10px]">
                            غیرفعال
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground" dir="ltr">
                        {m.username}
                      </div>
                    </div>
                    {m.status === 'REMOVED' ? (
                      <>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          حذف‌شده
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-emerald-600"
                          onClick={() => setMemberOverride(m.id, 'ADD')}
                        >
                          بازگردانی
                        </Button>
                      </>
                    ) : (
                      <>
                        {m.status === 'ADDED' && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            افزوده
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive"
                          onClick={() => setMemberOverride(m.id, 'REMOVE')}
                        >
                          حذف از گروه
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* دیالوگ افزودن دانش‌آموز به گروه */}
      <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>افزودن دانش‌آموز به گروه</DialogTitle>
            <DialogDescription>
              می‌توانید دانش‌آموزی از کلاس دیگر (همان مدرسه) را هم به این گروه اضافه کنید.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
            placeholder="جست‌وجوی دانش‌آموز…"
            aria-label="جست‌وجوی دانش‌آموز"
          />
          <div className="max-h-64 overflow-y-auto divide-y -mx-2">
            {students
              .filter(
                (s) =>
                  !memberQuery.trim() ||
                  s.fullName.includes(memberQuery.trim()) ||
                  s.username.includes(memberQuery.trim().toLowerCase()),
              )
              .map((s) => {
                const member = membersData?.members.find((m) => m.id === s.id)
                const already = member && member.status !== 'REMOVED'
                return (
                  <button
                    key={s.id}
                    disabled={!!already}
                    className="w-full flex items-center gap-3 rounded-lg px-2 py-2.5 text-right hover:bg-accent transition-colors disabled:opacity-40"
                    onClick={() => setMemberOverride(s.id, 'ADD')}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                        {s.fullName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{s.fullName}</div>
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {s.username}
                      </div>
                    </div>
                    {already && <Badge variant="secondary">عضو است</Badge>}
                  </button>
                )
              })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            فقط دانش‌آموزان همین کلاس فهرست می‌شوند؛ برای افزودن از کلاس دیگر ابتدا از بخش کاربران بررسی کنید.
          </p>
        </DialogContent>
      </Dialog>

      {/* دیالوگ انتساب معلم */}
      <Dialog
        open={teacherDialogGroupId !== null}
        onOpenChange={(open) => !open && setTeacherDialogGroupId(null)}
      >
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4.5 w-4.5 text-primary" />
              انتساب معلم به گروه
            </DialogTitle>
            <DialogDescription>
              فقط معلمان هم‌مدرسه‌ای شما نمایش داده می‌شوند.
            </DialogDescription>
          </DialogHeader>
          {teacherCandidates !== null && teacherCandidates.length > 5 && (
            <Input
              value={teacherQuery}
              onChange={(e) => setTeacherQuery(e.target.value)}
              placeholder="جست‌وجوی معلم…"
              aria-label="جست‌وجوی معلم"
            />
          )}
          {teacherCandidates === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : teacherCandidates.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              ابتدا از بخش «کاربران» یک معلم ایجاد کنید.
            </p>
          ) : (
            <div className="space-y-1">
              {teacherCandidates
                .filter(
                  (t) =>
                    !teacherQuery.trim() ||
                    t.fullName.includes(teacherQuery.trim()) ||
                    t.username.includes(teacherQuery.trim().toLowerCase()),
                )
                .map((t) => {
                const group = groups?.find((g) => g.id === teacherDialogGroupId)
                const already = group?.teachingAssignments.some((a) => a.teacher.id === t.id)
                return (
                  <button
                    key={t.id}
                    disabled={already}
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-right hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => assignTeacher(teacherDialogGroupId!, t.id)}
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-primary/10 text-primary font-bold">
                        {t.fullName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{t.fullName}</div>
                      <div className="text-xs text-muted-foreground" dir="ltr">{t.username}</div>
                    </div>
                    {already && <Badge variant="secondary">منتسب شده</Badge>}
                  </button>
                )
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* دیالوگ ثبت دانش‌آموز */}
      <Dialog open={studentDialogOpen} onOpenChange={setStudentDialogOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-4.5 w-4.5 text-primary" />
              ثبت‌نام دانش‌آموز
            </DialogTitle>
            <DialogDescription>
              دانش‌آموزانی که قبلاً در «کاربران» ساخته‌اید و هنوز در این کلاس نیستند.
            </DialogDescription>
          </DialogHeader>
          {studentCandidates !== null && studentCandidates.length > 5 && (
            <Input
              value={studentQuery}
              onChange={(e) => setStudentQuery(e.target.value)}
              placeholder="جست‌وجوی دانش‌آموز…"
              aria-label="جست‌وجوی دانش‌آموز"
            />
          )}
          {studentCandidates === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-1">
              {studentCandidates
                .filter((s) => !enrolledIds.has(s.id))
                .filter(
                  (s) =>
                    !studentQuery.trim() ||
                    s.fullName.includes(studentQuery.trim()) ||
                    s.username.includes(studentQuery.trim().toLowerCase()),
                )
                .length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  همه دانش‌آموزان مدرسه در این کلاس ثبت‌نام شده‌اند.
                </p>
              ) : (
                studentCandidates
                  .filter((s) => !enrolledIds.has(s.id))
                  .filter(
                    (s) =>
                      !studentQuery.trim() ||
                      s.fullName.includes(studentQuery.trim()) ||
                      s.username.includes(studentQuery.trim().toLowerCase()),
                  )
                  .map((s) => (
                    <button
                      key={s.id}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-right hover:bg-accent transition-colors"
                      onClick={() => enrollStudent(s.id)}
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-primary/10 text-primary font-bold">
                          {s.fullName.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{s.fullName}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">{s.username}</div>
                      </div>
                    </button>
                  ))
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
