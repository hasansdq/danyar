'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Paperclip, Loader2, X } from 'lucide-react'
import { faBytes, toLocalInputValue, uploadAssignmentFile, type AssignmentRow, type GroupMeta, type StagedFile } from './shared'
import { ANSWER_MODES, ANSWER_MODE_LABELS, type AnswerMode } from '@/lib/assignment-status'

interface Props {
  groups: GroupMeta[]
  open: boolean
  onOpenChange: (v: boolean) => void
  /** در حالت ویرایش، تکلیف اولیه */
  initial?: AssignmentRow | null
  onSaved: () => void
}

/**
 * فرم ایجاد/ویرایش تکلیف — تکلیف همیشه به یک گروه درسی متصل است.
 * در حالت ویرایش، گروه درسی قابل تغییر نیست.
 */
export function AssignmentFormDialog({ groups, open, onOpenChange, initial, onSaved }: Props) {
  const editing = !!initial
  const { toast } = useToast()

  const [groupId, setGroupId] = useState<string>('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [answerMode, setAnswerMode] = useState<AnswerMode>('BOTH')
  const [allowEdit, setAllowEdit] = useState(true)
  const [maxGrade, setMaxGrade] = useState('')
  const [attachment, setAttachment] = useState<StagedFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setGroupId(initial?.subjectGroupId ?? groups[0]?.id ?? '')
      setTitle(initial?.title ?? '')
      setDescription(initial?.description ?? '')
      setDueAt(toLocalInputValue(initial?.dueAt ?? null))
      setAnswerMode((initial?.answerMode as AnswerMode) ?? 'BOTH')
      setAllowEdit(initial?.allowEdit ?? true)
      setMaxGrade(initial?.maxGrade != null ? String(initial.maxGrade) : '')
      setAttachment(null)
      setError('')
    }
  }, [open, initial, groups])

  const pickFile = async (f: File | null) => {
    if (!f) return
    setUploading(true)
    setError('')
    try {
      const staged = await uploadAssignmentFile(f)
      setAttachment(staged)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'آپلود ناموفق بود')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submit = async () => {
    setError('')
    if (!groupId) return setError('گروه درسی تکلیف را انتخاب کنید')
    if (!title.trim()) return setError('عنوان تکلیف را وارد کنید')
    setSaving(true)
    try {
      const payload = {
        subjectGroupId: groupId,
        title: title.trim(),
        description: description.trim(),
        answerMode,
        allowEdit,
        maxGrade: maxGrade ? Number(maxGrade) : null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        ...(attachment ? { attachment } : {}),
      }
      const r = await fetch(
        editing ? `/api/assignments/${initial!.id}` : '/api/assignments',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.error ?? 'ثبت تکلیف ناموفق بود')
        return
      }
      toast({
        title: editing ? 'تکلیف ویرایش شد' : 'تکلیف ایجاد شد',
        description: editing ? undefined : 'اعلان تکلیف برای دانش‌آموزان ارسال شد',
      })
      onOpenChange(false)
      onSaved()
    } catch {
      setError('ارتباط با سرور ناموفق بود')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'ویرایش تکلیف' : 'تکلیف جدید'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'گروه درسی تکلیف قابل تغییر نیست'
              : 'تکلیف به یک گروه درسی متصل می‌شود و برای اعضای آن گروه ارسال اعلان می‌شود'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>گروه درسی</Label>
            <Select
              value={groupId}
              onValueChange={setGroupId}
              disabled={editing || groups.length === 0}
            >
              <SelectTrigger dir="rtl" className="w-full">
                <SelectValue placeholder="انتخاب گروه درسی" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name} <span className="text-muted-foreground">— {g.classroomName}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {groups.length === 0 && (
              <p className="text-xs text-amber-600">گروه درسی به شما اختصاص ندارد</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-title">عنوان تکلیف</Label>
            <Input
              id="a-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً حل تمرین‌های فصل کسرها"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-desc">توضیحات</Label>
            <Textarea
              id="a-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="شرح تکلیف، نکات و راهنما..."
              rows={4}
              maxLength={4000}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-due">مهلت ارسال (اختیاری)</Label>
              <Input
                id="a-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-grade">نمره بیشینه (اختیاری)</Label>
              <Input
                id="a-grade"
                type="number"
                min={1}
                max={1000}
                value={maxGrade}
                onChange={(e) => setMaxGrade(e.target.value)}
                placeholder="مثلاً ۲۰"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>نحوه ارسال پاسخ</Label>
              <Select value={answerMode} onValueChange={(v) => setAnswerMode(v as AnswerMode)}>
                <SelectTrigger dir="rtl" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANSWER_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {ANSWER_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch checked={allowEdit} onCheckedChange={setAllowEdit} />
                <span>امکان اصلاح پاسخ توسط دانش‌آموز</span>
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>فایل پیوست (اختیاری)</Label>
            {attachment ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {faBytes(attachment.size)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setAttachment(null)}
                  aria-label="حذف پیوست"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  {uploading ? 'در حال آپلود...' : 'انتخاب فایل پیوست'}
                </Button>
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={submit} disabled={saving || uploading || (!editing && !groupId)}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'ذخیره تغییرات' : 'ایجاد تکلیف'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
