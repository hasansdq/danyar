'use client'

/**
 * دیالوگ جزئیات جلسهٔ آنلاین — مدیر کل:
 * - معلم، زمان شروع، افراد حاضر (سوکت/LiveKit)، گزارش حضور و قطع‌ووصل
 * - پایان اجباری با تأیید صریح + دلیل الزامی + ثبت گزارش مدیریتی
 * - فقط اطلاعات عملیاتی؛ هیچ دسترسی به صدا/تصویر/محتوای کلاس وجود ندارد
 *   (مشاهده یا شنیدن مخفیانه اضافه نشده است).
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { faNum, faDateTime, roleLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Loader2,
  RefreshCw,
  UserRound,
  OctagonX,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  Hand,
  RadioTower,
  Info,
} from 'lucide-react'
import { type SessionDetailData, roleBadgeClass } from './oc-shared'

export function SessionDetailDialog({
  sessionId,
  onClose,
  onEnded,
}: {
  sessionId: string | null
  onClose: () => void
  onEnded: () => void
}) {
  const [data, setData] = useState<SessionDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [ending, setEnding] = useState(false)

  const fetchDetail = useCallback(async () => {
    if (!sessionId) return
    setRefreshing(true)
    try {
      const r = await fetch(`/api/superadmin/online-classes/sessions/${sessionId}`, {
        cache: 'no-store',
      })
      if (!r.ok) {
        throw new Error((await r.json().catch(() => null)?.error) ?? `کد ${r.status}`)
      }
      setData((await r.json()) as SessionDetailData)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت جزئیات جلسه ناموفق بود')
    } finally {
      setRefreshing(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (sessionId) {
      setData(null)
      setReason('')
      void fetchDetail()
    }
  }, [sessionId, fetchDetail])

  const forceEnd = async () => {
    if (!sessionId) return
    if (!reason.trim()) {
      toast({
        title: 'دلیل پایان اجباری الزامی است',
        description: 'دلیل در گزارش مدیریتی جلسه ثبت می‌شود',
        variant: 'destructive',
      })
      return
    }
    setEnding(true)
    try {
      const r = await fetch(`/api/superadmin/online-classes/sessions/${sessionId}/force-end`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        toast({
          title: 'پایان اجباری ناموفق بود',
          description: d?.error ?? `کد ${r.status}`,
          variant: 'destructive',
        })
        return
      }
      toast({
        title: 'جلسه پایان یافت',
        description:
          d?.message ?? 'اتصال همهٔ شرکت‌کنندگان قطع و اتاق رسانه حذف شد؛ گزارش مدیریتی ثبت شد',
      })
      setConfirmOpen(false)
      await fetchDetail()
      onEnded()
    } finally {
      setEnding(false)
    }
  }

  const live = data?.session

  return (
    <>
      <Dialog open={!!sessionId} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span className="truncate">{live?.title ?? 'جزئیات جلسه'}</span>
              {live && (
                <Badge
                  variant="outline"
                  className={
                    live.status === 'ACTIVE'
                      ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                      : ''
                  }
                >
                  {live.status === 'ACTIVE' ? 'فعال' : 'پایان‌یافته'}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {live
                ? `${live.classroom.name} — ${live.school.name}`
                : 'اطلاعات عملیاتی جلسهٔ آنلاین'}
            </DialogDescription>
          </DialogHeader>

          {error && !data && <p className="text-sm text-destructive">{error}</p>}
          {!data ? (
            <div className="space-y-2">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : (
            <ScrollArea className="flex-1 max-h-[62dvh] pl-1">
              <div className="space-y-4 pr-1">
                {/* مشخصات اصلی */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
                  <InfoRow label="معلم (میزبان)" value={live!.host.name} />
                  <InfoRow label="زمان شروع" value={faDateTime(live!.startedAt)} />
                  <InfoRow
                    label="اعلام شروع"
                    value={live!.announcedAt ? faDateTime(live!.announcedAt) : 'هنوز اعلام نشده'}
                  />
                  <InfoRow
                    label="پایان"
                    value={live!.endedAt ? faDateTime(live!.endedAt) : 'در جریان'}
                  />
                  <InfoRow
                    label="سقف افراد جلسه"
                    value={`${faNum(data.presentUsers.maxParticipants)} نفر (معلم نیز جزو ظرفیت)`}
                  />
                  <InfoRow
                    label="افراد حاضر"
                    value={`${faNum(data.presentUsers.count)} نفر — منبع: ${data.presentUsers.source}`}
                  />
                  {live!.forceEndReason && (
                    <div className="sm:col-span-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-xs">
                      <span className="font-semibold text-red-600 dark:text-red-400">
                        پایان اجباری
                        {live!.ender ? ` توسط ${live!.ender.name} (${roleLabel(live!.ender.role)})` : ''}
                        :{' '}
                      </span>
                      <span className="text-foreground/90">{live!.forceEndReason}</span>
                    </div>
                  )}
                </div>

                {/* افراد حاضر */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5" />
                    افراد حاضر ({faNum(data.presentUsers.participants.length)})
                    {data.presentUsers.hostConnected !== null && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          data.presentUsers.hostConnected
                            ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                            : 'border-amber-500/40 text-amber-600 dark:text-amber-400',
                        )}
                      >
                        {data.presentUsers.hostConnected ? 'میزبان متصل' : 'میزبان قطع'}
                      </Badge>
                    )}
                  </div>
                  {data.presentUsers.participants.length === 0 ? (
                    <p className="text-xs text-muted-foreground">همین حالا کسی در جلسه نیست.</p>
                  ) : (
                    <div className="rounded-xl border divide-y max-h-52 overflow-y-auto">
                      {data.presentUsers.participants.map((p) => (
                        <div
                          key={p.userId}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">{p.name}</span>
                            <Badge variant="outline" className={cn('text-[10px]', roleBadgeClass(p.role))}>
                              {roleLabel(p.role)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
                            {p.micOn === null ? (
                              <span className="text-[10px]">وضعیت زنده در دسترس نیست</span>
                            ) : (
                              <>
                                {p.micOn ? (
                                  <Mic className="h-3.5 w-3.5 text-emerald-500" />
                                ) : (
                                  <MicOff className="h-3.5 w-3.5" />
                                )}
                                {p.camOn ? (
                                  <Video className="h-3.5 w-3.5 text-emerald-500" />
                                ) : (
                                  <VideoOff className="h-3.5 w-3.5" />
                                )}
                                {p.sharing && (
                                  <MonitorUp className="h-3.5 w-3.5 text-primary" />
                                )}
                                {p.handRaised && <Hand className="h-3.5 w-3.5 text-amber-500" />}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* وضعیت LiveKit */}
                {data.livekit && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <RadioTower className="h-3.5 w-3.5" />
                      وضعیت اتصال LiveKit (SFU)
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          data.livekit.reachable
                            ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                            : 'border-red-500/40 text-red-600 dark:text-red-400',
                        )}
                      >
                        {data.livekit.reachable ? 'در دسترس' : 'در دسترس نیست'}
                      </Badge>
                    </div>
                    {data.livekit.participants.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {data.livekit.reachable
                          ? 'اتاق رسانه خالی است یا هنوز کسی وصل نشده است.'
                          : 'سرویس رسانه پاسخ نداد؛ وضعیت اتصال در دسترس نیست.'}
                      </p>
                    ) : (
                      <div className="rounded-xl border divide-y max-h-40 overflow-y-auto">
                        {data.livekit.participants.map((p) => (
                          <div
                            key={p.identity}
                            className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                          >
                            <span className="font-mono text-[10px] text-muted-foreground truncate">
                              {p.identity.slice(0, 14)}…
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="outline" className="text-[10px]">
                                {p.state === 'ACTIVE' ? 'اتصال فعال' : p.state}
                              </Badge>
                              {p.isPublisher && (
                                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                                  انتشار رسانه
                                </Badge>
                              )}
                              {p.tracks.map((t, i) => (
                                <span key={i} className="text-[10px] text-muted-foreground">
                                  {t.source === 'MICROPHONE' ? 'میکروفون' : t.source === 'CAMERA' ? 'دوربین' : t.source === 'SCREEN_SHARE' ? 'صفحه' : t.type}
                                  {t.muted ? ' (خاموش)' : ''}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                      {data.livekit.note}
                    </p>
                  </div>
                )}

                {/* گزارش حضور و قطع‌ووصل */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1.5">
                    گزارش حضور ({faNum(data.participantLogs.distinctUsers)} نفر —{' '}
                    {faNum(data.participantLogs.reconnects)} قطع‌ووصل)
                  </div>
                  <div className="rounded-xl border divide-y max-h-52 overflow-y-auto">
                    {data.participantLogs.rows.map((l) => (
                      <div key={l.id} className="px-3 py-2 text-xs space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">{l.name}</span>
                            <Badge variant="outline" className={cn('text-[10px]', roleBadgeClass(l.role))}>
                              {roleLabel(l.role)}
                            </Badge>
                            {l.kicked && (
                              <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-600 dark:text-red-400">
                                اخراج‌شده
                              </Badge>
                            )}
                          </div>
                          {l.reconnects > 0 && (
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {faNum(l.reconnects)} اتصال مجدد
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          ورود: {faDateTime(l.joinedAt)}
                          {l.leftAt ? ` — خروج: ${faDateTime(l.leftAt)}` : ' — حاضر'}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {data.participantLogs.reconnectsDefinition}
                  </p>
                </div>
              </div>
            </ScrollArea>
          )}

          {/* اقدام‌ها */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void fetchDetail()}
              disabled={refreshing}
              className="gap-1.5"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
              تازه‌سازی
            </Button>
            {live?.status === 'ACTIVE' && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                className="gap-1.5"
              >
                <OctagonX className="h-4 w-4" />
                پایان اجباری جلسه
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* تأیید پایان اجباری با دلیل */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>پایان اجباری این جلسه؟</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              اتصال همهٔ شرکت‌کنندگان قطع، اتاق رسانه (LiveKit) واقعاً بسته و وضعیت
              دیتابیس و سوکت هماهنگ می‌شود. دلیل شما در گزارش مدیریتی جلسه ثبت
              خواهد شد. این اقدام بازگشت‌پذیر نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="force-end-reason" className="text-sm">
              دلیل پایان اجباری (الزامی)
            </Label>
            <Textarea
              id="force-end-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              placeholder="مثلاً: گزارش قطعی اینترنت مدرسه — پایان برای رفع اشغال ظرفیت"
              rows={3}
            />
            <p className="text-[11px] text-muted-foreground">
              {faNum(reason.length)}/۵۰۰ نویسه — در گزارش مدیریتی جلسه ذخیره می‌شود
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ending}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void forceEnd()
              }}
              disabled={ending || !reason.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
            >
              {ending && <Loader2 className="h-4 w-4 animate-spin" />}
              پایان قطعی جلسه
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  )
}
