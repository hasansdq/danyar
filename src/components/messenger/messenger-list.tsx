'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users,
  Search,
  Plus,
  Loader2,
  Megaphone,
  FileText,
  Archive,
  Sparkles,
  UsersRound,
  GraduationCap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatTime, faNum } from '@/lib/format'
import { GRADE_OPTIONS } from '@/lib/school'
import { apiFetch } from '@/lib/client-api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
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
} from '@/components/ui/dialog'
import { getSocket } from './socket-client'
import { ConnectionBadge } from './connection-badge'
import { navigateAfterDialogClose } from '@/lib/dialog-history'
import type { Conversation, ChatMessage, DmCandidate } from './types'

interface SearchResults {
  conversations: {
    key: string
    type: 'GROUP' | 'DM'
    title: string
    subtitle: string
    archived: boolean
  }[]
}

/** ردیف گروه عمومی مدرسه در دیالوگ ایجاد */
interface SchoolGroupRow {
  id: string
  name: string
  scope: string
  grade: string | null
  archivedAt: string | null
  messagePolicy: string
}

export function MessengerList({ currentKey }: { currentKey?: string }) {
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [candidates, setCandidates] = useState<DmCandidate[] | null>(null)
  const [dmEnabled, setDmEnabled] = useState(true)
  // گروه‌های عمومی مدرسه — فقط مدیر مدرسه
  const [schoolGroups, setSchoolGroups] = useState<SchoolGroupRow[] | null>(null)
  const [sgType, setSgType] = useState<'STAFF' | 'ALL' | 'GRADE'>('STAFF')
  const [sgName, setSgName] = useState('گروه همکاران')
  const [sgGrade, setSgGrade] = useState('')
  const [sgCreating, setSgCreating] = useState(false)
  const [sgError, setSgError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reloadRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      // apiFetch: 401 (نشست باطل/زامبی) → هداشت خودکار به ورود؛ در غیر این صورت
      // خطا بی‌صدا می‌ماند و «در حال بارگذاری» بی‌پایان می‌شود
      const res = await apiFetch('/api/chats', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setConversations(data.conversations ?? [])
        setRole(data.role ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // بارگذاری اولیه + به‌روزرسانی بلادرنگ فهرست
  useEffect(() => {
    load()
    const socket = getSocket()
    const scheduleReload = () => {
      if (reloadRef.current) clearTimeout(reloadRef.current)
      reloadRef.current = setTimeout(() => load(), 250)
    }
    const onNew = () => scheduleReload()
    const onRead = () => scheduleReload()
    const onGroupChange = () => scheduleReload()
    socket.on('message:new', onNew)
    socket.on('message:updated', onNew)
    socket.on('message:deleted', onNew)
    socket.on('dm:read', onRead)
    socket.on('group:updated', onGroupChange)
    socket.on('group:removed', onGroupChange)
    socket.on('rooms-refreshed', scheduleReload)
    // تلاش مجدد خودکار: پس از برقراری دوباره اتصال، فهرست از سرور تازه می‌شود
    socket.on('connect', scheduleReload)
    return () => {
      socket.off('message:new', onNew)
      socket.off('message:updated', onNew)
      socket.off('message:deleted', onNew)
      socket.off('dm:read', onRead)
      socket.off('group:updated', onGroupChange)
      socket.off('group:removed', onGroupChange)
      socket.off('rooms-refreshed', scheduleReload)
      socket.off('connect', scheduleReload)
    }
  }, [load])

  // جست‌وجوی «نام» گفتگوها و گروه‌ها — محتوای پیام‌های درون گفتگوها جست‌وجو نمی‌شود
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const query = q.trim()
    if (query.length < 2) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chats/search?q=${encodeURIComponent(query)}`, {
          cache: 'no-store',
        })
        if (res.ok) setSearchResults(await res.json())
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  async function openNewChat() {
    setNewChatOpen(true)
    setCandidates(null)
    const res = await fetch('/api/chats/candidates', { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      setCandidates(data.candidates ?? [])
      setDmEnabled(data.enabled !== false)
    } else {
      setCandidates([])
    }
    // گروه‌های عمومی مدرسه (فقط برای مدیر مدرسه بارگذاری می‌شود)
    if (role === 'SCHOOL_ADMIN') {
      setSgError(null)
      const gRes = await fetch('/api/groups/school', { cache: 'no-store' })
      if (gRes.ok) {
        const gData = await gRes.json()
        setSchoolGroups(gData.groups ?? [])
      } else {
        setSchoolGroups([])
      }
    }
  }

  const SG_DEFAULTS: Record<'STAFF' | 'ALL' | 'GRADE', string> = {
    STAFF: 'گروه همکاران',
    ALL: 'گروه عمومی مدرسه',
    GRADE: 'گروه پایه',
  }

  function switchSgType(t: 'STAFF' | 'ALL' | 'GRADE') {
    setSgType(t)
    setSgName(SG_DEFAULTS[t])
    setSgError(null)
  }

  async function createSchoolGroup() {
    setSgCreating(true)
    setSgError(null)
    try {
      const res = await fetch('/api/groups/school', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: sgType,
          name: sgName.trim() || SG_DEFAULTS[sgType],
          grade: sgType === 'GRADE' ? sgGrade : undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setSgError(data?.error ?? 'ایجاد گروه ناموفق بود')
        return
      }
      setNewChatOpen(false)
      // ناوبری پس از پاک‌سازی history دیالوگ — بدون race با back پاک‌ساز
      navigateAfterDialogClose(() => router.push(`/chats/group/${data.group.id}`))
    } finally {
      setSgCreating(false)
    }
  }

  function openConversation(key: string) {
    const [kind, id] = key.split(':')
    if (kind === 'assistant') {
      router.push('/assistant')
      return
    }
    // نشان ورود از فهرست گفتگوها — دکمهٔ back چت با back طبیعی برمی‌گردد (بدون ورودی اضافه)
    try {
      sessionStorage.setItem('daniar-chat-entry', 'list')
    } catch {
      /* private mode */
    }
    router.push(kind === 'group' ? `/chats/group/${id}` : `/chats/dm/${id}`)
  }

  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0)
  const listItems = searchResults ? null : conversations

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* سربرگ فهرست */}
      <div className="p-3 border-b space-y-2.5 bg-card">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 -translate-y-1/2 right-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جست‌وجوی نام گفتگوها…"
              className="pr-8 h-9 text-sm"
              aria-label="جست‌وجو"
            />
          </div>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0"
            onClick={openNewChat}
            aria-label="گفتگوی جدید"
            title="گفتگوی جدید"
          >
            <Plus className="h-4.5 w-4.5" />
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {searchResults
              ? 'نتایج جست‌وجو'
              : `گفتگوها${totalUnread > 0 ? ` — ${faNum(totalUnread)} نخوانده` : ''}`}
          </span>
          {/* وضعیت واقعی اتصال بلادرنگ — متصل / درحال اتصال / قطع (تلاش مجدد خودکار است) */}
          <ConnectionBadge className="text-[11px]" />
        </div>
      </div>

      {/* آیتم‌ها */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : searchResults ? (
          <div className="divide-y">
            {searchResults.conversations.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                نتیجه‌ای یافت نشد
              </p>
            )}
            {searchResults.conversations.length > 0 && (
              <div className="py-1">
                <p className="px-4 py-1.5 text-xs font-medium text-muted-foreground">
                  گفتگوها
                </p>
                {searchResults.conversations.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => openConversation(c.key)}
                    className="w-full text-right px-4 py-2.5 hover:bg-accent transition-colors"
                  >
                    <div className="text-sm font-medium">{c.title}</div>
                    <div className="text-xs text-muted-foreground">{c.subtitle}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : listItems && listItems.length === 0 ? (
          <div className="text-center py-12 px-6">
            <Users className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              هنوز گفتگویی ندارید. گروه‌های درسی شما و گفتگوهای خصوصی اینجا نمایش داده می‌شوند.
            </p>
          </div>
        ) : (
          listItems && (
            <ul className="divide-y">
              {listItems.map((c) => (
                <li key={c.key}>
                  <button
                    onClick={() => openConversation(c.key)}
                    className={cn(
                      'w-full text-right flex gap-3 px-3.5 py-3 hover:bg-accent transition-colors',
                      currentKey === c.key && 'bg-accent',
                    )}
                  >
                    <Avatar className="h-11 w-11 shrink-0">
                      <AvatarFallback
                        className={cn(
                          'text-sm font-bold',
                          c.type === 'GROUP'
                            ? 'bg-primary/10 text-primary'
                            : c.type === 'ASSISTANT'
                              ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                              : 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
                        )}
                      >
                        {c.type === 'GROUP' ? (
                          <Users className="h-5 w-5" />
                        ) : c.type === 'ASSISTANT' ? (
                          <Sparkles className="h-5 w-5" />
                        ) : (
                          c.title.trim().charAt(0)
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold truncate flex-1">
                          {c.title}
                        </span>
                        {c.type === 'ASSISTANT' && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 h-4.5 shrink-0">
                            هوش مصنوعی
                          </Badge>
                        )}
                        {c.archived && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 h-4.5 gap-0.5">
                            <Archive className="h-3 w-3" />
                            بایگانی
                          </Badge>
                        )}
                        {c.lastMessage && (
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {chatTime(c.lastMessage.at)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p
                          className={cn(
                            'text-xs truncate flex-1',
                            c.unread > 0
                              ? 'font-medium text-foreground'
                              : 'text-muted-foreground',
                          )}
                        >
                          {c.lastMessage
                            ? `${
                                c.type === 'GROUP' && !c.lastMessage.mine
                                  ? c.lastMessage.senderName + ': '
                                  : ''
                              }${c.lastMessage.preview}`
                            : c.type === 'ASSISTANT'
                              ? c.subtitle
                              : 'بدون پیام'}
                        </p>
                        {c.unread > 0 && (
                          <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">
                            {faNum(c.unread)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {/* گفتگوی جدید */}
      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>گفتگوی جدید</DialogTitle>
          </DialogHeader>

          {/* گروه‌های عمومی مدرسه — فقط مدیر مدرسه */}
          {role === 'SCHOOL_ADMIN' && (
            <div className="rounded-xl border p-3 space-y-3 bg-muted/30">
              <div className="flex items-center gap-1.5 text-sm font-bold">
                <UsersRound className="h-4 w-4 text-primary" />
                گروه‌های عمومی مدرسه
              </div>
              <p className="text-[11px] text-muted-foreground leading-5">
                اعضا به‌صورت خودکار عضو می‌شوند و کاربران جدید هم خودکار اضافه می‌شوند.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => switchSgType('STAFF')}
                  className={cn(
                    'text-right rounded-lg border p-2.5 transition-colors',
                    sgType === 'STAFF' ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                  )}
                >
                  <div className="text-xs font-bold">گروه همکاران</div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5 leading-4">
                    همه معلمان و مدیر مدرسه
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => switchSgType('ALL')}
                  className={cn(
                    'text-right rounded-lg border p-2.5 transition-colors',
                    sgType === 'ALL' ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                  )}
                >
                  <div className="text-xs font-bold">گروه عمومی</div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5 leading-4">
                    کل دانش‌آموزان، معلمان و مدیر
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => switchSgType('GRADE')}
                  className={cn(
                    'text-right rounded-lg border p-2.5 transition-colors col-span-2',
                    sgType === 'GRADE' ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                  )}
                >
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <GraduationCap className="h-3.5 w-3.5" />
                    گروه بر اساس پایه
                  </div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5 leading-4">
                    مثلاً همه پایه هفتمی‌ها: دانش‌آموزان هفتم ۷۰۱، ۷۰۲، ۷۰۳ + معلمان همان پایه
                  </div>
                </button>
              </div>

              {sgType === 'GRADE' && (
                <div className="space-y-1.5">
                  <Label htmlFor="sg-grade" className="text-xs">
                    انتخاب پایه
                  </Label>
                  <Select value={sgGrade} onValueChange={setSgGrade}>
                    <SelectTrigger id="sg-grade" className="w-full h-9" aria-label="انتخاب پایه">
                      <SelectValue placeholder="انتخاب پایه" />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADE_OPTIONS.map((g) => (
                        <SelectItem key={g} value={g}>
                          پایه {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  value={sgName}
                  onChange={(e) => setSgName(e.target.value)}
                  placeholder="نام گروه"
                  className="h-9 text-sm"
                  maxLength={80}
                  aria-label="نام گروه عمومی"
                />
                <Button
                  size="sm"
                  className="h-9 shrink-0"
                  onClick={createSchoolGroup}
                  disabled={sgCreating || (sgType === 'GRADE' && !sgGrade)}
                >
                  {sgCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  ایجاد
                </Button>
              </div>
              {sgError && <p className="text-[11px] text-destructive">{sgError}</p>}

              {schoolGroups && schoolGroups.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-muted-foreground">گروه‌های عمومی فعلی</p>
                  <ul className="divide-y rounded-lg border bg-background">
                    {schoolGroups.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setNewChatOpen(false)
                            navigateAfterDialogClose(() => router.push(`/chats/group/${g.id}`))
                          }}
                          className="w-full text-right px-2.5 py-2 hover:bg-accent transition-colors flex items-center gap-2"
                        >
                          <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs font-medium truncate flex-1">{g.name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {g.scope === 'SCHOOL_STAFF'
                              ? 'همکاران'
                              : g.scope === 'SCHOOL_ALL'
                                ? 'عمومی'
                                : `پایه ${g.grade ?? ''}`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground">شروع گفتگوی خصوصی</p>
            {candidates === null ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !dmEnabled ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                پیام خصوصی برای مدرسه شما فعال نیست
              </p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                کاربری برای گفتگو یافت نشد
              </p>
            ) : (
              <ul className="max-h-64 overflow-y-auto divide-y -mx-2">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        setNewChatOpen(false)
                        navigateAfterDialogClose(() => router.push(`/chats/dm/${c.id}`))
                      }}
                      className="w-full text-right flex items-center gap-3 px-2 py-2.5 hover:bg-accent rounded-lg transition-colors"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 text-sm font-bold">
                          {c.fullName.trim().charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{c.fullName}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.label}
                          {c.note ? ` — ${c.note}` : ''}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** نمای placeholder سمت راست در دسکتاپ وقتی گفتگویی انتخاب نشده */
export function EmptyChatPane() {
  return (
    <div className="hidden lg:flex flex-1 flex-col items-center justify-center text-center gap-3 bg-muted/30 min-h-[60vh]">
      <Megaphone className="h-12 w-12 text-muted-foreground/30" />
      <p className="text-muted-foreground text-sm">
        یک گفتگو را از فهرست انتخاب کنید
      </p>
      <p className="text-xs text-muted-foreground/70 flex items-center gap-1">
        <FileText className="h-3.5 w-3.5" />
        پیام‌ها به‌صورت بلادرنگ دریافت می‌شوند
      </p>
    </div>
  )
}

export type { ChatMessage }
