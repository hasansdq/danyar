'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  School as SchoolIcon,
  Users,
  GraduationCap,
  Layers,
  BookOpen,
  MessageCircle,
  Loader2,
  ArrowLeftCircle,
  Inbox,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { faDateTime, faNum, roleLabel } from '@/lib/format'

interface StatItem {
  key: string
  label: string
  value: number
}

interface ClassRow {
  id: string
  name: string
  _count: { subjectGroups: number; enrollments: number }
}

interface GroupCard {
  id: string
  name: string
  className: string
  studentCount?: number
  messageCount: number
  lastActivity: string | null
  teachers?: string[]
}

interface StudentClass {
  id: string
  name: string
  groups: { id: string; name: string; teachers: string[] }[]
}

interface DashboardData {
  role: string
  schoolName: string
  stats: StatItem[]
  classrooms?: ClassRow[]
  groups?: GroupCard[]
  classes?: StudentClass[]
}

const STAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  classes: Layers,
  groups: BookOpen,
  teachers: Users,
  students: GraduationCap,
  unread: Inbox,
}

export function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard')
        if (res.ok) setData(await res.json())
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!data) {
    return (
      <p className="text-center text-sm text-muted-foreground py-24">
        خطا در بارگذاری داشبورد. صفحه را دوباره باز کنید.
      </p>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-4 sm:px-4 space-y-6">
      <div>
        <h1 className="text-xl font-bold">
          {data.role === 'SCHOOL_ADMIN' ? 'داشبورد مدیریت' : 'داشبورد'}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {data.schoolName} — {roleLabel(data.role)}
        </p>
      </div>

      {/* آمار */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {data.stats.map((s) => {
          const Icon = STAT_ICONS[s.key] ?? Layers
          return (
            <Card key={s.key}>
              <CardContent className="p-4 flex flex-col items-center gap-1.5 text-center">
                <Icon className="h-5 w-5 text-primary" />
                <span className="text-2xl font-bold">{faNum(s.value)}</span>
                <span className="text-xs text-muted-foreground leading-tight">{s.label}</span>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* محتوای مخصوص نقش */}
      {data.role === 'SCHOOL_ADMIN' && (
        <SchoolAdminSection classrooms={data.classrooms ?? []} />
      )}
      {data.role === 'TEACHER' && <TeacherSection groups={data.groups ?? []} />}
      {data.role === 'STUDENT' && <StudentSection classes={data.classes ?? []} />}
    </div>
  )
}

function SchoolAdminSection({ classrooms }: { classrooms: ClassRow[] }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/modir/classes">
            <Layers className="h-4 w-4" />
            مدیریت کلاس‌ها و گروه‌ها
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link href="/modir/users">
            <Users className="h-4 w-4" />
            مدیریت کاربران
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <SchoolIcon className="h-4.5 w-4.5 text-primary" />
            کلاس‌های مدرسه
          </CardTitle>
        </CardHeader>
        <CardContent>
          {classrooms.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              هنوز کلاسی ایجاد نشده است. از «مدیریت کلاس‌ها» کلاس جدید بسازید.
            </p>
          ) : (
            <div className="divide-y">
              {classrooms.map((c) => (
                <Link
                  key={c.id}
                  href={`/modir/classes/${c.id}`}
                  className="flex items-center justify-between py-3 hover:bg-accent/50 rounded-lg px-2 -mx-2 transition-colors"
                >
                  <span className="font-medium text-sm">{c.name}</span>
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{faNum(c._count.subjectGroups)} گروه درسی</Badge>
                    <Badge variant="secondary">{faNum(c._count.enrollments)} دانش‌آموز</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function TeacherSection({ groups }: { groups: GroupCard[] }) {
  const router = useRouter()
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BookOpen className="h-4.5 w-4.5 text-primary" />
          گروه‌های درسی من
        </CardTitle>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            هنوز به گروهی منتسب نشده‌اید. با مدیر مدرسه خود هماهنگ کنید.
          </p>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => router.push(`/chats/group/${g.id}`)}
                className="w-full flex items-center gap-3 rounded-xl border px-3 py-3 text-right hover:bg-accent transition-colors"
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{g.name}</div>
                  <div className="text-xs text-muted-foreground">
                    کلاس {g.className} • {faNum(g.studentCount ?? 0)} دانش‌آموز •{' '}
                    {faNum(g.messageCount)} پیام
                  </div>
                </div>
                {g.lastActivity && (
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {faDateTime(g.lastActivity)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StudentSection({ classes }: { classes: StudentClass[] }) {
  const router = useRouter()
  return (
    <div className="space-y-4">
      {classes.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            هنوز در کلاسی ثبت‌نام نشده‌اید. با مدیر مدرسه خود تماس بگیرید.
          </CardContent>
        </Card>
      ) : (
        classes.map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <SchoolIcon className="h-4.5 w-4.5 text-primary" />
                کلاس {c.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {c.groups.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  هنوز گروهی برای این کلاس ایجاد نشده است.
                </p>
              ) : (
                c.groups.map((g, idx) => (
                  <div key={g.id}>
                    {idx > 0 && <Separator className="my-1" />}
                    <button
                      onClick={() => router.push(`/chats/group/${g.id}`)}
                      className="w-full flex items-center gap-3 py-2 text-right hover:bg-accent rounded-lg px-2 -mx-2 transition-colors"
                    >
                      <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <MessageCircle className="h-4.5 w-4.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{g.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {g.teachers.length > 0
                            ? `معلم: ${g.teachers.join('، ')}`
                            : 'معلمی منتسب نشده'}
                        </div>
                      </div>
                      <ArrowLeftCircle className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
