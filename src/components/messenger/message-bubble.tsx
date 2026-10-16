'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  FileIcon,
  Download,
  Check,
  CheckCheck,
  Pencil,
  Trash2,
  Reply,
  Loader2,
  Megaphone,
  RotateCcw,
  ClipboardList,
  BookOpen,
  ChevronLeft,
  Forward,
  Copy,
  Pin,
  PinOff,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { chatTime } from '@/lib/format'
import { LiveInviteCard } from '@/components/live/invite-card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatSize, type ChatMessage } from './types'
import { VoicePlayer } from './voice-player'

interface MessageBubbleProps {
  message: ChatMessage
  mine: boolean
  isDm: boolean
  canDelete: boolean
  /** سنجاق فقط برای معلم و مدیر مدرسه */
  canPin: boolean
  onReply: (m: ChatMessage) => void
  onEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
  onRetry: (m: ChatMessage) => void
  onForward: (m: ChatMessage) => void
  onPin: (m: ChatMessage, pinned: boolean) => void
  onJumpTo?: (id: string) => void
}

/** کپی متن با fallback برای مرورگرهای قدیمی/زمینه‌های ناامن */
async function copyMessageText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* به fallback می‌رویم */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function AttachmentBody({
  message,
  mine,
}: {
  message: ChatMessage
  mine: boolean
}) {
  const [preview, setPreview] = useState(false)
  const att = message.attachment
  if (!att) return null

  if (message.type === 'IMAGE') {
    return (
      <>
        <button
          onClick={() => setPreview(true)}
          className="block max-w-64 sm:max-w-72 rounded-lg overflow-hidden border"
          aria-label={`نمایش تصویر ${att.name}`}
        >
          <img
            src={att.url}
            alt={att.name}
            className="max-h-72 w-auto object-cover"
            loading="lazy"
          />
        </button>
        <Dialog open={preview} onOpenChange={setPreview}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="text-sm">{att.name}</DialogTitle>
            </DialogHeader>
              <img
              src={att.url}
              alt={att.name}
              className="max-h-[70vh] w-auto mx-auto rounded-lg"
            />
            <a
              href={att.url}
              download={att.name}
              className="flex items-center gap-1.5 text-sm text-primary hover:underline justify-center"
            >
              <Download className="h-4 w-4" />
              دانلود
            </a>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  if (message.type === 'VIDEO') {
    return (
      <video
        src={att.url}
        controls
        preload="metadata"
        className="max-w-64 sm:max-w-80 max-h-72 rounded-lg border"
      />
    )
  }

  if (message.type === 'AUDIO') {
    return (
      <div className="min-w-56 max-w-72">
        <VoicePlayer
          url={att.url}
          duration={att.duration ?? null}
          waveform={att.waveform ?? null}
          mine={mine}
          sending={message.status === 'sending'}
        />
      </div>
    )
  }

  return (
    <a
      href={att.url}
      download={att.name}
      className="flex items-center gap-2.5 min-w-52 max-w-64 rounded-lg border bg-background/60 p-2.5 hover:bg-background transition-colors"
    >
      <span className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <FileIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium truncate">{att.name}</span>
        <span className="block text-[11px] opacity-70">
          {formatSize(att.size)}
        </span>
      </span>
      <Download className="h-4 w-4 shrink-0 opacity-60" />
    </a>
  )
}

export function MessageBubble({
  message: m,
  mine,
  isDm,
  canDelete,
  canPin,
  onReply,
  onEdit,
  onDelete,
  onRetry,
  onForward,
  onPin,
  onJumpTo,
}: MessageBubbleProps) {
  const canEdit = mine && !m.deletedAt && m.type !== 'ANNOUNCEMENT'
  const forwardable =
    !m.deletedAt &&
    ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE'].includes(m.type) &&
    m.status !== 'sending' &&
    m.status !== 'failed'

  const handleCopy = async () => {
    const text = m.body?.trim()
    if (!text) return
    const ok = await copyMessageText(text)
    if (ok) {
      toast.success('متن پیام کپی شد')
    } else {
      toast.error('کپی ناموفق بود')
    }
  }

  // اطلاعیه — نمای ویژه وسط صفحه
  if (m.type === 'ANNOUNCEMENT' && !m.deletedAt) {
    return (
      <div className="mx-auto w-full max-w-xl my-2" data-message-id={m.id}>
        <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-3.5">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-bold mb-1.5">
            <Megaphone className="h-4 w-4" />
            اطلاعیه مدیریت
          </div>
          <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            {m.sender.fullName} — {chatTime(m.createdAt)}
          </div>
        </div>
      </div>
    )
  }

  // پیام خودکار تکلیف — کارت ویژه با پیوند مشاهده تکلیف
  if (m.type === 'ASSIGNMENT' && !m.deletedAt && m.assignmentId) {
    return (
      <div className="mx-auto w-full max-w-xl my-2" data-message-id={m.id}>
        <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3.5">
          <div className="flex items-center gap-2 text-primary text-xs font-bold mb-1.5">
            <ClipboardList className="h-4 w-4" />
            تکلیف درسی
          </div>
          <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
          <Link
            href={`/assignments/${m.assignmentId}`}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            مشاهده و ارسال پاسخ
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
          <div className="text-[11px] text-muted-foreground mt-2">
            {m.sender.fullName} — {chatTime(m.createdAt)}
          </div>
        </div>
      </div>
    )
  }

  // پیام دعوت کلاس آنلاین — کارت ویژه با دکمه ورود / وضعیت پایان
  if (m.type === 'LIVE_INVITE' && !m.deletedAt && m.liveSessionId) {
    return (
      <LiveInviteCard
        liveSessionId={m.liveSessionId}
        body={m.body}
        senderName={m.sender.fullName}
        time={chatTime(m.createdAt)}
      />
    )
  }

  // پیام خودکار «نمونه‌سؤال» — کارت ویژه با دکمه مشاهده نمونه‌سؤال
  if (m.type === 'SAMPLEQ' && !m.deletedAt && m.sampleQuestionId) {
    return (
      <div className="mx-auto w-full max-w-xl my-2" data-message-id={m.id}>
        <div className="rounded-xl border-2 border-sky-500/40 bg-sky-500/5 p-3.5">
          <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 text-xs font-bold mb-1.5">
            <BookOpen className="h-4 w-4" />
            نمونه‌سؤال
          </div>
          <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
          <Link
            href={`/sample-questions/${m.sampleQuestionId}`}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
          >
            مشاهده نمونه‌سؤال
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
          <div className="text-[11px] text-muted-foreground mt-2">
            {m.sender.fullName} — {chatTime(m.createdAt)}
          </div>
        </div>
      </div>
    )
  }

  if (m.deletedAt) {
    return (
      <div
        className={cn('flex my-1 px-2', mine ? 'justify-start' : 'justify-end')}
        data-message-id={m.id}
      >
        <div className="rounded-xl bg-muted/60 text-muted-foreground text-xs italic px-3 py-2">
          این پیام حذف شد
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('flex my-1 px-2 group', mine ? 'justify-start' : 'justify-end')}
      data-message-id={m.id}
    >
      <div className={cn('max-w-[85%] sm:max-w-[70%] min-w-0')}>
        {/* نام فرستنده در گروه */}
        {!mine && m.kind === 'GROUP' && (
          <div className="text-[11px] text-muted-foreground mb-0.5 px-1">
            {m.sender.fullName}
          </div>
        )}

        <div className={cn(
            'rounded-2xl px-3 py-2 text-sm space-y-1.5 relative',
            mine
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-card border rounded-bl-md',
            m.status === 'failed' && 'opacity-80 border-destructive',
          )}>
          {/* نشان سنجاق */}
          {m.pinnedAt && (
            <span
              className="absolute -top-2 left-2 flex items-center gap-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 shadow"
              title="این پیام سنجاق شده است"
            >
              <Pin className="h-2.5 w-2.5" />
              سنجاق
            </span>
          )}

          {/* برچسب هدایت‌شده */}
          {m.isForwarded && (
            <div
              className={cn(
                'flex items-center gap-1 text-[11px] italic',
                mine ? 'text-primary-foreground/75' : 'text-muted-foreground',
              )}
            >
              <Forward className="h-3 w-3" />
              هدایت‌شده از {m.forwardedFromName ?? 'کاربر'}
            </div>
          )}

          {/* پیش‌نمایش پاسخ */}
          {m.replyTo && (
            <button
              onClick={() => onJumpTo?.(m.replyTo!.id)}
              className={cn(
                'block w-full text-right rounded-lg border-r-2 px-2 py-1 text-xs',
                mine
                  ? 'border-primary-foreground/50 bg-primary-foreground/10'
                  : 'border-primary/50 bg-muted',
              )}
            >
              <span className="block font-medium opacity-80">
                پاسخ به {m.replyTo.senderName}
              </span>
              <span className="block truncate opacity-70">
                {m.replyTo.deletedAt
                  ? 'پیام حذف شد'
                  : m.replyTo.body || '(پیوست)'}
              </span>
            </button>
          )}

          {m.status === 'sending' && (
            <div className="flex items-center gap-1.5 text-[11px] opacity-70">
              <Loader2 className="h-3 w-3 animate-spin" />
              در حال ارسال…
            </div>
          )}

          <AttachmentBody message={m} mine={mine} />

          {m.body && (
            <p className="whitespace-pre-wrap break-words leading-6">{m.body}</p>
          )}

          {/* زمان + وضعیت خواندن */}
          <div
            className={cn(
              'flex items-center gap-1 text-[10.5px] justify-end',
              mine ? 'text-primary-foreground/75' : 'text-muted-foreground',
            )}
          >
            {m.editedAt && <span>(ویرایش‌شده)</span>}
            {chatTime(m.createdAt)}
            {mine && isDm && (
              m.readAt ? (
                <CheckCheck className="h-3.5 w-3.5 text-sky-300" aria-label="خوانده شد" />
              ) : (
                <Check className="h-3.5 w-3.5" aria-label="ارسال شد" />
              )
            )}
            {m.status === 'failed' && (
              <button
                onClick={() => onRetry(m)}
                className="flex items-center gap-0.5 hover:underline"
                aria-label="تلاش مجدد"
              >
                <RotateCcw className="h-3 w-3" />
                تلاش مجدد
              </button>
            )}
          </div>
        </div>

        {/* عملیات پیام */}
        {m.status !== 'sending' && m.status !== 'failed' && (
          <div
            className={cn(
              'flex items-center gap-0.5 mt-0.5 px-1 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity',
              mine ? 'justify-start' : 'justify-end',
            )}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="text-muted-foreground hover:text-foreground text-[11px] px-1.5 py-0.5 rounded hover:bg-accent"
                  aria-label="عملیات پیام"
                >
                  ⋯
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={mine ? 'start' : 'end'}>
                <DropdownMenuItem onClick={() => onReply(m)}>
                  <Reply className="h-4 w-4 ml-2" />
                  پاسخ
                </DropdownMenuItem>
                {forwardable && (
                  <DropdownMenuItem onClick={() => onForward(m)}>
                    <Forward className="h-4 w-4 ml-2" />
                    هدایت
                  </DropdownMenuItem>
                )}
                {m.body?.trim() && (
                  <DropdownMenuItem onClick={handleCopy}>
                    <Copy className="h-4 w-4 ml-2" />
                    کپی
                  </DropdownMenuItem>
                )}
                {canEdit && m.type === 'TEXT' && (
                  <DropdownMenuItem onClick={() => onEdit(m)}>
                    <Pencil className="h-4 w-4 ml-2" />
                    ویرایش
                  </DropdownMenuItem>
                )}
                {canPin && !m.deletedAt && (
                  <DropdownMenuItem onClick={() => onPin(m, !m.pinnedAt)}>
                    {m.pinnedAt ? (
                      <>
                        <PinOff className="h-4 w-4 ml-2" />
                        برداشتن سنجاق
                      </>
                    ) : (
                      <>
                        <Pin className="h-4 w-4 ml-2" />
                        سنجاق
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {(canEdit || canDelete) && (
                  <DropdownMenuItem
                    onClick={() => onDelete(m)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 ml-2" />
                    حذف
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}
