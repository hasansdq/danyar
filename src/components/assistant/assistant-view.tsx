'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Loader2,
  Send,
  Square,
  Sparkles,
  Plus,
  Trash2,
  History,
  ClipboardList,
  School as SchoolIcon,
  BookOpen,
  CalendarDays,
  User as UserIcon,
  Users as UsersIcon,
  FileText,
  CircleAlert,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatTime, faNum } from '@/lib/format'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { AssistantMarkdown } from './markdown'

interface AiStatus {
  available: boolean
  code: string
  message: string
  limit: number | null
  usedToday: number
}

interface AiRef {
  kind: 'assignment' | 'class' | 'group' | 'student' | 'event' | 'teacher' | 'sampleq'
  id: string
  title: string
}

interface AiMsg {
  id: number | string
  role: 'USER' | 'ASSISTANT'
  content: string
  refs: AiRef[]
  stopped: boolean
  createdAt: string
  /** پیام موقت محلی پیش از تأیید سرور */
  transient?: boolean
}

interface ConvInfo {
  id: number
  title: string
  updatedAt: string
  messageCount: number
}

const MAX_BODY = 4000

function clientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const SUGGESTIONS = [
  'وضعیت ارسال تکالیف و بازخوردهای مدرسه را خلاصه کن',
  'یک گزارش مدیریتی از وضعیت آموزشی مدرسه بنویس',
  'آمار کل تقویم آموزشی مدرسه را نشان بده',
  'فهرست معلمان و گروه‌هایی که تدریس می‌کنند را نشان بده',
  'نمونه‌سؤال‌های منتشرشده مدرسه را فهرست کن',
  'پیش‌نویس اطلاعیه برای جشن پایان سال تهیه کن',
]

const REF_LABEL: Record<AiRef['kind'], string> = {
  assignment: 'تکلیف',
  class: 'کلاس',
  group: 'گروه درسی',
  student: 'دانش‌آموز',
  event: 'رویداد تقویم',
  teacher: 'معلم',
  sampleq: 'نمونه‌سؤال',
}

function refIcon(kind: AiRef['kind']) {
  const cls = 'h-3 w-3'
  if (kind === 'assignment') return <ClipboardList className={cls} />
  if (kind === 'class') return <SchoolIcon className={cls} />
  if (kind === 'group') return <BookOpen className={cls} />
  if (kind === 'event') return <CalendarDays className={cls} />
  if (kind === 'teacher') return <UsersIcon className={cls} />
  if (kind === 'sampleq') return <FileText className={cls} />
  return <UserIcon className={cls} />
}

export function AssistantView() {
  const router = useRouter()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [convs, setConvs] = useState<ConvInfo[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<AiMsg[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState('')
  const [streamText, setStreamText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string; count: number } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const streamBoxRef = useRef<HTMLDivElement | null>(null)

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' })
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/assistant/status', { cache: 'no-store' })
      if (res.ok) setStatus((await res.json()).status)
    } catch {
      /* شبکه */
    }
  }, [])

  const loadConvs = useCallback(async (): Promise<ConvInfo[]> => {
    try {
      const res = await fetch('/api/assistant/conversations', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        const list = (data.conversations ?? []) as ConvInfo[]
        setConvs(list)
        return list
      }
    } catch {
      /* شبکه */
    }
    return []
  }, [])

  const loadMessages = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/assistant/conversations/${id}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setMessages(
          (data.messages ?? []).map((m: Record<string, unknown>) => ({
            id: m.id as number,
            role: m.role as 'USER' | 'ASSISTANT',
            content: m.content as string,
            refs: (m.refs ?? []) as AiRef[],
            stopped: !!m.stopped,
            createdAt: m.createdAt as string,
          })),
        )
      }
    } catch {
      /* شبکه */
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      await loadStatus()
      const list = await loadConvs()
      if (list.length > 0) {
        setActiveId(list[0].id)
        await loadMessages(list[0].id)
      }
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    scrollToBottom(false)
  }, [messages.length, loading, scrollToBottom])

  useEffect(() => {
    if (streamBoxRef.current) streamBoxRef.current.scrollTop = streamBoxRef.current.scrollHeight
  }, [streamText, genStatus])

  /**
   * خواندن جریان SSE مشترک ارسال/تلاش مجدد.
   * پس از پایان، وضعیت واقعی از سرور بازخوانی می‌شود تا UI همیشه با داده
   * ذخیره‌شده یکی باشد (پاسخ کامل، نیمه‌کاره متوقف‌شده، یا هیچ‌چیز پس از خطا).
   */
  const streamChat = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      opts: { optimisticUser: boolean },
    ): Promise<{ ok: boolean; convId: number | null }> => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setGenerating(true)
      setSendError(null)
      setCanRetry(false)
      setStreamText('')
      setGenStatus('در حال آماده‌سازی…')

      let convId: number | null = null
      let stopped = false
      let errorMessage: string | null = null
      let httpRejected = false

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        })

        if (!res.ok || !res.body) {
          httpRejected = true
          const data = await res.json().catch(() => ({}))
          errorMessage = (data as { error?: string }).error ?? 'ارسال ناموفق بود'
        } else {
          const headerConv = res.headers.get('X-Assistant-Conversation')
          if (headerConv) convId = Number(headerConv)
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          let sawDone = false
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const parts = buf.split('\n\n')
            buf = parts.pop() ?? ''
            for (const part of parts) {
              const line = part.trim()
              if (!line.startsWith('data:')) continue
              let ev: Record<string, unknown>
              try {
                ev = JSON.parse(line.slice(5).trim())
              } catch {
                continue
              }
              if (ev.t === 'status') {
                setGenStatus(String(ev.text ?? ''))
              } else if (ev.t === 'tool') {
                setGenStatus(String(ev.label ?? ''))
              } else if (ev.t === 'delta') {
                setStreamText((prev) => prev + String(ev.text ?? ''))
              } else if (ev.t === 'done') {
                sawDone = true
                stopped = !!ev.stopped
                setGenStatus('')
              } else if (ev.t === 'error') {
                errorMessage = String(ev.message ?? 'خطای سرویس هوش مصنوعی')
                setGenStatus('')
              }
            }
          }
          if (!sawDone && !errorMessage && !stopped) {
            errorMessage = 'اتصال در میانه پاسخ قطع شد'
          }
        }
      } catch (e) {
        const err = e as Error
        if (err.name === 'AbortError') {
          stopped = true
        } else {
          errorMessage = 'ارتباط با سرور برقرار نشد'
          httpRejected = true
        }
      } finally {
        abortRef.current = null
        setGenerating(false)
        setGenStatus('')
        setStreamText('')

        if (convId !== null) {
          if (activeId === null || opts.optimisticUser) {
            // گفتگوی تازه یا تغییر مقصد → فعال‌سازی و همگام‌سازی با سرور
            if (activeId !== convId) setActiveId(convId)
            await loadMessages(convId)
          } else {
            await loadMessages(convId)
          }
        }

        if (errorMessage) {
          setSendError(errorMessage)
          setCanRetry(!httpRejected && convId !== null)
          // اگر درخواست در گیت سرور رد شد، پیام موقت کاربر حذف می‌شود
          if (httpRejected && opts.optimisticUser) {
            setMessages((prev) => prev.filter((m) => !m.transient))
          }
        } else if (stopped) {
          // توقف: بازخوانی انجام شده؛ اگر چیزی ذخیره نشده بود به کاربر می‌گوییم
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (!last || last.role === 'USER') {
              setSendError('تولید پاسخ متوقف شد و متنی ذخیره نشد. می‌توانید دوباره تلاش کنید.')
              setCanRetry(true)
            }
            return prev
          })
        }
        loadConvs()
        loadStatus()
      }

      return { ok: !errorMessage, convId }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, loadConvs, loadMessages, loadStatus],
  )

  async function send(text?: string) {
    if (generating) return
    const content = (text ?? input).trim()
    if (!content || content.length > MAX_BODY) return
    if (text === undefined) setInput('')

    setMessages((prev) => [
      ...prev,
      {
        id: `pending-${Date.now()}`,
        role: 'USER',
        content,
        refs: [],
        stopped: false,
        createdAt: new Date().toISOString(),
        transient: true,
      },
    ])
    scrollToBottom()

    await streamChat(
      '/api/assistant/chat',
      { conversationId: activeId, content, clientId: clientId() },
      { optimisticUser: true },
    )
  }

  async function retry() {
    if (generating || activeId === null) return
    setSendError(null)
    await streamChat('/api/assistant/retry', { conversationId: activeId }, { optimisticUser: false })
  }

  function stop() {
    abortRef.current?.abort()
  }

  async function newConversation() {
    if (generating) return
    const res = await fetch('/api/assistant/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (res.ok) {
      const data = await res.json()
      const conv = data.conversation as ConvInfo
      setConvs((prev) => [conv, ...prev])
      setActiveId(conv.id)
      setMessages([])
      setSendError(null)
    }
  }

  function requestDelete() {
    if (generating || activeId === null) return
    const conv = convs.find((c) => c.id === activeId)
    if (!conv) return
    fetch(`/api/assistant/conversations/${activeId}`, { method: 'DELETE' })
      .then(async (res) => {
        if (res.status === 409) {
          const data = await res.json()
          setDeleteTarget({ id: activeId, title: conv.title, count: data.messages ?? 0 })
        } else if (res.ok) {
          await afterDelete(activeId)
        } else {
          const data = await res.json().catch(() => ({}))
          setSendError((data as { error?: string }).error ?? 'حذف ناموفق بود')
        }
      })
      .catch(() => setSendError('ارتباط با سرور برقرار نشد'))
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const res = await fetch(`/api/assistant/conversations/${deleteTarget.id}?confirm=true`, { method: 'DELETE' })
    if (res.ok) await afterDelete(deleteTarget.id)
    setDeleteTarget(null)
  }

  async function afterDelete(id: number) {
    const rest = convs.filter((c) => c.id !== id)
    setConvs(rest)
    if (activeId === id) {
      if (rest.length > 0) {
        setActiveId(rest[0].id)
        await loadMessages(rest[0].id)
      } else {
        setActiveId(null)
        setMessages([])
      }
    }
  }

  const disabled = status !== null && !status.available
  const canSend = !generating && !disabled && input.trim().length > 0

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* سربرگ گفتگوی دستیار */}
      <div className="border-b bg-card px-3 py-2.5 flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden h-9 w-9 shrink-0"
          onClick={() => router.push('/')}
          aria-label="بازگشت به گفتگوها"
        >
          <ArrowRight className="h-5 w-5" />
        </Button>
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarFallback className="bg-violet-500/15 text-violet-600 dark:text-violet-400">
            <Sparkles className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">دستیار دانیار</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 h-4.5 shrink-0">هوش مصنوعی</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {status === null
              ? '…'
              : status.available
                ? `گفتگوی خصوصی شما${status.limit !== null ? ` — سهمیه امروز: ${faNum(status.usedToday)} از ${faNum(status.limit)}` : ''}`
                : status.message}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="گفتگوهای قبلی دستیار" title="گفتگوهای قبلی">
              <History className="h-4.5 w-4.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 max-h-80 overflow-y-auto">
            <DropdownMenuLabel>گفتگوهای من با دستیار</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {convs.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-3">هنوز گفتگویی ندارید</div>
            )}
            {convs.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => {
                  setActiveId(c.id)
                  setSendError(null)
                  loadMessages(c.id)
                }}
                className={cn('gap-2', c.id === activeId && 'bg-accent')}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{c.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {faNum(c.messageCount)} پیام • {chatTime(c.updatedAt)}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={newConversation}
          disabled={generating || disabled}
          aria-label="گفتگوی جدید دستیار"
          title="گفتگوی جدید"
        >
          <Plus className="h-4.5 w-4.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-destructive"
          onClick={requestDelete}
          disabled={generating || activeId === null}
          aria-label="حذف گفتگوی دستیار"
          title="حذف گفتگوی فعلی"
        >
          <Trash2 className="h-4.5 w-4.5" />
        </Button>
      </div>

      {/* بنر وضعیت واقعی */}
      {status !== null && !status.available && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 flex items-start gap-2 text-[13px] text-amber-700 dark:text-amber-400 shrink-0">
          <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{status.message}</p>
            <p className="text-[11px] opacity-80 mt-0.5">
              وضعیت واقعی سرویس نمایش داده می‌شود؛ پاسخ ساختگی تولید نخواهد شد.
            </p>
          </div>
        </div>
      )}

      {/* پیام‌ها */}
      <div ref={streamBoxRef} className="flex-1 overflow-y-auto min-h-0 bg-muted/20">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 && !generating && !sendError ? (
          <div className="max-w-lg mx-auto px-4 py-10 text-center">
            <div className="h-14 w-14 rounded-2xl bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="h-7 w-7" />
            </div>
            <h2 className="font-bold text-lg mb-1.5">دستیار دانیار</h2>
            <p className="text-sm text-muted-foreground leading-6 mb-6">
              کمک‌کار هوشمند شما برای پیگیری امور آموزشی مدرسه: خلاصه وضعیت تکالیف و بازخوردها،
              پیش‌نویس اطلاعیه و گزارش مدیریتی، و اطلاعات دانش‌آموزان مدرسه خودتان.
              دستیار فقط به اطلاعات مدرسه شما دسترسی دارد و منابع پاسخ را مشخص می‌کند.
            </p>
            {!disabled && (
              <div className="grid gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-right text-[13px] rounded-xl border bg-card px-3.5 py-2.5 hover:bg-accent transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 space-y-4">
            {messages.map((m) =>
              m.role === 'USER' ? (
                <div key={m.id} className="flex justify-start">
                  <div
                    className={cn(
                      'max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-ss-md px-3.5 py-2.5 text-sm leading-6 whitespace-pre-wrap break-words',
                      m.transient ? 'bg-primary/70 text-primary-foreground' : 'bg-primary text-primary-foreground',
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-se-md bg-card border px-3.5 py-2.5">
                    <AssistantMarkdown text={m.content} />
                    {m.stopped && (
                      <div className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                        <Square className="h-3 w-3" />
                        تولید توسط شما متوقف شد
                      </div>
                    )}
                    {m.refs.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-border/60">
                        <div className="text-[10px] text-muted-foreground mb-1.5">
                          پاسخ بر اساس این داده‌های برنامه تهیه شده:
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {m.refs.map((r) => (
                            <span
                              key={`${r.kind}-${r.id}`}
                              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground"
                            >
                              {refIcon(r.kind)}
                              {REF_LABEL[r.kind]}: {r.title}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}

            {/* حباب در حال تولید */}
            {generating && (
              <div className="flex justify-end">
                <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-se-md bg-card border px-3.5 py-2.5">
                  {streamText ? (
                    <AssistantMarkdown text={streamText} />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {genStatus || 'در حال تولید پاسخ…'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* خطا + تلاش مجدد */}
            {sendError && !generating && (
              <div className="flex justify-end">
                <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl bg-destructive/10 border border-destructive/30 px-3.5 py-3">
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="leading-6">{sendError}</p>
                      {canRetry && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-8 gap-1.5"
                          onClick={retry}
                          disabled={activeId === null}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          تلاش مجدد
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ناحیه ارسال */}
      <div className="border-t bg-card p-3 shrink-0">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={
              disabled
                ? 'دستیار در دسترس نیست'
                : generating
                  ? 'پاسخ در حال تولید است…'
                  : 'پیام خود را به دستیار بنویسید…'
            }
            rows={1}
            disabled={disabled || generating}
            maxLength={MAX_BODY}
            className="min-h-[44px] max-h-40 resize-none"
            aria-label="متن پیام به دستیار"
          />
          {generating ? (
            <Button
              size="icon"
              variant="outline"
              className="h-[44px] w-[44px] shrink-0"
              onClick={stop}
              aria-label="توقف تولید پاسخ"
              title="توقف تولید پاسخ"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-[44px] w-[44px] shrink-0"
              onClick={() => send()}
              disabled={!canSend}
              aria-label="ارسال پیام"
              title="ارسال"
            >
              <Send className="h-4.5 w-4.5 -scale-x-100" />
            </Button>
          )}
        </div>
        <p className="max-w-3xl mx-auto text-[10.5px] text-muted-foreground mt-1.5">
          دستیار فقط به اطلاعات مدرسه شما دسترسی دارد؛ تاریخچه گفتگو خصوصی شماست و مدیر کل به متن آن دسترسی ندارد.
        </p>
      </div>

      {/* تأیید حذف گفتگو */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4.5 w-4.5" />
              حذف گفتگو
            </DialogTitle>
            <DialogDescription>
              گفتگوی «{deleteTarget?.title}» شامل {faNum(deleteTarget?.count ?? 0)} پیام است. با حذف،
              کل تاریخچه این گفتگو برای همیشه پاک می‌شود و قابل بازگشت نیست.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-start pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              انصراف
            </Button>
            <Button variant="destructive" onClick={confirmDelete} className="gap-1.5">
              <Trash2 className="h-4 w-4" />
              حذف قطعی گفتگو
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
