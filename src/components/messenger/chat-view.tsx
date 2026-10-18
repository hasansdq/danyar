'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowRight,
  Loader2,
  Send,
  Paperclip,
  Mic,
  X,
  ShieldAlert,
  Info,
  Pencil,
  FileIcon,
  Bell,
  BellOff,
  ArrowDown,
  Pin,
  ChevronLeft,
  ChevronRight,
  Search,
  Lock,
  LockOpen,
  Settings2,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import { getSocket, useSocketStatus } from './socket-client'
import { ConnectionBadge } from './connection-badge'
import { MessageBubble } from './message-bubble'
import { ForwardDialog } from './forward-dialog'
import { EmojiPicker } from './emoji-picker'
import { VoiceRecorderPanel, type VoiceRecording } from './voice-recorder'
import { GroupMembersDialog } from './group-members-dialog'
import { GroupSettingsDialog } from './group-settings-dialog'
import { useDialogHistory, wasDialogPopstate } from '@/lib/dialog-history'
import { chatTime } from '@/lib/format'
import { formatSize, type ChatMessage, type ConversationMeta, type ChatUser, type GroupSearchHit } from './types'

/** پیش‌نمایش متنی پیام سنجاق‌شده برای نوار بالای چت — با نمایش عنوان تکلیف/نمونه‌سؤال/اطلاعیه */
function pinPreview(m: ChatMessage): string {
  if (m.deletedAt) return 'این پیام حذف شد'
  // عنوان مرجع: تکلیف و نمونه‌سؤال عنوان واقعی دارند؛ اطلاعیه سطر اول متن
  if (m.type === 'ASSIGNMENT' && m.refTitle) return `تکلیف: ${m.refTitle}`
  if (m.type === 'SAMPLEQ' && m.refTitle) return `نمونه‌سؤال: ${m.refTitle}`
  if (m.type === 'ANNOUNCEMENT') {
    const first = (m.body || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0)
    return first ? `اطلاعیه: ${first}` : '📢 اطلاعیه'
  }
  if (m.body) return m.body
  switch (m.type) {
    case 'IMAGE':
      return '📷 تصویر'
    case 'AUDIO':
      return '🎤 پیام صوتی'
    case 'VIDEO':
      return '🎬 ویدئو'
    case 'FILE':
      return `📎 فایل${m.attachment ? ` — ${m.attachment.name}` : ''}`
    default:
      return '(پیوست)'
  }
}

interface ChatViewProps {
  kind: 'group' | 'dm'
  targetId: string
  me: ChatUser
}

const MAX_BODY = 4000

function clientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface PendingAttachment {
  key: string
  name: string
  mime: string
  size: number
  type: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE'
  previewUrl: string
  /** فقط پیام صوتی — برای تلاش مجدد */
  duration?: number
  waveform?: number[]
  /** پیام صوتی هنوز آپلود نشده — فایل خام برای آپلود مجدد هنگام تلاش مجدد */
  blob?: Blob
}

export function ChatView({ kind, targetId, me }: ChatViewProps) {
  const router = useRouter()
  const connected = useSocketStatus((s) => s.connected)

  const [meta, setMeta] = useState<ConversationMeta | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [pending, setPending] = useState<PendingAttachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null)
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [removedNotice, setRemovedNotice] = useState(false)
  // پیام‌های سنجاق‌شده این گفتگو + نشانگر پیمایش نوار سنجاق
  const [pinned, setPinned] = useState<ChatMessage[]>([])
  const [pinIdx, setPinIdx] = useState(0)
  // بی‌صدایی این گفتگو + شمارنده پیام‌های جدید هنگام خواندن قدیمی‌ها
  const [muted, setMuted] = useState(false)
  const [newBelow, setNewBelow] = useState(0)
  // جابه‌جایی هنگام باز شدن صفحه‌کلید موبایل
  const [kbOffset, setKbOffset] = useState(0)
  // اعضا / تنظیمات / قفل / جست‌وجوی درون گروهی (فقط گروه‌های درسی)
  const [membersOpen, setMembersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lockPending, setLockPending] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchHits, setSearchHits] = useState<GroupSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ضبط پیام صوتی فعال
  const [recording, setRecording] = useState(false)
  // پیوست‌های در انتظار تأیید سرور (برای تلاش مجدد)
  const attachmentBagRef = useRef(new Map<string, PendingAttachment>())
  // آخرین نسخه پیام‌ها برای پرش به پیام‌های قدیمی سنجاق‌شده
  const messagesRef = useRef<ChatMessage[]>([])
  messagesRef.current = messages

  const belongsToConversation = useCallback(
    (m: ChatMessage) => {
      if (m.kind === 'GROUP') {
        return kind === 'group' && m.subjectGroupId === targetId
      }
      if (kind !== 'dm') return false
      return (
        (m.sender.id === targetId && m.recipientId === me.id) ||
        (m.sender.id === me.id && m.recipientId === targetId)
      )
    },
    [kind, targetId, me.id],
  )

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    })
  }, [])

  const markRead = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    if (markReadTimer.current) clearTimeout(markReadTimer.current)
    markReadTimer.current = setTimeout(() => {
      fetch(`/api/chats/${kind}/${targetId}/read`, { method: 'POST' }).catch(() => null)
    }, 400)
  }, [kind, targetId])

  // ─── بارگذاری اولیه ───
  const loadInitial = useCallback(async () => {
    setInitialLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/chats/${kind}/${targetId}/messages`, {
        cache: 'no-store',
      })
      if (res.status === 404) {
        setNotFound(true)
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setLoadError(data?.error ?? 'خطا در دریافت پیام‌ها')
        return
      }
      const data = await res.json()
      setMeta(data.conversation)
      setMessages(data.messages)
      setHasMore(data.hasMore)
      setPinned(Array.isArray(data.pinned) ? data.pinned : [])
      setPinIdx(0)
      nearBottomRef.current = true
      scrollToBottom()
      markRead()
    } finally {
      setInitialLoading(false)
    }
  }, [kind, targetId, scrollToBottom, markRead])

  useEffect(() => {
    loadInitial()
  }, [loadInitial])

  // بارگذاری مجدد پس از اتصال مجدد (بدون ثبت پیام تکراری)
  useEffect(() => {
    const socket = getSocket()
    const onConnect = () => {
      if (!initialLoading) loadInitial()
    }
    socket.on('connect', onConnect)
    return () => {
      socket.off('connect', onConnect)
    }
  }, [loadInitial, initialLoading])

  // ─── رویدادهای بلادرنگ ───
  useEffect(() => {
    const socket = getSocket()

    const mergeIncoming = (m: ChatMessage) => {
      if (!belongsToConversation(m)) return
      setMessages((prev) => {
        if (prev.some((p) => p.id === m.id)) return prev
        const byClient = m.clientId ? prev.findIndex((p) => p.clientId === m.clientId) : -1
        if (byClient !== -1) {
          const next = [...prev]
          next[byClient] = m
          return next
        }
        return [...prev, m]
      })
      if (m.sender.id !== me.id) {
        markRead()
        if (nearBottomRef.current) {
          scrollToBottom(true)
        } else {
          // کاربر مشغول خواندن پیام‌های قدیمی است — دکمه پیام‌های جدید
          setNewBelow((c) => c + 1)
        }
      }
    }

    const onUpdated = (m: ChatMessage) => {
      if (!belongsToConversation(m)) return
      setMessages((prev) => prev.map((p) => (p.id === m.id ? m : p)))
      // همگام‌سازی فهرست سنجاق‌شده‌ها (سنجاق/برداشتن از هر دستگاهی)
      setPinned((prev) => {
        const without = prev.filter((p) => p.id !== m.id)
        if (m.pinnedAt) {
          return [...without, m].sort(
            (a, b) =>
              Date.parse(b.pinnedAt ?? '0') - Date.parse(a.pinnedAt ?? '0'),
          )
        }
        return without
      })
    }

    const onDeleted = (d: { id: string; subjectGroupId?: string }) => {
      setMessages((prev) =>
        prev.map((p) =>
          p.id === d.id
            ? {
                ...p,
                deletedAt: new Date().toISOString(),
                body: '',
                attachment: null,
              }
            : p,
        ),
      )
    }

    const onDmRead = (d: { readerId: string; readAt: string }) => {
      if (kind !== 'dm' || d.readerId !== targetId) return
      setMessages((prev) =>
        prev.map((p) =>
          p.sender.id === me.id &&
          !p.readAt &&
          new Date(p.createdAt).getTime() <= new Date(d.readAt).getTime()
            ? { ...p, readAt: d.readAt }
            : p,
        ),
      )
    }

    const onGroupUpdated = (
      g: {
        id: string
        archived: boolean
        policy: string
        lockedForStudents?: boolean
        name?: string
        avatarVersion?: number
      },
    ) => {
      if (kind !== 'group' || g.id !== targetId) return
      setMeta((prev) =>
        prev
          ? {
              ...prev,
              archived: g.archived,
              policy: g.policy,
              lockedForStudents:
                g.lockedForStudents !== undefined
                  ? g.lockedForStudents
                  : g.policy === 'STAFF' || g.policy === 'ADMINS',
              title: g.name ?? prev.title,
              avatarUrl:
                g.avatarVersion !== undefined
                  ? g.avatarVersion > 0
                    ? `/api/groups/${prev.id}/avatar?v=${g.avatarVersion}`
                    : null
                  : prev.avatarUrl,
            }
          : prev,
      )
    }

    const onGroupRemoved = (g: { id: string }) => {
      if (kind !== 'group' || g.id !== targetId) return
      setRemovedNotice(true)
    }

    socket.on('message:new', mergeIncoming)
    socket.on('message:updated', onUpdated)
    socket.on('message:deleted', onDeleted)
    socket.on('dm:read', onDmRead)
    socket.on('group:updated', onGroupUpdated)
    socket.on('group:removed', onGroupRemoved)

    return () => {
      socket.off('message:new', mergeIncoming)
      socket.off('message:updated', onUpdated)
      socket.off('message:deleted', onDeleted)
      socket.off('dm:read', onDmRead)
      socket.off('group:updated', onGroupUpdated)
      socket.off('group:removed', onGroupRemoved)
    }
  }, [belongsToConversation, kind, targetId, me.id, markRead, scrollToBottom])

  // علامت‌گذاری هنگام بازگشت به تب
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') markRead()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [markRead])

  // ─── بارگذاری پیام‌های قدیمی‌تر ───
  const loadOlder = useCallback(async () => {
    if (!messages.length || loadingOlder || !hasMore) return
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    setLoadingOlder(true)
    try {
      const before = messages[0]?.createdAt
      const res = await fetch(
        `/api/chats/${kind}/${targetId}/messages?before=${encodeURIComponent(before!)}`,
        { cache: 'no-store' },
      )
      if (res.ok) {
        const data = await res.json()
        setMessages((prev) => {
          const known = new Set(prev.map((p) => p.id))
          const fresh = data.messages.filter((m: ChatMessage) => !known.has(m.id))
          return [...fresh, ...prev]
        })
        setHasMore(data.hasMore)
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight
        })
      }
    } finally {
      setLoadingOlder(false)
    }
  }, [messages, loadingOlder, hasMore, kind, targetId])

  // ─── ارسال / ویرایش ───
  const doSend = useCallback(async () => {
    if (!meta?.canSend) return

    if (editing) {
      const body = text.trim()
      if (!body) return
      const res = await fetch(`/api/messages/${editing.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (res.ok) {
        const data = await res.json()
        setMessages((prev) => prev.map((p) => (p.id === editing.id ? data.message : p)))
      }
      setEditing(null)
      setText('')
      return
    }

    const body = text.trim()
    if (!body && !pending) return
    if (body.length > MAX_BODY) return

    const cid = clientId()
    const temp: ChatMessage = {
      id: `tmp-${cid}`,
      kind: kind === 'group' ? 'GROUP' : 'DIRECT',
      type: pending?.type ?? 'TEXT',
      body,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      readAt: null,
      isAnnouncement: false,
      clientId: cid,
      sender: me,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            body: replyTo.deletedAt ? '' : replyTo.body,
            type: replyTo.type,
            deletedAt: !!replyTo.deletedAt,
            senderName: replyTo.sender.fullName,
          }
        : null,
      attachment: pending
        ? {
            url: pending.previewUrl,
            name: pending.name,
            mime: pending.mime,
            size: pending.size,
          }
        : null,
      status: 'sending',
    }
    setMessages((prev) => [...prev, temp])
    setText('')
    const replyTarget = replyTo
    setReplyTo(null)
    setSending(true)
    nearBottomRef.current = true
    scrollToBottom(true)

    try {
      const res = await fetch(`/api/chats/${kind}/${targetId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body,
          clientId: cid,
          replyToId: replyTarget?.id ?? null,
          attachment: pending
            ? {
                key: pending.key,
                name: pending.name,
                mime: pending.mime,
                size: pending.size,
                type: pending.type,
              }
            : null,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const serverMsg = data.message as ChatMessage
        setMessages((prev) => {
          const idx = prev.findIndex((p) => p.clientId === cid)
          if (idx === -1) {
            if (prev.some((p) => p.id === serverMsg.id)) return prev
            return [...prev, serverMsg]
          }
          const next = [...prev]
          next[idx] = serverMsg
          return next
        })
        setPending(null)
        scrollToBottom(true)
      } else {
        if (pending) attachmentBagRef.current.set(cid, pending)
        setMessages((prev) =>
          prev.map((p) =>
            p.clientId === cid ? { ...p, status: 'failed' } : p,
          ),
        )
      }
    } catch {
      if (pending) attachmentBagRef.current.set(cid, pending)
      setMessages((prev) =>
        prev.map((p) => (p.clientId === cid ? { ...p, status: 'failed' } : p)),
      )
    } finally {
      setSending(false)
    }
  }, [meta, editing, text, pending, replyTo, kind, targetId, me, scrollToBottom])

  /** آپلود Blob صوتی — خروجی پیوست آماده ارسال */
  const uploadVoice = useCallback(
    async (blob: Blob, mime: string): Promise<PendingAttachment | null> => {
      const ext = mime.includes('mp4')
        ? 'm4a'
        : mime.includes('ogg')
          ? 'ogg'
          : mime.includes('wav')
            ? 'wav'
            : 'webm'
      const fd = new FormData()
      fd.append('file', new File([blob], `voice-${Date.now()}.${ext}`, { type: mime }))
      const res = await fetch('/api/uploads', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.key) {
        toast.error(data?.error ?? 'آپلود پیام صوتی ناموفق بود')
        return null
      }
      return {
        key: data.key,
        name: data.name,
        mime: data.mime,
        size: data.size,
        type: 'AUDIO',
        previewUrl: '',
      }
    },
    [],
  )

  const retry = useCallback(
    async (m: ChatMessage) => {
      if (!m.clientId) return
      const cid = m.clientId
      setMessages((prev) =>
        prev.map((p) => (p.clientId === cid ? { ...p, status: 'sending' } : p)),
      )
      try {
        const bag = attachmentBagRef.current.get(cid)
        let att: {
          key: string
          name: string
          mime: string
          size: number
          type: string
          duration?: number
          waveform?: number[]
        } | null = null
        if (bag) {
          if (bag.type === 'AUDIO' && bag.blob && !bag.key) {
            // ویسِ آپلودنشده — دوباره آپلود می‌شود
            const re = await uploadVoice(bag.blob, bag.mime)
            if (!re) {
              setMessages((prev) =>
                prev.map((p) => (p.clientId === cid ? { ...p, status: 'failed' } : p)),
              )
              return
            }
            re.duration = bag.duration
            re.waveform = bag.waveform
            att = re
          } else {
            att = {
              key: bag.key,
              name: bag.name,
              mime: bag.mime,
              size: bag.size,
              type: bag.type,
              duration: bag.duration,
              waveform: bag.waveform,
            }
          }
        }
        const res = await fetch(`/api/chats/${kind}/${targetId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: m.body,
            clientId: cid,
            replyToId: m.replyTo?.id ?? null,
            attachment: att
              ? {
                  key: att.key,
                  name: att.name,
                  mime: att.mime,
                  size: att.size,
                  type: att.type,
                  ...(att.type === 'AUDIO'
                    ? { duration: att.duration ?? null, waveform: att.waveform ?? null }
                    : {}),
                }
              : null,
          }),
        })
        if (res.ok) {
          attachmentBagRef.current.delete(cid)
          const data = await res.json()
          const serverMsg = data.message as ChatMessage
          setMessages((prev) => {
            const idx = prev.findIndex((p) => p.clientId === cid)
            if (idx === -1) return prev
            const next = [...prev]
            next[idx] = serverMsg
            return next
          })
        } else {
          setMessages((prev) =>
            prev.map((p) => (p.clientId === cid ? { ...p, status: 'failed' } : p)),
          )
        }
      } catch {
        setMessages((prev) =>
          prev.map((p) => (p.clientId === cid ? { ...p, status: 'failed' } : p)),
        )
      }
    },
    [kind, targetId, uploadVoice],
  )

  // ─── آپلود پیوست ───
  const onFilePicked = useCallback(
    async (file: File) => {
      if (uploading || !meta?.canSend) return
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/uploads', { method: 'POST', body: fd })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.key) {
          setPending({
            key: data.key,
            name: data.name,
            mime: data.mime,
            size: data.size,
            type: data.type,
            previewUrl:
              data.type === 'IMAGE' || data.type === 'VIDEO'
                ? URL.createObjectURL(file)
                : '',
          })
        } else {
          alert(data?.error ?? 'آپلود ناموفق بود')
        }
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [uploading, meta],
  )

  // ─── پیام صوتی: شروع ضبط، ارسال، تلاش مجدد آپلود ───
  const startRecording = useCallback(() => {
    if (recording || !meta?.canSend) return
    if (
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      toast.error('ضبط صدا در این مرورگر پشتیبانی نمی‌شود')
      return
    }
    setReplyTo(null)
    setEditing(null)
    setRecording(true)
  }, [recording, meta])

  const onRecorderCancel = useCallback((micDenied?: boolean) => {
    setRecording(false)
    if (micDenied) toast.error('دسترسی میکروفون داده نشد')
  }, [])

  const sendVoice = useCallback(
    async (rec: VoiceRecording) => {
      setRecording(false)
      if (!meta?.canSend) return
      const cid = clientId()
      const previewUrl = URL.createObjectURL(rec.blob)
      const waveform = rec.waveform ?? undefined
      const duration = rec.duration

      // پیام موقت با پیش‌نمایش محلی
      const temp: ChatMessage = {
        id: `tmp-${cid}`,
        kind: kind === 'group' ? 'GROUP' : 'DIRECT',
        type: 'AUDIO',
        body: '',
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        readAt: null,
        isAnnouncement: false,
        clientId: cid,
        sender: me,
        replyTo: null,
        attachment: {
          url: previewUrl,
          name: 'پیام صوتی',
          mime: rec.mime,
          size: rec.blob.size,
          duration,
          waveform: waveform ?? null,
        },
        status: 'sending',
      }
      setMessages((prev) => [...prev, temp])
      setSending(true)
      nearBottomRef.current = true
      scrollToBottom(true)

      try {
        const att = await uploadVoice(rec.blob, rec.mime)
        if (!att) {
          // آپلود ناموفق — برای تلاش مجدد فایل خام نگه داشته می‌شود
          attachmentBagRef.current.set(cid, {
            key: '',
            name: 'پیام صوتی',
            mime: rec.mime,
            size: rec.blob.size,
            type: 'AUDIO',
            previewUrl: '',
            duration,
            waveform,
            blob: rec.blob,
          })
          setMessages((prev) =>
            prev.map((p) => (p.clientId === cid ? { ...p, status: 'failed' } : p)),
          )
          return
        }
        att.duration = duration
        att.waveform = waveform

        const res = await fetch(`/api/chats/${kind}/${targetId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: '',
            clientId: cid,
            replyToId: null,
            attachment: {
              key: att.key,
              name: att.name,
              mime: att.mime,
              size: att.size,
              type: att.type,
              duration,
              waveform: waveform ?? null,
            },
          }),
        })
        if (res.ok) {
          const data = await res.json()
          const serverMsg = data.message as ChatMessage
          setMessages((prev) => {
            const idx = prev.findIndex((p) => p.clientId === cid)
            if (idx === -1) {
              if (prev.some((p) => p.id === serverMsg.id)) return prev
              return [...prev, serverMsg]
            }
            const next = [...prev]
            next[idx] = serverMsg
            return next
          })
          scrollToBottom(true)
        } else {
          attachmentBagRef.current.set(cid, att)
          setMessages((prev) =>
            prev.map((p) => (p.clientId === cid ? { ...p, status: 'failed' } : p)),
          )
        }
      } catch {
        setMessages((prev) =>
          prev.map((p) => (p.clientId === cid ? { ...p, status: 'failed' } : p)),
        )
      } finally {
        setSending(false)
      }
    },
    [meta, kind, targetId, me, scrollToBottom, uploadVoice],
  )

  // ─── ایموجی: درج در محل نشانگر ───
  const insertEmoji = useCallback(
    (em: string) => {
      const el = textareaRef.current
      if (!el) {
        setText((t) => t + em)
        return
      }
      const start = el.selectionStart ?? text.length
      const end = el.selectionEnd ?? text.length
      const next = text.slice(0, start) + em + text.slice(end)
      if (next.length > MAX_BODY) return
      setText(next)
      requestAnimationFrame(() => {
        el.focus()
        const pos = start + em.length
        el.setSelectionRange(pos, pos)
      })
    },
    [text],
  )

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    const res = await fetch(`/api/messages/${target.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 200) {
      setMessages((prev) =>
        prev.map((p) =>
          p.id === target.id
            ? { ...p, deletedAt: new Date().toISOString(), body: '', attachment: null }
            : p,
        ),
      )
      // پیام حذف‌شده از فهرست سنجاق‌شده‌ها خارج می‌شود (نمایش «حذف شد» حفظ می‌شود)
      setPinned((prev) => prev.filter((p) => p.id !== target.id))
    }
  }, [deleteTarget])

  // ─── سنجاق پیام (فقط معلم/مدیر — مجوز نهایی سمت سرور) ───
  const pinMessage = useCallback(
    async (m: ChatMessage, next: boolean) => {
      const res = await fetch(`/api/messages/${m.id}/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? 'عملیات سنجاق ناموفق بود')
        return
      }
      const msg = data.message as ChatMessage
      if (msg) {
        setMessages((prev) => prev.map((p) => (p.id === msg.id ? msg : p)))
        setPinned((prev) => {
          const without = prev.filter((p) => p.id !== msg.id)
          if (msg.pinnedAt) {
            return [...without, msg].sort(
              (a, b) =>
                Date.parse(b.pinnedAt ?? '0') - Date.parse(a.pinnedAt ?? '0'),
            )
          }
          return without
        })
      }
      toast.success(next ? 'پیام سنجاق شد' : 'سنجاق پیام برداشته شد')
    },
    [],
  )

  const jumpTo = useCallback(
    async (id: string) => {
      // اگر پیام در صفحه فعلی بارگذاری نشده، صفحات قدیمی‌تر تا یافتن آن خوانده می‌شود
      let found = !!document.querySelector(`[data-message-id="${id}"]`)
      if (!found) {
        let cursor = messagesRef.current[0]?.createdAt
        let guard = 0
        while (!found && cursor && guard < 30) {
          try {
            const res = await fetch(
              `/api/chats/${kind}/${targetId}/messages?before=${encodeURIComponent(cursor)}`,
              { cache: 'no-store' },
            )
            if (!res.ok) break
            const data = await res.json()
            const page: ChatMessage[] = data.messages ?? []
            if (!page.length) break
            cursor = page[0].createdAt
            setMessages((prev) => {
              const known = new Set(prev.map((p) => p.id))
              const fresh = page.filter((m) => !known.has(m.id))
              return [...fresh, ...prev]
            })
            setHasMore(!!data.hasMore)
            await new Promise((r) => requestAnimationFrame(() => r(null)))
            found = !!document.querySelector(`[data-message-id="${id}"]`)
            if (!data.hasMore) break
          } catch {
            break
          }
          guard++
        }
      }
      setHighlightId(id)
      setTimeout(() => setHighlightId(null), 1600)
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-message-id="${id}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    },
    [kind, targetId],
  )

  const canDeleteMessage = useCallback(
    (m: ChatMessage) =>
      m.sender.id === me.id ||
      (me.role === 'SCHOOL_ADMIN' && kind === 'group'),
    [me.role, kind],
  )

  // سنجاق فقط برای معلم و مدیر مدرسه — مجوز نهایی سمت سرور کنترل می‌شود
  const canPinMessages = me.role === 'TEACHER' || me.role === 'SCHOOL_ADMIN'

  const currentPin = pinned.length
    ? pinned[Math.min(pinIdx, pinned.length - 1)]
    : null

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottomRef.current) setNewBelow(0)
    if (el.scrollTop < 80 && hasMore && !loadingOlder) loadOlder()
  }, [hasMore, loadingOlder, loadOlder])

  // ─── بی‌صدایی گفتگو ───
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/me/mutes', { cache: 'no-store' })
        if (!res.ok || !alive) return
        const d = await res.json()
        const chatType = kind === 'group' ? 'GROUP' : 'DIRECT'
        setMuted(
          (d.items ?? []).some(
            (m: { chatType: string; chatKey: string }) =>
              m.chatType === chatType && m.chatKey === targetId,
          ),
        )
      } catch {
        /* ignore */
      }
    })()
    return () => {
      alive = false
    }
  }, [kind, targetId])

  const toggleMute = useCallback(async () => {
    const next = !muted
    setMuted(next)
    try {
      const res = await fetch('/api/me/mutes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chatType: kind === 'group' ? 'GROUP' : 'DIRECT',
          chatKey: targetId,
          muted: next,
        }),
      })
      if (!res.ok) setMuted(!next)
    } catch {
      setMuted(!next)
    }
  }, [muted, kind, targetId])

  // ─── قفل/باز کردن گروه برای دانش‌آموزان (معلم منتسب / مدیر مدرسه) ───
  const toggleLock = useCallback(async () => {
    if (!meta || kind !== 'group') return
    const next = !(
      meta.lockedForStudents || meta.policy === 'STAFF' || meta.policy === 'ADMINS'
    )
    setLockPending(true)
    try {
      const res = await fetch(`/api/groups/${targetId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messagePolicy: next ? 'STAFF' : 'ALL' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? 'تغییر وضعیت قفل گروه ناموفق بود')
        return
      }
      // سرور هر دو فیلد (policy + lockedForStudents) را هم‌زمان برمی‌گرداند —
      // وضعیت محلی از پاسخ سرور ساخته می‌شود تا با پنل مدیریت هم‌خوان بماند
      setMeta((prev) =>
        prev
          ? {
              ...prev,
              policy: data?.group?.messagePolicy ?? (next ? 'STAFF' : 'ALL'),
              lockedForStudents:
                data?.group?.lockedForStudents !== undefined
                  ? data.group.lockedForStudents
                  : next,
            }
          : prev,
      )
      toast.success(
        next
          ? 'گروه برای دانش‌آموزان قفل شد'
          : 'قفل گروه برداشته شد',
      )
    } finally {
      setLockPending(false)
    }
  }, [meta, kind, targetId])

  // ─── جست‌وجوی درون گروهی (فقط گروه‌های درسی) ───
  useEffect(() => {
    if (!searchOpen || kind !== 'group') return
    const q = searchQ.trim()
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (q.length < 2) {
      setSearchHits(null)
      setSearching(false)
      return
    }
    setSearching(true)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/chats/group/${targetId}/search?q=${encodeURIComponent(q)}`,
          { cache: 'no-store' },
        )
        if (res.ok) {
          const d = await res.json()
          setSearchHits(d.results ?? [])
        }
      } catch {
        /* نتیجه قبلی می‌ماند */
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQ, searchOpen, kind, targetId])

  const openSearch = useCallback(() => {
    setSearchQ('')
    setSearchHits(null)
    setSearchOpen(true)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQ('')
    setSearchHits(null)
  }, [])

  // پنل جست‌وجوی درون گروهی هم مثل پنجره‌ها با دکمهٔ back موبایل بسته می‌شود (درخواست کاربر)
  useDialogHistory(searchOpen, (next) => (next ? openSearch() : closeSearch()))

  // دکمهٔ بازگشت موبایل: اگر ورود به این گفتگو از فهرست گفتگوها بوده (نشان
  // sessionStorage)، back طبیعی بدون افزودن ورودی history؛ ورود از اعلان/لینک
  // مستقیم → هدایت به فهرست گفتگوها
  const goBackToConversations = useCallback(() => {
    let enteredFromList = false
    try {
      enteredFromList = sessionStorage.getItem('daniar-chat-entry') === 'list'
      sessionStorage.removeItem('daniar-chat-entry')
    } catch {
      /* private mode */
    }
    if (enteredFromList) router.back()
    else router.push('/')
  }, [router])

  // دکمهٔ back سیستم‌عامل داخل گروه/گفتگو: خروج از گفتگو و نمایش فهرست گفتگوها
  // (درخواست کاربر) — اگر مقصد popstate خودِ گفتگوی دیگری است (ورود زنجیره‌ای از
  // اعلان/فروارد)، به‌جای گفتگوی قبلی فهرست گفتگوها جایگزین می‌شود.
  // اگر back صرفِ بستن پنجره/پنل جست‌وجو بوده، ناوبری نادیده گرفته می‌شود
  useEffect(() => {
    const onPopState = () => {
      if (wasDialogPopstate()) return
      let p = ''
      try {
        p = window.location.pathname
      } catch {
        return
      }
      if (/^\/chats\/(group|dm)\//.test(p)) {
        router.replace('/')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [router])

  const openSearchHit = useCallback(
    (id: string) => {
      closeSearch()
      jumpTo(id)
    },
    [closeSearch, jumpTo],
  )

  // ─── صفحه‌کلید موبایل (visualViewport) ───
  useEffect(() => {
    const vv = (
      window as Window & { visualViewport?: VisualViewport }
    ).visualViewport
    if (!vv) return
    const onResize = () => {
      const kb = window.innerHeight - vv.height - vv.offsetTop
      setKbOffset(kb > 150 ? Math.round(kb) : 0)
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    onResize()
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])

  const composerBlocked = meta ? !meta.canSend : false

  const headerTitle = meta?.title ?? '…'
  const headerSubtitle = useMemo(() => {
    if (!meta) return ''
    if (meta.archived) return 'بایگانی‌شده'
    if (meta.type === 'GROUP') return meta.subtitle
    return meta.subtitle
  }, [meta])

  // دسترسی‌های هدر گروه — اجرای نهایی مجوزها همیشه سمت سرور است
  const isGroup = kind === 'group'
  const canManageGroup = isGroup && (me.role === 'TEACHER' || me.role === 'SCHOOL_ADMIN')
  // وضعیت قفل یکسان با پنل مدیریت (درخواست کاربر):
  // policy STAFF/ADMINS یا پرچم lockedForStudents — هر یک قفل یعنی قفل
  const lockedForStudents =
    !!meta?.lockedForStudents || meta?.policy === 'STAFF' || meta?.policy === 'ADMINS'
  const canLockGroup =
    canManageGroup && !(me.role === 'TEACHER' && meta?.policy === 'ADMINS')

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          این گفتگو یافت نشد یا به آن دسترسی ندارید
        </p>
        <Button variant="outline" onClick={() => router.push('/')}>
          بازگشت به گفتگوها
        </Button>
      </div>
    )
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 min-w-0 h-full relative"
      style={kbOffset > 0 ? { height: `calc(100dvh - ${kbOffset}px)` } : undefined}
    >
      {/* سربرگ گفتگو */}
      <header className="flex items-center gap-1.5 sm:gap-2.5 border-b bg-card/95 backdrop-blur px-3 py-2.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={goBackToConversations}
          aria-label="بازگشت"
        >
          <ArrowRight className="h-5 w-5" />
        </Button>
        {isGroup ? (
          <button
            onClick={() => setMembersOpen(true)}
            className="min-w-0 flex-1 flex items-center gap-2.5 text-right rounded-lg px-1 py-0.5 -mx-1 hover:bg-accent transition-colors"
            aria-label="نمایش اعضای گروه"
            title="نمایش اعضای گروه و شروع گفتگوی خصوصی"
            data-testid="group-header"
          >
            <span className="h-9 w-9 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center overflow-hidden border">
              {meta?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={meta.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Users className="h-4.5 w-4.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 min-w-0">
                {lockedForStudents && (
                  <Lock
                    className="h-3.5 w-3.5 text-amber-500 shrink-0"
                    aria-label="گروه برای دانش‌آموزان قفل است"
                  />
                )}
                <h1 className="text-sm font-bold truncate">{headerTitle}</h1>
              </span>
              <span className="block text-[11px] text-muted-foreground truncate">
                {headerSubtitle}
                {meta?.archived ? ' — فقط خواندنی' : ''}
              </span>
            </span>
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold truncate">{headerTitle}</h1>
            <p className="text-[11px] text-muted-foreground truncate">
              {headerSubtitle}
              {meta?.archived ? ' — فقط خواندنی' : ''}
            </p>
          </div>
        )}
        {/* وضعیت اتصال فقط وقتی وصل نیستیم — درحال اتصال/قطع (تلاش مجدد خودکار است) */}
        <ConnectionBadge className="text-[11px]" hideWhenConnected />
        {isGroup && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={searchOpen ? closeSearch : openSearch}
            aria-label={searchOpen ? 'بستن جست‌وجو' : 'جست‌وجو در پیام‌های این گروه'}
            title="جست‌وجو در پیام‌های این گروه"
            data-testid="group-search-toggle"
          >
            {searchOpen ? <X className="h-4.5 w-4.5" /> : <Search className="h-4.5 w-4.5" />}
          </Button>
        )}
        {canLockGroup && meta && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={toggleLock}
            disabled={lockPending}
            aria-label={
              lockedForStudents ? 'برداشتن قفل گروه' : 'قفل کردن گروه برای دانش‌آموزان'
            }
            title={
              lockedForStudents
                ? 'گروه قفل است — برداشتن قفل'
                : 'قفل کردن گروه برای دانش‌آموزان'
            }
            data-testid="group-lock-toggle"
          >
            {lockPending ? (
              <Loader2 className="h-4.5 w-4.5 animate-spin" />
            ) : lockedForStudents ? (
              <Lock className="h-4.5 w-4.5 text-amber-500" />
            ) : (
              <LockOpen className="h-4.5 w-4.5" />
            )}
          </Button>
        )}
        {canManageGroup && meta && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => setSettingsOpen(true)}
            aria-label="تنظیمات گروه"
            title="تنظیمات گروه — نام، تصویر و قفل"
            data-testid="group-settings"
          >
            <Settings2 className="h-4.5 w-4.5" />
          </Button>
        )}
        {meta && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={toggleMute}
            aria-label={muted ? 'صدادار کردن این گفتگو' : 'بی‌صدا کردن این گفتگو'}
            title={muted ? 'این گفتگو بی‌صداست — اعلان جدید نمی‌گیرید' : 'بی‌صدا کردن اعلان این گفتگو'}
          >
            {muted ? <BellOff className="h-4.5 w-4.5 text-amber-500" /> : <Bell className="h-4.5 w-4.5" />}
          </Button>
        )}
      </header>

      {/* پنل جست‌وجوی درون گروهی */}
      {searchOpen && isGroup && (
        <div className="border-b bg-card shrink-0" data-testid="group-search-panel">
          <div className="relative px-3 pt-2.5">
            <Search className="absolute top-1/2 translate-y-[calc(-50%-5px)] right-5 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="جست‌وجو در پیام‌های این گروه…"
              className="pr-8 h-9 text-sm"
              aria-label="جست‌وجو در پیام‌های گروه"
              data-testid="group-search-input"
            />
          </div>
          <div className="max-h-64 overflow-y-auto px-2 py-1.5">
            {searchQ.trim().length < 2 ? (
              <p className="text-center text-[11.5px] text-muted-foreground py-3">
                حداقل ۲ حرف بنویسید…
              </p>
            ) : searching ? (
              <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : !searchHits || searchHits.length === 0 ? (
              <p className="text-center text-[11.5px] text-muted-foreground py-3">
                نتیجه‌ای در این گروه یافت نشد
              </p>
            ) : (
              searchHits.map((h) => (
                <button
                  key={h.id}
                  onClick={() => openSearchHit(h.id)}
                  className="w-full text-right rounded-lg px-2 py-1.5 hover:bg-accent transition-colors"
                  data-testid="group-search-hit"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-bold truncate flex-1">
                      {h.senderName}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground shrink-0">
                      {chatTime(h.createdAt)}
                    </span>
                  </span>
                  <span className="block text-[11.5px] text-muted-foreground truncate">
                    {h.refTitle
                      ? `${h.type === 'ASSIGNMENT' ? 'تکلیف' : h.type === 'SAMPLEQ' ? 'نمونه‌سؤال' : ''}${h.refTitle} — ${h.body}`
                      : h.body.slice(0, 140)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {removedNotice && (
        <div className="bg-destructive/10 text-destructive text-xs px-4 py-2 flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" />
          این گروه حذف شده است.
          <button onClick={() => router.push('/')} className="underline font-medium">
            بازگشت به گفتگوها
          </button>
        </div>
      )}

      {/* نوار پیام سنجاق‌شده */}
      {currentPin && (
        <div className="border-b border-amber-500/30 bg-amber-500/5 px-3 py-1.5 flex items-center gap-2 shrink-0">
          <Pin className="h-3.5 w-3.5 text-amber-500 shrink-0 rotate-45" />
          <button
            onClick={() => jumpTo(currentPin.id)}
            className="min-w-0 flex-1 text-right"
            aria-label="رفتن به پیام سنجاق‌شده"
          >
            <span className="block text-[11px] font-bold text-amber-600 dark:text-amber-400">
              پیام سنجاق‌شده
              {pinned.length > 1
                ? ` — ${new Intl.NumberFormat('fa-IR').format(pinIdx + 1)} از ${new Intl.NumberFormat('fa-IR').format(pinned.length)}`
                : ''}
            </span>
            <span className="block text-xs truncate text-muted-foreground">
              {currentPin.sender.fullName}: {pinPreview(currentPin)}
            </span>
          </button>
          {pinned.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setPinIdx((i) => (i + 1) % pinned.length)}
                aria-label="سنجاق بعدی"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setPinIdx((i) => (i - 1 + pinned.length) % pinned.length)}
                aria-label="سنجاق قبلی"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {canPinMessages && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => pinMessage(currentPin, false)}
              aria-label="برداشتن سنجاق"
              title="برداشتن سنجاق این پیام"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}


      {/* پیام‌ها */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="chat-messages-bg flex-1 overflow-y-auto min-h-0 py-3 bg-muted/20"
      >
        {initialLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-center text-sm text-destructive py-8">{loadError}</p>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center pb-2">
                {loadingOlder ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Button variant="ghost" size="sm" onClick={loadOlder} className="text-xs">
                    نمایش پیام‌های قدیمی‌تر
                  </Button>
                )}
              </div>
            )}
            {messages.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-10">
                هنوز پیامی نیست — اولین پیام را بفرستید
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'transition-colors rounded-lg',
                    highlightId === m.id && 'bg-primary/10',
                  )}
                >
                  <MessageBubble
                    message={m}
                    mine={m.sender.id === me.id}
                    isDm={kind === 'dm'}
                    canDelete={canDeleteMessage(m)}
                    canPin={canPinMessages}
                    onReply={(x) => {
                      setEditing(null)
                      setReplyTo(x)
                    }}
                    onEdit={(x) => {
                      setReplyTo(null)
                      setEditing(x)
                      setText(x.body)
                    }}
                    onDelete={setDeleteTarget}
                    onRetry={retry}
                    onForward={setForwardTarget}
                    onPin={pinMessage}
                    onJumpTo={jumpTo}
                  />
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* دکمه پیام‌های جدید — هنگام خواندن پیام‌های قدیمی */}
      {newBelow > 0 && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 z-20">
          <Button
            size="sm"
            className="pointer-events-auto gap-1.5 shadow-lg rounded-full"
            onClick={() => {
              setNewBelow(0)
              scrollToBottom(true)
            }}
          >
            <ArrowDown className="h-4 w-4" />
            {new Intl.NumberFormat('fa-IR').format(newBelow)} پیام جدید
          </Button>
        </div>
      )}

      {/* ناحیه ارسال */}
      {composerBlocked ? (
        <div className="border-t bg-card px-4 py-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-2 shrink-0">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          {meta?.cannotSendReason ?? 'ارسال پیام در این گفتگو مجاز نیست'}
        </div>
      ) : (
        <div className="border-t bg-card shrink-0">
          {/* نوار پاسخ/ویرایش */}
          {(replyTo || editing) && (
            <div className="flex items-center gap-2 px-3 pt-2 text-xs">
              {editing ? (
                <Pencil className="h-3.5 w-3.5 text-primary shrink-0" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0 rotate-180" />
              )}
              <div className="min-w-0 flex-1 border-r-2 border-primary pr-2">
                <span className="block font-medium text-primary">
                  {editing ? 'ویرایش پیام' : `پاسخ به ${replyTo!.sender.fullName}`}
                </span>
                <span className="block truncate text-muted-foreground">
                  {editing ? editing.body : replyTo!.body || '(پیوست)'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setReplyTo(null)
                  setEditing(null)
                  setText('')
                }}
                aria-label="لغو"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* پیوست در انتظار ارسال */}
          {pending && (
            <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs">
              <FileIcon className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate flex-1">{pending.name}</span>
              <span className="text-muted-foreground shrink-0">
                {formatSize(pending.size)}
              </span>
              <button
                onClick={() => setPending(null)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="حذف پیوست"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {recording ? (
            /* پنل ضبط پیام صوتی — جای ردیف کامپوزر */
            <VoiceRecorderPanel onDone={sendVoice} onCancel={onRecorderCancel} />
          ) : (
            <div className="flex items-end gap-1.5 p-2.5">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onFilePicked(f)
                }}
                aria-hidden="true"
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !connected || initialLoading}
                aria-label="پیوست فایل"
                title="ارسال تصویر، فایل، صوت یا ویدئو"
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Paperclip className="h-5 w-5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={startRecording}
                disabled={uploading || !connected || initialLoading}
                aria-label="ضبط پیام صوتی"
                title="ضبط پیام صوتی"
              >
                <Mic className="h-5 w-5" />
              </Button>
              <Textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    doSend()
                  }
                }}
                placeholder={initialLoading ? 'در حال بارگذاری گفتگو…' : 'پیام…'}
                rows={1}
                className="min-h-10 max-h-32 resize-none text-sm"
                aria-label="متن پیام"
              />
              <EmojiPicker onPick={insertEmoji} disabled={!connected || initialLoading} />
              <Button
                size="icon"
                className="shrink-0"
                onClick={doSend}
                disabled={sending || initialLoading || (!text.trim() && !pending)}
                aria-label="ارسال"
              >
                <Send className="h-4.5 w-4.5 -scale-x-100" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* تأیید حذف پیام */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف پیام</AlertDialogTitle>
            <AlertDialogDescription>
              این پیام برای همه اعضای گفتگو حذف می‌شود و قابل بازگشت نیست. مطمئن هستید؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              حذف پیام
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* اعضای گروه — کلیک روی نام عضو → گفتگوی خصوصی */}
      {isGroup && (
        <GroupMembersDialog
          open={membersOpen}
          onOpenChange={setMembersOpen}
          groupId={targetId}
          meId={me.id}
          onOpenSettings={canManageGroup ? () => setSettingsOpen(true) : undefined}
        />
      )}

      {/* تنظیمات گروه — فقط معلم منتسب و مدیر مدرسه */}
      {isGroup && (
        <GroupSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          meta={meta}
          onUpdated={(patch) =>
            setMeta((prev) =>
              prev
                ? {
                    ...prev,
                    ...(patch.name !== undefined ? { title: patch.name } : {}),
                    ...(patch.policy !== undefined ? { policy: patch.policy } : {}),
                    ...(patch.lockedForStudents !== undefined
                      ? { lockedForStudents: patch.lockedForStudents }
                      : {}),
                    ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
                  }
                : prev,
            )
          }
        />
      )}

      {/* دیالوگ هدایت پیام */}
      <ForwardDialog
        open={!!forwardTarget}
        onOpenChange={(o) => !o && setForwardTarget(null)}
        message={forwardTarget}
      />
    </div>
  )
}
