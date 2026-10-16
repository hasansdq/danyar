'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getSocket } from '@/components/messenger/socket-client'
import { Plus, ClipboardList, Search, ChevronLeft, Ban, Clock, Eye } from 'lucide-react'
import { faNum, faDateTime } from '@/lib/format'
import { isOverdue, type AssignmentRow, type GroupMeta } from './shared'
import { AssignmentFormDialog } from './assignment-form-dialog'
import { cn } from '@/lib/utils'

/**
 * فهرست تکالیف برای معلم (ایجاد + پیگیری گروه‌های خودش)
 * و مدیر مدرسه (نمای فقط‌خواندنی کل مدرسه)
 */
export function AssignmentsClient({ role }: { role: string }) {
  const isTeacher = role === 'TEACHER'

  const [rows, setRows] = useState<AssignmentRow[] | null>(null)
  const [groups, setGroups] = useState<GroupMeta[]>([])
  const [groupFilter, setGroupFilter] = useState('ALL')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    async (gid: string, query: string) => {
      try {
        const sp = new URLSearchParams()
        if (gid !== 'ALL') sp.set('groupId', gid)
        if (query) sp.set('q', query)
        const r = await fetch(`/api/assignments?${sp}`, { cache: 'no-store' })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          setError(d.error ?? 'خطا در دریافت تکالیف')
          setRows([])
          return
        }
        setError('')
        setRows(d.assignments ?? [])
        setGroups(d.groups ?? [])
      } catch {
        setError('ارتباط با سرور ناموفق بود')
      }
    },
    [],
  )

  useEffect(() => {
    load(groupFilter, q)
  }, [groupFilter, q, load])

  // به‌روزرسانی بلادرنگ با رویداد socket
  useEffect(() => {
    const socket = getSocket()
    const onUpdate = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(() => load(groupFilter, q), 600)
    }
    socket.on('assignments:update', onUpdate)
    return () => {
      socket.off('assignments:update', onUpdate)
    }
  }, [groupFilter, q, load])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <h1 className="text-lg font-bold">تکالیف</h1>
        {rows && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {faNum(rows.length)} تکلیف
          </span>
        )}
        <div className="flex-1" />
        {isTeacher && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            تکلیف جدید
          </Button>
        )}
      </div>

      {!isTeacher && (
        <p className="mb-4 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          نمای مدیر مدرسه — همه تکالیف مدرسه فقط برای پیگیری آموزشی قابل مشاهده است؛ ثبت بازخورد با معلم گروه است.
        </p>
      )}

      {/* فیلترها */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجوی عنوان تکلیف..."
            className="pr-8"
          />
        </div>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger dir="rtl" className="w-56">
            <SelectValue placeholder="همه گروه‌ها" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">همه گروه‌های درسی</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name} — {g.classroomName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-14 text-center">
          <Ban className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : rows === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-14 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">تکلیفی ثبت نشده است</p>
          {isTeacher && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              ایجاد اولین تکلیف
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((a) => {
            const overdue = isOverdue(a.dueAt)
            return (
              <li key={a.id}>
                <Link
                  href={`/assignments/${a.id}`}
                  className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ClipboardList className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-bold">{a.title}</h3>
                        {overdue && (
                          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                            مهلت گذشته
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                          {a.groupName}
                        </span>
                        <span>{a.classroomName}</span>
                        {a.dueAt && (
                          <span className={cn('flex items-center gap-1', overdue && 'text-amber-600 dark:text-amber-400')}>
                            <Clock className="h-3.5 w-3.5" />
                            مهلت: {faDateTime(a.dueAt)}
                          </span>
                        )}
                        {a.hasAttachment && <span>📎 پیوست دارد</span>}
                      </div>
                      {a.stats && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-600 dark:text-blue-400">
                            ارسال‌شده: {faNum(a.stats.submitted)} از {faNum(a.stats.total)}
                          </span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                            ارسال‌نشده: {faNum(a.stats.notSubmitted)}
                          </span>
                          {a.stats.late > 0 && (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">
                              دیرهنگام: {faNum(a.stats.late)}
                            </span>
                          )}
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-400">
                            بررسی‌شده: {faNum(a.stats.reviewed)}
                          </span>
                          {a.stats.awaitingReview > 0 && (
                            <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-red-600 dark:text-red-400">
                              <Eye className="h-3 w-3" />
                              در انتظار بازخورد: {faNum(a.stats.awaitingReview)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <ChevronLeft className="mt-1 h-5 w-5 shrink-0 text-muted-foreground/50" />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {isTeacher && (
        <AssignmentFormDialog
          groups={groups}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={() => load(groupFilter, q)}
        />
      )}
    </div>
  )
}
