'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Users, Plus, Loader2, Inbox } from 'lucide-react'
import { navigateAfterDialogClose } from '@/lib/dialog-history'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog'
import { chatTime, roleLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

interface LastMessage {
  body: string
  createdAt: string
  sender?: string
  mine?: boolean
}

interface GroupChat {
  type: 'GROUP'
  id: string
  title: string
  subtitle: string
  teachers: string[]
  lastMessage: LastMessage | null
}

interface DmChat {
  type: 'DM'
  id: string
  title: string
  subtitle: string
  lastMessage: LastMessage
  unread: number
}

type ChatItem = GroupChat | DmChat

interface Candidate {
  id: string
  fullName: string
  role: string
  username: string
}

export function ChatList() {
  const router = useRouter()
  const [groupChats, setGroupChats] = useState<GroupChat[]>([])
  const [dmChats, setDmChats] = useState<DmChat[]>([])
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/chats')
      if (res.ok) {
        const data = await res.json()
        setGroupChats(data.groupChats)
        setDmChats(data.dmChats)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  async function openNewChatDialog(open: boolean) {
    setDialogOpen(open)
    if (open) {
      const res = await fetch('/api/chats/candidates')
      if (res.ok) {
        const data = await res.json()
        setCandidates(data.users)
      } else {
        setCandidates([])
      }
    }
  }

  function initials(name: string) {
    return name.trim().charAt(0)
  }

  function previewText(item: ChatItem): string {
    if (!item.lastMessage) return 'هنوز پیامی رد و بدل نشده است'
    const lm = item.lastMessage
    const prefix = lm.mine ? 'شما: ' : lm.sender ? `${lm.sender}: ` : ''
    return prefix + lm.body
  }

  return (
    <div className="max-w-2xl mx-auto px-3 py-4 sm:px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MessageCircle className="h-6 w-6 text-primary" />
          گفتگوها
        </h1>
        <Dialog open={dialogOpen} onOpenChange={openNewChatDialog}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              گفتگوی خصوصی جدید
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[70vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>شروع گفتگوی خصوصی</DialogTitle>
              <DialogDescription>
                فقط کاربران هم‌مدرسه‌ای شما در این فهرست هستند.
              </DialogDescription>
            </DialogHeader>
            {candidates === null ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                کاربری برای گفتگو یافت نشد.
              </p>
            ) : (
              <div className="space-y-1">
                {candidates.map((u) => (
                  <button
                    key={u.id}
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-right hover:bg-accent transition-colors"
                    onClick={() => {
                      setDialogOpen(false)
                      navigateAfterDialogClose(() => router.push(`/chats/dm/${u.id}`))
                    }}
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-primary/10 text-primary font-bold">
                        {initials(u.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.fullName}</div>
                      <div className="text-xs text-muted-foreground">{roleLabel(u.role)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="groups">
        <TabsList className="grid grid-cols-2 w-full mb-3">
          <TabsTrigger value="groups" className="gap-1.5">
            <Users className="h-4 w-4" />
            گروه‌های درسی
          </TabsTrigger>
          <TabsTrigger value="dms" className="gap-1.5">
            <MessageCircle className="h-4 w-4" />
            گفتگوی خصوصی
            {dmChats.reduce((s, c) => s + c.unread, 0) > 0 && (
              <Badge variant="destructive" className="px-1.5 h-5">
                {dmChats.reduce((s, c) => s + c.unread, 0)}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="groups" className="space-y-1">
          {loading ? (
            <ChatSkeleton />
          ) : groupChats.length === 0 ? (
            <EmptyState text="هنوز گروهی ندارید. گروه‌های درسی توسط مدیر مدرسه ایجاد می‌شوند." />
          ) : (
            groupChats.map((g) => (
              <ChatRow
                key={g.id}
                onClick={() => router.push(`/chats/group/${g.id}`)}
                avatar={initials(g.title)}
                avatarIcon="group"
                title={g.title}
                subtitle={g.subtitle}
                preview={previewText(g)}
                time={g.lastMessage ? chatTime(g.lastMessage.createdAt) : undefined}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="dms" className="space-y-1">
          {loading ? (
            <ChatSkeleton />
          ) : dmChats.length === 0 ? (
            <EmptyState text="گفتگوی خصوصی ندارید. از دکمه «گفتگوی خصوصی جدید» شروع کنید." />
          ) : (
            dmChats.map((d) => (
              <ChatRow
                key={d.id}
                onClick={() => router.push(`/chats/dm/${d.id}`)}
                avatar={initials(d.title)}
                title={d.title}
                subtitle={d.subtitle}
                preview={previewText(d)}
                time={chatTime(d.lastMessage.createdAt)}
                unread={d.unread}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ChatRow({
  onClick,
  avatar,
  avatarIcon,
  title,
  subtitle,
  preview,
  time,
  unread,
}: {
  onClick: () => void
  avatar: string
  avatarIcon?: 'group'
  title: string
  subtitle?: string
  preview: string
  time?: string
  unread?: number
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-right hover:bg-accent transition-colors"
    >
      <Avatar className="h-11 w-11 shrink-0">
        <AvatarFallback
          className={cn(
            'font-bold',
            avatarIcon === 'group' ? 'bg-primary/15 text-primary' : 'bg-primary/10 text-primary'
          )}
        >
          {avatar}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm truncate">{title}</span>
          {time && <span className="text-[11px] text-muted-foreground shrink-0">{time}</span>}
        </div>
        {subtitle && (
          <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
        )}
        <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
      </div>
      {(unread ?? 0) > 0 && (
        <Badge variant="destructive" className="shrink-0 rounded-full px-2 min-w-5 h-5">
          {unread}
        </Badge>
      )}
    </button>
  )
}

function ChatSkeleton() {
  return (
    <div className="space-y-3 py-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3">
          <div className="h-11 w-11 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 bg-muted rounded animate-pulse" />
            <div className="h-3 w-2/3 bg-muted rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
        <Inbox className="h-7 w-7 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{text}</p>
    </div>
  )
}
