'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ImagePlus, Trash2, Lock, Save } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { ConversationMeta } from './types'

interface GroupSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  meta: ConversationMeta | null
  /** تغییرات روی گفتگوی باز اعمال شود (نام/سیاست/تصویر) */
  onUpdated: (patch: {
    name?: string
    policy?: string
    avatarUrl?: string | null
  }) => void
}

/**
 * تنظیمات گروه درسی — فقط معلم منتسب و مدیر مدرسه.
 * شامل تغییر نام، تصویر پروفایل گروه و قفل کردن گروه برای دانش‌آموزان.
 */
export function GroupSettingsDialog({
  open,
  onOpenChange,
  meta,
  onUpdated,
}: GroupSettingsDialogProps) {
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [locked, setLocked] = useState(false)
  const [savingLock, setSavingLock] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const policy = meta?.policy ?? 'ALL'
  const isAdminOnly = policy === 'ADMINS'

  useEffect(() => {
    if (!open || !meta) return
    setName(meta.title)
    setLocked(policy === 'STAFF' || policy === 'ADMINS')
    setAvatarUrl(meta.avatarUrl ?? null)
  }, [open, meta, policy])

  const patchGroup = async (payload: Record<string, unknown>) => {
    if (!meta) return false
    const res = await fetch(`/api/groups/${meta.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      toast.error(data?.error ?? 'ذخیره تغییرات ناموفق بود')
      return false
    }
    return true
  }

  const saveName = async () => {
    const next = name.trim()
    if (!next || next === meta?.title) return
    setSavingName(true)
    const ok = await patchGroup({ name: next })
    setSavingName(false)
    if (ok) {
      toast.success('نام گروه به‌روزرسانی شد')
      onUpdated({ name: next })
    }
  }

  const toggleLock = async (next: boolean) => {
    if (isAdminOnly) return
    setLocked(next)
    setSavingLock(true)
    const ok = await patchGroup({ messagePolicy: next ? 'STAFF' : 'ALL' })
    setSavingLock(false)
    if (ok) {
      toast.success(
        next
          ? 'گروه برای دانش‌آموزان قفل شد — فقط معلم و مدیر می‌توانند پیام بفرستند'
          : 'قفل گروه برداشته شد — همه اعضا می‌توانند پیام بفرستند',
      )
      onUpdated({ policy: next ? 'STAFF' : 'ALL' })
    } else {
      setLocked(!next)
    }
  }

  const uploadAvatar = async (file: File) => {
    if (!meta) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('purpose', 'avatar')
      const res = await fetch('/api/uploads', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.key) {
        toast.error(data?.error ?? 'آپلود تصویر ناموفق بود')
        return
      }
      const ok = await patchGroup({ avatarKey: data.key })
      if (ok) {
        const url = `/api/groups/${meta.id}/avatar?v=${Date.now()}`
        setAvatarUrl(url)
        onUpdated({ avatarUrl: url })
        toast.success('تصویر گروه به‌روزرسانی شد')
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeAvatar = async () => {
    if (!meta) return
    setUploading(true)
    try {
      const ok = await patchGroup({ avatarKey: null })
      if (ok) {
        setAvatarUrl(null)
        onUpdated({ avatarUrl: null })
        toast.success('تصویر گروه حذف شد')
      }
    } finally {
      setUploading(false)
    }
  }

  if (!meta) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base">تنظیمات گروه</DialogTitle>
          <DialogDescription>
            نام، تصویر پروفایل و قفل گروه — تغییرات برای همه اعضا اعمال می‌شود
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* تصویر پروفایل گروه */}
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 border">
              {avatarUrl && <AvatarImage src={avatarUrl} alt="تصویر گروه" />}
              <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
                {meta.title.trim().charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadAvatar(f)
                }}
                aria-hidden="true"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
                تغییر تصویر
              </Button>
              {avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={removeAvatar}
                  disabled={uploading}
                >
                  <Trash2 className="h-4 w-4" />
                  حذف تصویر
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                JPG، PNG، WebP یا GIF — حداکثر ۸ مگابایت
              </p>
            </div>
          </div>

          {/* نام گروه */}
          <div className="space-y-1.5">
            <Label htmlFor="group-name-input">نام گروه</Label>
            <div className="flex gap-2">
              <Input
                id="group-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName()
                }}
              />
              <Button
                size="icon"
                onClick={saveName}
                disabled={savingName || !name.trim() || name.trim() === meta.title}
                aria-label="ذخیره نام گروه"
                title="ذخیره نام گروه"
              >
                {savingName ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              نام گروه برای همه اعضا نمایش داده می‌شود
            </p>
          </div>

          {/* قفل گروه برای دانش‌آموزان */}
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Lock className="h-4 w-4" />
                قفل گروه برای دانش‌آموزان
              </div>
              <p className="text-[11.5px] text-muted-foreground leading-5">
                {isAdminOnly
                  ? 'این گروه فقط برای مدیر مدرسه قابل ارسال است (تنظیم از پنل مدیریت)'
                  : locked
                    ? 'فعال — دانش‌آموزان فقط می‌خوانند؛ معلمان و مدیر می‌توانند پیام بفرستند'
                    : 'غیرفعال — همه اعضا می‌توانند در گروه پیام بفرستند'}
              </p>
            </div>
            <Switch
              checked={locked}
              onCheckedChange={toggleLock}
              disabled={savingLock || isAdminOnly}
              aria-label="قفل کردن گروه برای دانش‌آموزان"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
