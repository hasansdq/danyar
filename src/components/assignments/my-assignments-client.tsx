'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
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
import { ClipboardList, Search, ChevronLeft, Ban, Clock } from 'lucide-react'
import { faNum, faDateTime } from '@/lib/format'
import {
  SUBMISSION_STATUSES,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_BADGE,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUS_BADGE,
  type SubmissionStatus,
  type FeedbackStatus,
} from '@/lib/assignment-status'
import { isOverdue, type AssignmentRow, type GroupMeta } from './shared'
import { cn } from '@/lib/utils'

/**
 * «تکالیف من» — همه تکالیف همه دروس دانش‌آموز یکجا
 * با فیلتر بر اساس درس و وضعیت
 */
export function MyAssignmentsClient() {
  const [rows, setRows] = useState<AssignmentRow[] | null>(null)
  const [groups, setGroups] = useState<GroupMeta[]>([])
  const [groupFilter, setGroupFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | SubmissionStatus>('ALL')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (gid: string, query: string) => {
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
  }, [])

  useEffect(() => {
    load(groupFilter, q)
  }, [groupFilter, q, load])

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

  const filtered =
    rows?.filter((a) => (statusFilter === 'ALL' ? true : a.myStatus === statusFilter)) ?? []

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5">
      <div className="mb-4 flex items-center gap-2.5">
        <h1 className="text-lg font-bold">تکالیف من</h1>
        {rows && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {faNum(filtered.length)} تکلیف
          </span>
        )}
      </div>

      {/* فیلتر درس و وضعیت */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجوی عنوان تکلیف..."
            className="pr-8"
          />
        </div>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger dir="rtl" className="w-48">
            <SelectValue placeholder="همه درس‌ها" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">همه درس‌ها</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'ALL' | SubmissionStatus)}>
          <SelectTrigger dir="rtl" className="w-40">
            <SelectValue placeholder="همه وضعیت‌ها" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">همه وضعیت‌ها</SelectItem>
            {SUBMISSION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SUBMISSION_STATUS_LABELS[s]}
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
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-14 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? 'هنوز تکلیفی برای شما ثبت نشده است' : 'تکلیفی با این فیلترها یافت نشد'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((a) => {
            const overdue = isOverdue(a.dueAt) && (a.myStatus === 'NOT_SUBMITTED' || a.myStatus === 'LATE')
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
                      <h3 className="truncate font-bold">{a.title}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                          {a.groupName}
                        </span>
                        {a.dueAt && (
                          <span className={cn('flex items-center gap-1', overdue && 'text-amber-600 dark:text-amber-400')}>
                            <Clock className="h-3.5 w-3.5" />
                            مهلت: {faDateTime(a.dueAt)}
                          </span>
                        )}
                        {a.hasAttachment && <span>📎 پیوست دارد</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {a.myStatus && (
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-1 text-[11px] font-bold',
                            SUBMISSION_STATUS_BADGE[a.myStatus],
                          )}
                        >
                          {SUBMISSION_STATUS_LABELS[a.myStatus]}
                        </span>
                      )}
                      {a.myFeedbackStatus && a.myFeedbackStatus !== 'UNSEEN' && (
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                            FEEDBACK_STATUS_BADGE[a.myFeedbackStatus as FeedbackStatus],
                          )}
                        >
                          {FEEDBACK_STATUS_LABELS[a.myFeedbackStatus as FeedbackStatus]}
                          {a.myGrade != null && ` — ${faNum(a.myGrade)}`}
                          {a.myGrade != null && a.maxGrade != null && ` از ${faNum(a.maxGrade)}`}
                        </span>
                      )}
                      <ChevronLeft className="hidden h-5 w-5 text-muted-foreground/50 sm:block" />
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
