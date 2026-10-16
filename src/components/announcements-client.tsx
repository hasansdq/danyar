'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Megaphone, Send, CheckSquare, Square } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

interface TargetClassroom {
  id: string
  name: string
  groups: { id: string; name: string; archived: boolean }[]
}

interface Selection {
  classrooms: Set<string>
  groups: Set<string>
}

export function AnnouncementsClient() {
  const [classrooms, setClassrooms] = useState<TargetClassroom[] | null>(null)
  const [selection, setSelection] = useState<Selection>({ classrooms: new Set(), groups: new Set() })
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/announcements', { cache: 'no-store' })
    if (res.ok) setClassrooms((await res.json()).classrooms)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function toggleClassroom(id: string) {
    setSelection((prev) => {
      const next = {
        classrooms: new Set(prev.classrooms),
        groups: new Set(prev.groups),
      }
      if (next.classrooms.has(id)) {
        next.classrooms.delete(id)
      } else {
        next.classrooms.add(id)
      }
      return next
    })
  }

  function toggleGroup(id: string) {
    setSelection((prev) => {
      const next = {
        classrooms: new Set(prev.classrooms),
        groups: new Set(prev.groups),
      }
      if (next.groups.has(id)) {
        next.groups.delete(id)
      } else {
        next.groups.add(id)
      }
      return next
    })
  }

  const hasSelection = selection.classrooms.size > 0 || selection.groups.size > 0

  async function send() {
    if (sending) return
    setSending(true)
    try {
      const res = await fetch('/api/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: body.trim(),
          classroomIds: [...selection.classrooms],
          subjectGroupIds: [...selection.groups],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ارسال ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: `اطلاعیه به ${data.delivered} گروه تحویل شد`,
        description: 'اعضا آن را در گفتگوی گروه‌های خود می‌بینند',
      })
      setBody('')
      setSelection({ classrooms: new Set(), groups: new Set() })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Megaphone className="h-5.5 w-5.5 text-primary" />
          ارسال اطلاعیه
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          اطلاعیه برای کلاس‌ها یا گروه‌های انتخاب‌شده ارسال می‌شود و در گفتگوی گروه‌های آن‌ها با طرح ویژه نمایش داده می‌شود.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">متن اطلاعیه</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="مثلاً: فردا امتحان ریاضی کلاس هفتم برگزار می‌شود…"
            rows={4}
            maxLength={4000}
            aria-label="متن اطلاعیه"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{body.length} / 4000</span>
            <Button
              onClick={send}
              disabled={sending || body.trim().length < 2 || !hasSelection}
              className="gap-1.5"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4 -scale-x-100" />
              )}
              ارسال اطلاعیه
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">گیرندگان</CardTitle>
          <CardDescription>
            انتخاب کلاس = ارسال به همه گروه‌های فعال آن کلاس. می‌توانید گروه خاص را جداگانه هم انتخاب کنید.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {classrooms === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : classrooms.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              ابتدا از بخش «کلاس‌ها» کلاس و گروه درسی بسازید.
            </p>
          ) : (
            <div className="space-y-3">
              {classrooms.map((c) => {
                const classSelected = selection.classrooms.has(c.id)
                return (
                  <div key={c.id} className="rounded-xl border p-3 space-y-2">
                    <button
                      onClick={() => toggleClassroom(c.id)}
                      className="w-full flex items-center gap-2.5 text-right"
                    >
                      {classSelected ? (
                        <CheckSquare className="h-5 w-5 text-primary shrink-0" />
                      ) : (
                        <Square className="h-5 w-5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-sm font-semibold flex-1">کلاس {c.name}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {c.groups.filter((g) => !g.archived).length} گروه فعال
                      </Badge>
                    </button>
                    {c.groups.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pr-7">
                        {c.groups.map((g) => (
                          <button
                            key={g.id}
                            onClick={() => toggleGroup(g.id)}
                            className={cn(
                              'text-xs rounded-full border px-2.5 py-1 transition-colors',
                              selection.groups.has(g.id)
                                ? 'bg-primary text-primary-foreground border-primary'
                                : g.archived
                                  ? 'text-muted-foreground border-dashed'
                                  : 'hover:bg-accent',
                            )}
                          >
                            {g.name}
                            {g.archived ? ' (بایگانی)' : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
