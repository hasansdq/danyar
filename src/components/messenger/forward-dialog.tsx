'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Forward,
  Loader2,
  Search,
  Users,
  User,
  Check,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ChatMessage } from './types'

interface ForwardTargetOption {
  key: string
  kind: 'GROUP' | 'DIRECT'
  id: string
  title: string
  subtitle: string
}

interface ForwardResult {
  kind: 'GROUP' | 'DIRECT'
  id: string
  ok: boolean
  error?: string
}

interface ForwardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  message: ChatMessage | null
  onForwarded?: () => void
}

const MAX_TARGETS = 10

/**
 * دیالوگ هدایت پیام — انتخاب یک یا چند گفتگوی مقصد (گروه/خصوصی).
 * فهرست گفتگوها از سرور خوانده می‌شود و مجوز نهایی هنگام هدایت سمت سرور کنترل می‌شود.
 */
export function ForwardDialog({
  open,
  onOpenChange,
  message,
  onForwarded,
}: ForwardDialogProps) {
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [options, setOptions] = useState<ForwardTargetOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  // بارگذاری فهرست گفتگوها هنگام باز شدن
  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setQuery('')
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/chats', { cache: 'no-store' })
        if (!res.ok || !alive) return
        const data = await res.json()
        const items = Array.isArray(data?.conversations) ? data.conversations : []
        const opts: ForwardTargetOption[] = items
          .filter(
            (c: { type: string; id: string }) =>
              (c.type === 'GROUP' || c.type === 'DM') && c.id,
          )
          .map(
            (c: {
              type: 'GROUP' | 'DM'
              id: string
              title: string
              subtitle?: string
              archived?: boolean
            }) => ({
              key: `${c.type}:${c.id}`,
              kind: c.type,
              id: c.id,
              title: c.title,
              subtitle:
                c.type === 'GROUP'
                  ? `${c.subtitle ?? ''}${c.archived ? ' — بایگانی‌شده' : ''}`
                  : c.subtitle ?? '',
            }),
          )
        if (alive) setOptions(opts)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return options
    return options.filter(
      (o) => o.title.includes(q) || o.subtitle.includes(q),
    )
  }, [options, query])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else if (next.size < MAX_TARGETS) {
        next.add(key)
      } else {
        toast.error(`حداکثر ${MAX_TARGETS} گفتگوی مقصد می‌توانید انتخاب کنید`)
      }
      return next
    })
  }

  const submit = async () => {
    if (!message || selected.size === 0 || sending) return
    setSending(true)
    try {
      const targets = options
        .filter((o) => selected.has(o.key))
        .map((o) => ({ kind: o.kind, id: o.id }))
      const res = await fetch(`/api/messages/${message.id}/forward`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? 'هدایت پیام ناموفق بود')
        return
      }
      const results: ForwardResult[] = data?.results ?? []
      const okCount = results.filter((r) => r.ok).length
      const failures = results.filter((r) => !r.ok)
      if (okCount > 0 && failures.length === 0) {
        toast.success(`پیام به ${okCount} گفتگو هدایت شد`)
        onOpenChange(false)
        onForwarded?.()
      } else if (okCount > 0 && failures.length > 0) {
        toast.warning(
          `${okCount} گفتگو موفق — ${failures.length} ناموفق: ${failures[0].error ?? ''}`,
          { duration: 6000 },
        )
        onOpenChange(false)
        onForwarded?.()
      } else {
        toast.error(failures[0]?.error ?? 'هدایت پیام ناموفق بود')
      }
    } catch {
      toast.error('خطا در ارتباط با سرور')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Forward className="h-4 w-4 text-primary" />
            هدایت پیام
          </DialogTitle>
          <DialogDescription className="text-xs">
            گفتگوهای مقصد را انتخاب کنید (حداکثر {MAX_TARGETS} مورد)
            {message?.body?.trim() ? ` — «${message.body.slice(0, 40)}${message.body.length > 40 ? '…' : ''}»` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جست‌وجوی گفتگو…"
            className="pr-8 h-9 text-sm"
            aria-label="جست‌وجوی گفتگو برای هدایت"
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border divide-y -mx-1 px-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">
              گفتگویی یافت نشد
            </p>
          ) : (
            filtered.map((o) => {
              const checked = selected.has(o.key)
              return (
                <label
                  key={o.key}
                  className={cn(
                    'flex items-center gap-2.5 px-2 py-2 cursor-pointer hover:bg-accent/50 transition-colors',
                    checked && 'bg-primary/5',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(o.key)}
                    aria-label={`هدایت به ${o.title}`}
                  />
                  <span
                    className={cn(
                      'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
                      o.kind === 'GROUP'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {o.kind === 'GROUP' ? (
                      <Users className="h-4 w-4" />
                    ) : (
                      <User className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">
                      {o.title}
                    </span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {o.subtitle}
                    </span>
                  </span>
                  {checked && <Check className="h-4 w-4 text-primary shrink-0" />}
                </label>
              )
            })
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            <X className="h-4 w-4 ml-1" />
            انصراف
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={sending || selected.size === 0 || loading}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 ml-1 animate-spin" />
            ) : (
              <Forward className="h-4 w-4 ml-1" />
            )}
            هدایت{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
