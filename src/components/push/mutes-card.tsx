'use client'

import { useEffect, useState } from 'react'
import { BellOff, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface MuteItem {
  chatType: string
  chatKey: string
  title: string
  subtitle: string
}

/**
 * فهرست گفتگوهای بی‌صدا — بی‌صدایی هم اعلان درون‌برنامه‌ای و هم پوش
 * پیام‌های آن گفتگو را متوقف می‌کند، اما پیام‌ها و شمارنده نخوانده باقی می‌مانند.
 */
export function MutesCard({ className }: { className?: string }) {
  const { toast } = useToast()
  const [mutes, setMutes] = useState<MuteItem[] | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/me/mutes', { cache: 'no-store' })
        if (res.ok) {
          const d = await res.json()
          setMutes(d.items)
        }
      } catch {
        setMutes([])
      }
    })()
  }, [])

  async function unmute(item: MuteItem) {
    const res = await fetch('/api/me/mutes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatType: item.chatType, chatKey: item.chatKey, muted: false }),
    })
    if (res.ok) {
      setMutes((prev) =>
        (prev ?? []).filter((m) => !(m.chatType === item.chatType && m.chatKey === item.chatKey)),
      )
      toast({ title: 'صدادار شد' })
    } else {
      toast({ title: 'عملیات ناموفق بود', variant: 'destructive' })
    }
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BellOff className="h-4.5 w-4.5 text-primary" />
          گفتگوهای بی‌صدا
        </CardTitle>
        <CardDescription>
          گفتگوها را از سربرگ همان گفتگو می‌توانید بی‌صدا کنید. اطلاعیه رسمی مدرسه تحت تأثیر بی‌صدایی نیست.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {mutes === null ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : mutes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">هیچ گفتگویی بی‌صدا نیست</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1.5">
            {mutes.map((m) => (
              <div
                key={`${m.chatType}:${m.chatKey}`}
                className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{m.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{m.subtitle}</div>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => unmute(m)}>
                  صدادار کردن
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
