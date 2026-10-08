"use client";

import { useEffect, useState, FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileQuestion,
  Download,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Inbox,
} from "lucide-react";
import {
  fetchClasses,
  fetchSampleQuestions,
  postMessage,
  postSampleQuestion,
} from "@/lib/messenger-api";
import { useToast } from "@/hooks/use-toast";
import { formatPersianDate, formatPersianNumber } from "./persian";
import type {
  ClassItem,
  MessengerUser,
  SampleQuestion,
} from "./types";

/**
 * Sample questions list view for the selected class.
 *
 * - GET /api/sample-questions?classId=
 * - Teacher view: "افزودن نمونه سوال" → POST multipart to /api/teacher/sample-questions
 */
export function SampleQuestionsView({
  classId,
  isTeacher,
  user,
}: {
  classId: string;
  isTeacher: boolean;
  /**
   * Phase 19 — the calling user. Used to fetch the user's classes list for
   * the "ارسال به گفتگو" (forward-to-chat) dialog so the teacher can pick
   * which group/class to post the linked-sample-question card message into.
   */
  user: MessengerUser;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Phase 19 — the sample question the teacher is currently picking a
  // target chat for (forward-to-chat flow). When set, the SendToChat
  // dialog is open.
  const [sendToChatFor, setSendToChatFor] = useState<SampleQuestion | null>(
    null,
  );

  const {
    data: questions,
    isLoading,
    isError,
    refetch,
  } = useQuery<SampleQuestion[]>({
    queryKey: ["sample-questions", classId],
    queryFn: () => fetchSampleQuestions(classId),
  });

  const createMutation = useMutation({
    mutationFn: async (vars: {
      classId: string;
      title: string;
      description?: string;
      file?: File | null;
    }) => {
      const fd = new FormData();
      fd.append("classId", vars.classId);
      fd.append("title", vars.title);
      if (vars.description) fd.append("description", vars.description);
      if (vars.file) fd.append("file", vars.file);
      return postSampleQuestion(fd);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<SampleQuestion[]>(
        ["sample-questions", classId],
        (prev) => (prev ? [created, ...prev] : [created]),
      );
      toast({ title: "نمونه سوال ثبت شد", description: created.title });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "خطا در ثبت نمونه سوال",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {questions
            ? `${formatPersianNumber(questions.length)} نمونه سوال`
            : "در حال بارگذاری…"}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="بارگذاری مجدد"
            onClick={() => void refetch()}
          >
            <RefreshCw className="size-4" />
          </Button>
          {isTeacher ? (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              افزودن نمونه سوال
            </Button>
          ) : null}
        </div>
      </div>

      <div className="scrollbar-rtl flex-1 overflow-y-auto p-3">
        {isError ? (
          <EmptyState
            title="بارگذاری ناموفق بود"
            description="لطفاً مجدداً تلاش کنید."
            actionLabel="بارگذاری مجدد"
            onAction={() => void refetch()}
          />
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <LazySkeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : !questions || questions.length === 0 ? (
          <EmptyState
            title="نمونه سوالی یافت نشد"
            description={
              isTeacher
                ? "برای ساخت اولین نمونه سوال این کلاس، روی «افزودن نمونه سوال» بزنید."
                : "استاد هنوز نمونه سوالی برای این کلاس بارگذاری نکرده است."
            }
            actionLabel={isTeacher ? "افزودن نمونه سوال" : undefined}
            onAction={isTeacher ? () => setDialogOpen(true) : undefined}
          />
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
            }}
            className="space-y-3"
          >
            {questions.map((q) => (
              <SampleQuestionCard
                key={q.id}
                question={q}
                isTeacher={isTeacher}
                onSendToChat={() => setSendToChatFor(q)}
              />
            ))}
          </motion.div>
        )}
      </div>

      <CreateSampleQuestionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        classId={classId}
        submitting={createMutation.isPending}
        onSubmit={(vars) => createMutation.mutate(vars)}
      />

      {/* Phase 19 — send-to-chat dialog (teacher only). Mirrors the
          assignments-view SendAssignmentToChatDialog but for sample
          questions. Lets the teacher forward the sample question to any
          of their classes' chats as a special "linked-sample-question
          card" message. */}
      <SendSampleQuestionToChatDialog
        question={sendToChatFor}
        open={!!sendToChatFor}
        onOpenChange={(v) => {
          if (!v) setSendToChatFor(null);
        }}
        user={user}
      />
    </div>
  );
}

function SampleQuestionCard({
  question,
  isTeacher = false,
  onSendToChat,
}: {
  question: SampleQuestion;
  /**
   * Phase 19 — when true, the card renders the "ارسال به گفتگو" button in
   * the footer (teacher-only affordance).
   */
  isTeacher?: boolean;
  /** Phase 19 — opens the send-to-chat dialog for this question. */
  onSendToChat?: () => void;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0 },
      }}
    >
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-2">
            <span className="bg-teal-500/10 text-teal-600 flex size-8 items-center justify-center rounded-md">
              <FileQuestion className="size-4" />
            </span>
            <div className="flex-1">
              <CardTitle className="text-base leading-tight">
                {question.title}
              </CardTitle>
              <CardDescription className="text-xs">
                ساخته‌شده توسط {question.createdBy.fullName} ·{" "}
                {formatPersianDate(question.createdAt)}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        {question.description ? (
          <CardContent className="pb-3">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {question.description}
            </p>
          </CardContent>
        ) : null}
        {question.fileUrl ? (
          <>
            <Separator />
            <CardContent className="py-2.5 text-xs">
              <a
                href={question.fileUrl}
                download={question.fileName || undefined}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Download className="size-3.5" />
                {question.fileName ? (
                  <span dir="ltr" className="font-mono">
                    {question.fileName}
                  </span>
                ) : (
                  "دانلود فایل"
                )}
              </a>
            </CardContent>
          </>
        ) : (
          <>
            <Separator />
            <CardContent className="py-2.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3.5" />
                بدون فایل پیوست
              </span>
            </CardContent>
          </>
        )}
        {/* Phase 19 — send-to-chat affordance (teacher only). Sits in a
            CardFooter so it visually separates from the file row above. */}
        {isTeacher && onSendToChat ? (
          <CardFooter className="flex items-center justify-end gap-2 border-t py-2.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={onSendToChat}
              aria-label="ارسال به گفتگو"
              title="ارسال به گفتگو"
            >
              <Send className="size-3.5" />
              ارسال به گفتگو
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </motion.div>
  );
}

function CreateSampleQuestionDialog({
  open,
  onOpenChange,
  classId,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  submitting: boolean;
  onSubmit: (vars: {
    classId: string;
    title: string;
    description?: string;
    file?: File | null;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setFile(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      classId,
      title: title.trim(),
      description: description.trim() || undefined,
      file,
    });
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>افزودن نمونه سوال جدید</DialogTitle>
          <DialogDescription>
            فرم زیر را تکمیل کنید. عنوان الزامی است.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sq-title">عنوان</Label>
            <Input
              id="sq-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: نمونه سوال فصل اول"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sq-description">توضیحات (اختیاری)</Label>
            <Textarea
              id="sq-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="توضیحات بیشتر…"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sq-file">فایل پیوست (اختیاری)</Label>
            <Input
              id="sq-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="cursor-pointer"
            />
            {file ? (
              <p className="text-xs text-muted-foreground" dir="ltr">
                {file.name} ({formatPersianNumber(Math.round(file.size / 1024))} KB)
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                لغو
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "در حال ثبت…" : "ثبت"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <Inbox className="size-8 text-muted-foreground" />
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        {actionLabel && onAction ? (
          <Button variant="outline" className="mt-2" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ----------------- Phase 19: Send-to-chat dialog (teacher only) -----------------

/**
 * SendSampleQuestionToChatDialog — mirrors SendAssignmentToChatDialog but
 * for sample questions. Lets the teacher pick any of their classes/groups
 * and POSTs a linked-sample-question card message to that chat.
 *
 * The POST goes to /api/messages with `{ classId, content: title,
 * linkedSampleQuestionId }`. The chat renders the message as a bordered
 * card (FileQuestion icon + title + "مشاهده نمونه سوال" button) instead
 * of a text bubble — see class-chat.tsx MessageRow.
 */
function SendSampleQuestionToChatDialog({
  question,
  open,
  onOpenChange,
  user,
}: {
  question: SampleQuestion | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: MessengerUser;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetClassId, setTargetClassId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch the user's classes/groups list so the Select shows them. Re-use
  // the same query key the conversation list uses so the data is shared.
  const { data: classes, isLoading: classesLoading } = useQuery<ClassItem[]>({
    queryKey: ["classes", user.id],
    queryFn: () => fetchClasses(),
    enabled: open,
    staleTime: 30 * 1000,
  });

  // Reset form state when the dialog closes.
  useEffect(() => {
    if (!open) {
      setTargetClassId("");
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit() {
    if (!question || submitting) return;
    if (!targetClassId) {
      toast({
        title: "گروه/کلاس مقصد را انتخاب کنید",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await postMessage({
        classId: targetClassId,
        content: question.title,
        linkedSampleQuestionId: question.id,
      });
      await queryClient.invalidateQueries({
        queryKey: ["messages", targetClassId],
        exact: false,
      });
      toast({
        title: "به گفتگو ارسال شد",
        description: `نمونه سوال «${question.title}» در گفتگو منتشر شد.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "ارسال ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Send className="size-4" />
            </span>
            ارسال نمونه سوال به گفتگو
          </DialogTitle>
          <DialogDescription>
            یک گروه/کلاس برای ارسال کارت این نمونه سوال انتخاب کنید. پیام
            به‌صورت کارت ویژه در گفتگو نمایش داده می‌شود.
          </DialogDescription>
        </DialogHeader>
        {question ? (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <FileQuestion className="size-4 text-primary" />
              {question.title}
            </div>
            {question.createdBy?.fullName ? (
              <p className="mt-1 text-xs text-muted-foreground">
                ساخته‌شده توسط {question.createdBy.fullName}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="send-sq-to-chat-target">گروه/کلاس مقصد</Label>
          <Select
            value={targetClassId}
            onValueChange={setTargetClassId}
            disabled={classesLoading || submitting}
          >
            <SelectTrigger id="send-sq-to-chat-target" className="w-full">
              <SelectValue
                placeholder={
                  classesLoading ? "در حال بارگذاری…" : "یک گروه/کلاس انتخاب کنید"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {(classes ?? []).length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  گروه/کلاسی موجود نیست.
                </div>
              ) : (
                (classes ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.parentClassId ? " (گروه)" : ""}
                    {c.gradeLevel ? ` · ${c.gradeLevel}` : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={submitting}>
              انصراف
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !targetClassId}
            className="gap-1.5"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            ارسال به گفتگو
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
