'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  X,
  UploadCloud,
  FileIcon,
  Trash2,
  Send,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatSize } from '@/components/messenger/types'

export interface SampleQMeta {
  classrooms: { id: string; name: string; studentCount: number }[]
  groups: {
    id: string
    name: string
    classroomId: string
    classroomName: string
  }[]
  subjects: string[]
}

export interface ExistingFile {
  id: string
  name: string
  mime: string
  size: number
}

interface StagedFile {
  key: string
  name: string
  mime: string
  size: number
}

export interface SampleQFormData {
  id?: string
  title: string
  subject: string
  topic: string
  description: string
  classIds: string[]
  showAnswer: boolean
  published: boolean
  keepQuestionFileIds: string[]
  keepAnswerFileIds: string[]
  questionFiles: ExistingFile[]
  answerFiles: ExistingFile[]
}

interface SampleQFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initial?: SampleQFormData | null
  meta: SampleQMeta | null
  onSaved: (id: string) => void
}

function FileListEditor({
  label,
  existing,
  staged,
  onRemoveExisting,
  onRemoveStaged,
  onPick,
  uploading,
}: {
  label: string
  existing: ExistingFile[]
  staged: StagedFile[]
  onRemoveExisting: (id: string) => void
  onRemoveStaged: (key: string) => void
  onPick: (files: FileList | null) => void
  uploading: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-primary cursor-pointer hover:underline">
          <UploadCloud className="h-4 w-4" />
          افزودن فایل
          <input
            type="file"
            multiple
            accept=".pdf,.doc,.docx,image/*"
            className="hidden"
            onChange={(e) => {
              onPick(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {uploading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          در حال آپلود…
        </div>
      )}
      {existing.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs"
        >
          <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="shrink-0 text-muted-foreground">{formatSize(f.size)}</span>
          <button
            type="button"
            onClick={() => onRemoveExisting(f.id)}
            aria-label={`حذف فایل ${f.name}`}
            className="text-destructive hover:text-destructive/80 shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {staged.map((f) => (
        <div
          key={f.key}
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs"
        >
          <FileIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="shrink-0 text-muted-foreground">{formatSize(f.size)}</span>
          <button
            type="button"
            onClick={() => onRemoveStaged(f.key)}
            aria-label={`حذف فایل ${f.name}`}
            className="text-destructive hover:text-destructive/80 shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {!existing.length && !staged.length && (
        <p className="text-[11px] text-muted-foreground">
          فایلی انتخاب نشده است — PDF، تصویر یا Word (حداکثر ۲۰ مگابایت)
        </p>
      )}
    </div>
  )
}

/**
 * فرم ایجاد/ویرایش نمونه‌سؤال — کلاس‌های مخاطب چندانتخابی، فایل سؤال و پاسخ‌نامه،
 * کلید نمایش پاسخ‌نامه، انتشار/پیش‌نویس و ارسال پیام خودکار به گروه درسی
 */
export function SampleQFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  meta,
  onSaved,
}: SampleQFormDialogProps) {
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [classIds, setClassIds] = useState<string[]>([])
  const [showAnswer, setShowAnswer] = useState(false)
  const [published, setPublished] = useState(true)
  const [sendGroupEnabled, setSendGroupEnabled] = useState(false)
  const [groupId, setGroupId] = useState('')

  const [keepQuestionFileIds, setKeepQuestionFileIds] = useState<string[]>([])
  const [keepAnswerFileIds, setKeepAnswerFileIds] = useState<string[]>([])
  const [existingQuestionFiles, setExistingQuestionFiles] = useState<ExistingFile[]>([])
  const [existingAnswerFiles, setExistingAnswerFiles] = useState<ExistingFile[]>([])
  const [stagedQuestionFiles, setStagedQuestionFiles] = useState<StagedFile[]>([])
  const [stagedAnswerFiles, setStagedAnswerFiles] = useState<StagedFile[]>([])

  const [uploadingQ, setUploadingQ] = useState(false)
  const [uploadingA, setUploadingA] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const clientIdRef = useRef<string>('')

  // مقداردهی اولیه هنگام باز شدن
  useEffect(() => {
    if (!open) return
    setError('')
    setSaving(false)
    if (mode === 'edit' && initial) {
      setTitle(initial.title)
      setSubject(initial.subject)
      setTopic(initial.topic)
      setDescription(initial.description)
      setClassIds(initial.classIds)
      setShowAnswer(initial.showAnswer)
      setPublished(initial.published)
      setKeepQuestionFileIds(initial.questionFiles.map((f) => f.id))
      setKeepAnswerFileIds(initial.answerFiles.map((f) => f.id))
      setExistingQuestionFiles(initial.questionFiles)
      setExistingAnswerFiles(initial.answerFiles)
      setSendGroupEnabled(false)
      setGroupId('')
    } else {
      setTitle('')
      setSubject('')
      setTopic('')
      setDescription('')
      setClassIds([])
      setShowAnswer(false)
      setPublished(true)
      setKeepQuestionFileIds([])
      setKeepAnswerFileIds([])
      setExistingQuestionFiles([])
      setExistingAnswerFiles([])
      setSendGroupEnabled(false)
      setGroupId('')
    }
    setStagedQuestionFiles([])
    setStagedAnswerFiles([])
    // شناسه یکتا برای ضدتکرار تلاش مجدد ایجاد
    clientIdRef.current =
      mode === 'create'
        ? `sq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        : ''
  }, [open, mode, initial])

  // گروه‌های مجاز: فقط گروه‌های کلاس‌های انتخاب‌شده
  const availableGroups = useMemo(() => {
    if (!meta) return []
    return meta.groups.filter((g) => classIds.includes(g.classroomId))
  }, [meta, classIds])

  useEffect(() => {
    if (groupId && !availableGroups.some((g) => g.id === groupId)) setGroupId('')
  }, [availableGroups, groupId])

  async function uploadFiles(files: FileList | null, role: 'QUESTION' | 'ANSWER') {
    if (!files?.length) return
    setError('')
    const setUploading = role === 'QUESTION' ? setUploadingQ : setUploadingA
    const setStaged = role === 'QUESTION' ? setStagedQuestionFiles : setStagedAnswerFiles
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('purpose', 'sampleq')
        const r = await fetch('/api/uploads', { method: 'POST', body: fd })
        const d = await r.json().catch(() => null)
        if (!r.ok) {
          setError(d?.error ?? 'آپلود فایل ناموفق بود')
          continue
        }
        setStaged((prev) => [
          ...prev,
          { key: d.key, name: d.name, mime: d.mime, size: d.size },
        ])
      }
    } catch {
      setError('آپلود فایل ناموفق بود')
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    setError('')
    if (!title.trim()) return setError('عنوان نمونه‌سؤال الزامی است')
    if (!subject.trim()) return setError('نام درس الزامی است')
    if (!classIds.length) return setError('حداقل یک کلاس انتخاب کنید')

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        subject: subject.trim(),
        topic: topic.trim(),
        description: description.trim(),
        classIds,
        showAnswer,
        status: published ? 'PUBLISHED' : 'UNPUBLISHED',
      }

      if (mode === 'create') {
        payload.clientId = clientIdRef.current
        payload.questionFiles = stagedQuestionFiles
        payload.answerFiles = stagedAnswerFiles
      } else if (initial?.id) {
        payload.keepQuestionFileIds = keepQuestionFileIds
        payload.keepAnswerFileIds = keepAnswerFileIds
        payload.questionFiles = stagedQuestionFiles
        payload.answerFiles = stagedAnswerFiles
      }

      if (published && sendGroupEnabled && groupId) {
        payload.sendToGroup = { groupId }
      }

      const url = mode === 'create' ? '/api/sample-questions' : `/api/sample-questions/${initial?.id}`
      const r = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setError(d?.error ?? 'ذخیره ناموفق بود')
        return
      }
      if (d?.warning) setError(d.warning)
      onSaved(d?.id ?? initial?.id ?? '')
      onOpenChange(false)
    } catch {
      setError('ذخیره ناموفق بود')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'نمونه‌سؤال جدید' : 'ویرایش نمونه‌سؤال'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sq-title">عنوان *</Label>
              <Input
                id="sq-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثلاً آزمون میان‌ترم ریاضی"
                maxLength={150}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sq-subject">نام درس *</Label>
              <Input
                id="sq-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="مثلاً ریاضی"
                list="sq-subjects"
                maxLength={60}
              />
              <datalist id="sq-subjects">
                {(meta?.subjects ?? []).map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sq-topic">موضوع (اختیاری)</Label>
              <Input
                id="sq-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="مثلاً معادله درجه دوم"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sq-desc">توضیح</Label>
              <Textarea
                id="sq-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="توضیح کوتاه درباره این نمونه‌سؤال…"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>کلاس‌های دریافت‌کننده *</Label>
            {!meta?.classrooms.length && (
              <p className="text-xs text-muted-foreground">
                کلاسی برای شما ثبت نشده است
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {(meta?.classrooms ?? []).map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors',
                    classIds.includes(c.id)
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-accent',
                  )}
                >
                  <Checkbox
                    checked={classIds.includes(c.id)}
                    onCheckedChange={(v) =>
                      setClassIds((prev) =>
                        v === true ? [...prev, c.id] : prev.filter((x) => x !== c.id),
                      )
                    }
                    aria-label={`انتخاب کلاس ${c.name}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{c.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {c.studentCount} دانش‌آموز
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <FileListEditor
            label="فایل‌های نمونه‌سؤال"
            existing={existingQuestionFiles}
            staged={stagedQuestionFiles}
            onRemoveExisting={(id) => {
              setKeepQuestionFileIds((prev) => prev.filter((x) => x !== id))
              setExistingQuestionFiles((prev) => prev.filter((f) => f.id !== id))
            }}
            onRemoveStaged={(key) =>
              setStagedQuestionFiles((prev) => prev.filter((f) => f.key !== key))
            }
            onPick={(files) => uploadFiles(files, 'QUESTION')}
            uploading={uploadingQ}
          />

          <FileListEditor
            label="فایل‌های پاسخ‌نامه"
            existing={existingAnswerFiles}
            staged={stagedAnswerFiles}
            onRemoveExisting={(id) => {
              setKeepAnswerFileIds((prev) => prev.filter((x) => x !== id))
              setExistingAnswerFiles((prev) => prev.filter((f) => f.id !== id))
            }}
            onRemoveStaged={(key) =>
              setStagedAnswerFiles((prev) => prev.filter((f) => f.key !== key))
            }
            onPick={(files) => uploadFiles(files, 'ANSWER')}
            uploading={uploadingA}
          />

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">نمایش پاسخ‌نامه به دانش‌آموزان</div>
              <div className="text-[11px] text-muted-foreground">
                در صورت فعال‌بودن، فایل‌های پاسخ‌نامه قابل مشاهده و دانلود است
              </div>
            </div>
            <Switch
              checked={showAnswer}
              onCheckedChange={setShowAnswer}
              aria-label="فعال/غیرفعال کردن نمایش پاسخ‌نامه"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">انتشار</div>
              <div className="text-[11px] text-muted-foreground">
                {published
                  ? 'نمونه‌سؤال برای کلاس‌های انتخابی منتشر می‌شود'
                  : 'به‌صورت پیش‌نویس ذخیره می‌شود و دانش‌آموزان نمی‌بینند'}
              </div>
            </div>
            <Switch
              checked={published}
              onCheckedChange={setPublished}
              aria-label="انتشار یا پیش‌نویس"
            />
          </div>

          {published && (
            <div className="rounded-lg border px-3 py-2.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">ارسال پیام به گروه</div>
                  <div className="text-[11px] text-muted-foreground">
                    پیام خودکار با دکمه «مشاهده نمونه‌سؤال» در گروه درسی انتخابی
                  </div>
                </div>
                <Switch
                  checked={sendGroupEnabled}
                  onCheckedChange={setSendGroupEnabled}
                  aria-label="فعال‌کردن ارسال پیام به گروه"
                />
              </div>
              {sendGroupEnabled && (
                <div className="space-y-1.5">
                  <Select value={groupId} onValueChange={setGroupId}>
                    <SelectTrigger aria-label="انتخاب گروه مقصد">
                      <SelectValue placeholder="انتخاب گروه مقصد…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableGroups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name} ({g.classroomName})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!availableGroups.length && (
                    <p className="text-[11px] text-amber-600">
                      برای کلاس‌های انتخابی گروه فعالی وجود ندارد
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <X className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex gap-2 justify-start">
            <Button onClick={submit} disabled={saving} className="min-w-28">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  در حال ذخیره…
                </>
              ) : (
                <>
                  {mode === 'create' ? <Send className="h-4 w-4" /> : null}
                  {mode === 'create' ? 'ایجاد نمونه‌سؤال' : 'ذخیره تغییرات'}
                </>
              )}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              انصراف
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
