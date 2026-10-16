'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  FormEvent,
} from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, SendHorizonal, Loader2, ArrowRightCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { chatTime, faDate, roleLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface ChatMessage {
  id: string
  senderId: string
  body: string
  createdAt: string
  sender?: { id: string; fullName: string; role: string }
}

interface ChatViewProps {
  endpoint: string
  /** عنوان اولیه؛ برای گروه/خصوصی از پاسخ سرور به‌روزرسانی می‌شود */
  title?: string
  subtitle?: string
  myId: string
  showSenderNames: boolean
}

export function ChatView({
  endpoint,
  title: initialTitle,
  subtitle: initialSubtitle,
  myId,
  showSenderNames,
}: ChatViewProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [title, setTitle] = useState(initialTitle ?? '')
  const [subtitle, setSubtitle] = useState(initialSubtitle ?? '')
  const [otherRole, setOtherRole] = useState<string | undefined>(undefined)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCountRef = useRef(0)

  const load = useCallback(
    async (silent = false) => {
      try {
        const res = await fetch(endpoint)
        if (res.status === 404 || res.status === 403) {
          setError('این گفتگو یافت نشد یا دسترسی به آن ندارید.')
          setMessages([])
          return
        }
        if (!res.ok) return
        const data = await res.json()
        if (data.group) {
          setTitle(data.group.name)
          setSubtitle(`کلاس ${data.group.className}`)
        }
        if (data.other) {
          setTitle(data.other.fullName)
          setOtherRole(data.other.role)
        }
        setMessages(data.messages)
      } catch {
        if (!silent) setError('خطا در دریافت پیام‌ها')
      }
    },
    [endpoint]
  )

  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 4000)
    return () => clearInterval(t)
  }, [load])

  // اسکرول به پایین هنگام پیام جدید
  useEffect(() => {
    if (messages && messages.length !== lastCountRef.current) {
      lastCountRef.current = messages.length
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [])

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (res.ok) {
        setText('')
        await load(true)
      }
    } finally {
      setSending(false)
    }
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-4">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => router.push('/chats')}>
          <ArrowRight className="h-4 w-4" />
          بازگشت به گفتگوها
        </Button>
      </div>
    )
  }

  let lastDay = ''

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] lg:h-screen">
      {/* هدر گفتگو */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-card/95 backdrop-blur px-3 py-2.5 lg:px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/chats')}
          aria-label="بازگشت"
        >
          <ArrowRight className="h-5 w-5" />
        </Button>
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-primary/15 text-primary font-bold">
            {(title || '؟').charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{title || '…'}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {otherRole ? roleLabel(otherRole) : subtitle}
          </div>
        </div>
      </header>

      {/* پیام‌ها */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-4 lg:px-6 space-y-1.5"
        dir="rtl"
      >
        {messages === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-center">
            <ArrowRightCircle className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              اولین پیام این گفتگو را بفرستید
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === myId
            const day = faDate(m.createdAt)
            const showDay = day !== lastDay
            lastDay = day
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="flex justify-center my-3">
                    <span className="text-[11px] bg-muted text-muted-foreground rounded-full px-3 py-1">
                      {day}
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    'flex',
                    mine ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[78%] sm:max-w-[65%] rounded-2xl px-3.5 py-2 shadow-sm',
                      mine ? 'chat-bubble-me rounded-br-md' : 'chat-bubble-other rounded-bl-md'
                    )}
                  >
                    {showSenderNames && !mine && m.sender && (
                      <div className="text-[11px] font-bold mb-0.5 text-primary">
                        {m.sender.fullName}
                      </div>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {m.body}
                    </p>
                    <div
                      className={cn(
                        'text-[10px] mt-1 flex justify-end',
                        mine ? 'text-primary-foreground/70' : 'text-muted-foreground'
                      )}
                    >
                      {chatTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* ورودی پیام */}
      <div className="sticky bottom-0 border-t bg-card/95 backdrop-blur px-3 py-2.5 lg:px-6"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
      >
        <form onSubmit={send} className="flex items-center gap-2 max-w-3xl mx-auto">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="پیام خود را بنویسید…"
            aria-label="متن پیام"
            maxLength={2000}
            className="flex-1 rounded-full"
          />
          <Button
            type="submit"
            size="icon"
            className="rounded-full shrink-0"
            disabled={sending || !text.trim()}
            aria-label="ارسال پیام"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizonal className="h-4 w-4 -scale-x-100" />
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
