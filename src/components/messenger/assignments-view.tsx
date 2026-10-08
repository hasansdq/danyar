"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BookOpen,
  Calendar,
  Check,
  ClipboardList,
  Download,
  FileText,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";
import {
  fetchAssignmentStudents,
  fetchAssignments,
  fetchClasses,
  postAssignment,
  postMessage,
  setAssignmentStatus,
} from "@/lib/messenger-api";
import { useToast } from "@/hooks/use-toast";
import {
  formatPersianCountdown,
  formatPersianDate,
  formatPersianNumber,
} from "./persian";
import {
  StatusBadge,
  StatusIcon,
  StatusSelector,
  statusCardColor,
  statusLabel,
} from "./assignment-status";
import { JalaliDateTimePicker } from "./jalali-date-time-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Assignment,
  AssignmentStatus,
  AssignmentStudent,
  ClassItem,
  MessengerUser,
} from "./types";

/**
 * Assignments view (phase-4 redesign). Rendered in a side Sheet by the
 * messenger app for both teachers and students of the selected class.
 *
 * - Header: title + (teacher) "افزودن تکلیف" + reload.
 * - Single-column rectangular cards.
 * - Teacher: cards show title, due date + countdown/overdue badge,
 *   class+section, file download, submission summary, creator + creation
 *   date. Click → student-list dialog with a per-student StatusSelector.
 * - Student: cards are tinted by `myStatus` (white/green/yellow/red). Each
 *   shows course name, title, due date, StatusBadge, file download. NOT
 *   clickable.
 *
 * Backend contract (Task 3 rebuild):
 *   - GET /api/assignments?classId= → { data: Assignment[] }, each with
 *     `class`, `myStatus` (for students), `submissionCounts` (for teachers).
 *   - POST /api/teacher/assignments (multipart) → create.
 *   - GET /api/assignments/[id]/students → { data: AssignmentStudent[] }.
 *   - POST /api/teacher/assignments/[id]/status { studentId, status, note? }.
 */
export function AssignmentsView({
  classId,
  isTeacher,
  user,
}: {
  classId: string;
  isTeacher: boolean;
  /**
   * Phase 19 — the calling user. Used to fetch the user's classes list for
   * the "ارسال به گفتگو" (forward-to-chat) dialog so the teacher can pick
   * which group/class to post the linked-assignment card message into.
   */
  user: MessengerUser;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [studentsFor, setStudentsFor] = useState<Assignment | null>(null);
  // Phase 19 — the assignment the teacher is currently picking a target
  // chat for (forward-to-chat flow). When set, the SendToChat dialog is open.
  const [sendToChatFor, setSendToChatFor] = useState<Assignment | null>(null);

  const {
    data: assignments,
    isLoading,
    isError,
    refetch,
  } = useQuery<Assignment[]>({
    queryKey: ["assignments", classId],
    queryFn: () => fetchAssignments(classId),
  });

  const createMutation = useMutation({
    mutationFn: async (vars: {
      classIds: string[];
      title: string;
      description?: string;
      dueDate?: string;
      file?: File | null;
    }) => {
      const fd = new FormData();
      // Phase 29 — append each selected classId separately so the
      // backend creates one Assignment per class (same title/desc/
      // dueDate/file metadata).
      for (const cid of vars.classIds) fd.append("classId", cid);
      fd.append("title", vars.title);
      if (vars.description) fd.append("description", vars.description);
      if (vars.dueDate) fd.append("dueDate", vars.dueDate);
      if (vars.file) fd.append("file", vars.file);
      return postAssignment(fd);
    },
    onSuccess: (created, vars) => {
      // Backend returns Assignment[] (one per selected class). Update
      // the cache for every selected class so the teacher's already-open
      // assignment lists reflect the new rows immediately (no need to
      // refetch — we have the full Assignment shape from the response).
      for (const a of created) {
        queryClient.setQueryData<Assignment[]>(
          ["assignments", a.classId],
          (prev) => (prev ? [a, ...prev] : [a]),
        );
      }
      // Also invalidate every other "assignments" query (in case the
      // user has the same class open in another tab, etc.).
      void queryClient.invalidateQueries({
        queryKey: ["assignments"],
        exact: false,
      });
      toast({
        title: "تکلیف ثبت شد",
        description:
          created.length === 1
            ? created[0].title
            : `${created[0].title} · برای ${vars.classIds.length} کلاس`,
      });
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "خطا در ثبت تکلیف",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">تکالیف</h2>
          <span className="text-xs text-muted-foreground">
            {assignments
              ? `${formatPersianNumber(assignments.length)} مورد`
              : "در حال بارگذاری…"}
          </span>
        </div>
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
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              افزودن تکلیف
            </Button>
          ) : null}
        </div>
      </div>

      {/* List */}
      <div className="scrollbar-rtl flex-1 overflow-y-auto p-3">
        {isError ? (
          <EmptyState
            title="بارگذاری ناموفق بود"
            description="لطفاً مجدداً تلاش کنید."
            actionLabel="بارگذاری مجدد"
            onAction={() => void refetch()}
          />
        ) : isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <LazySkeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : !assignments || assignments.length === 0 ? (
          <EmptyState
            title="هیچ تکلیفی ثبت نشده است"
            description={
              isTeacher
                ? "برای ساخت اولین تکلیف این کلاس، روی «افزودن تکلیف» بزنید."
                : "استاد هنوز تکلیفی برای این کلاس ثبت نکرده است."
            }
            actionLabel={isTeacher ? "افزودن تکلیف" : undefined}
            onAction={isTeacher ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
            }}
            className="space-y-1.5"
          >
            {assignments.map((a) =>
              isTeacher ? (
                <TeacherAssignmentCard
                  key={a.id}
                  assignment={a}
                  onOpenStudents={() => setStudentsFor(a)}
                  onSendToChat={() => setSendToChatFor(a)}
                />
              ) : (
                <StudentAssignmentCard key={a.id} assignment={a} />
              ),
            )}
          </motion.div>
        )}
      </div>

      {/* Create dialog (teacher only). Phase 29 — pass the current
          classId so the multi-select defaults to it; pass `user` so the
          dialog can fetch the teacher's class list. */}
      <CreateAssignmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        submitting={createMutation.isPending}
        currentClassId={classId}
        onSubmit={(vars) => createMutation.mutate(vars)}
      />

      {/* Students-status dialog (teacher only) */}
      <AssignmentStudentsDialog
        assignment={studentsFor}
        classId={classId}
        open={!!studentsFor}
        onOpenChange={(v) => {
          if (!v) setStudentsFor(null);
        }}
      />

      {/* Phase 19 — send-to-chat dialog (teacher only). Lets the teacher
          forward the assignment to any of their classes' chats as a special
          "linked-assignment card" message (POST /api/messages with
          linkedAssignmentId). */}
      <SendAssignmentToChatDialog
        assignment={sendToChatFor}
        open={!!sendToChatFor}
        onOpenChange={(v) => {
          if (!v) setSendToChatFor(null);
        }}
        user={user}
      />
    </div>
  );
}

// ----------------- Teacher card -----------------

function TeacherAssignmentCard({
  assignment,
  onOpenStudents,
  onSendToChat,
}: {
  assignment: Assignment;
  onOpenStudents: () => void;
  /**
   * Phase 19 — opens the "ارسال به گفتگو" dialog (forward-to-chat). The
   * button stops propagation so it doesn't trigger the card's main click
   * handler (which opens the student-status dialog).
   */
  onSendToChat: () => void;
}) {
  const due = assignment.dueDate
    ? formatPersianCountdown(assignment.dueDate)
    : null;
  const counts = assignment.submissionCounts;
  const doneCount = counts ? counts.DONE : 0;
  const total = counts
    ? counts.UNCHECKED + counts.DONE + counts.INCOMPLETE + counts.NOT_DONE
    : 0;
  const classLabel = assignment.class
    ? `${assignment.class.name}${
        assignment.class.section ? ` · شعبه ${assignment.class.section}` : ""
      }`
    : null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenStudents();
    }
  }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0 },
      }}
    >
      <Card
        role="button"
        tabIndex={0}
        onClick={onOpenStudents}
        onKeyDown={handleKeyDown}
        className="cursor-pointer overflow-hidden transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <CardHeader className="gap-2 pb-1.5">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <span className="bg-emerald-500/10 text-emerald-600 flex size-6 shrink-0 items-center justify-center rounded-md">
              <BookOpen className="size-3.5" />
            </span>
            <span className="leading-tight truncate">{assignment.title}</span>
          </CardTitle>
          <CardAction>
            {due ? (
              <Badge
                variant={due.overdue ? "destructive" : "secondary"}
                className={
                  due.overdue
                    ? ""
                    : due.soon
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : ""
                }
              >
                <Calendar className="size-3" />
                {due.text}
              </Badge>
            ) : null}
          </CardAction>
          {classLabel ? (
            <CardDescription className="text-[10px]">{classLabel}</CardDescription>
          ) : null}
          <CardDescription className="text-[10px]">
            ساخته‌شده توسط {assignment.createdBy.fullName} ·{" "}
            {formatPersianDate(assignment.createdAt)}
          </CardDescription>
        </CardHeader>
        {assignment.description ? (
          <CardContent className="pb-1.5">
            <p className="whitespace-pre-wrap break-words text-xs leading-snug">
              {assignment.description}
            </p>
          </CardContent>
        ) : null}
        {(assignment.fileUrl || assignment.dueDate) && (
          <>
            <Separator />
            <CardContent className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[10px]">
              {assignment.dueDate ? (
                <span className="text-muted-foreground">
                  مهلت تحویل: {formatPersianDate(assignment.dueDate)}
                </span>
              ) : (
                <span className="text-muted-foreground">بدون مهلت تحویل</span>
              )}
              {assignment.fileUrl ? (
                <a
                  href={assignment.fileUrl}
                  download={assignment.fileName || undefined}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Download className="size-3.5" />
                  دانلود فایل
                  {assignment.fileSize ? (
                    <span className="text-muted-foreground">
                      (
                      {formatPersianNumber(
                        Math.round(assignment.fileSize / 1024),
                      )}{" "}
                      کیلوبایت)
                    </span>
                  ) : null}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <FileText className="size-3.5" />
                  بدون فایل پیوست
                </span>
              )}
            </CardContent>
          </>
        )}
        <Separator />
        <CardFooter className="flex items-center justify-between gap-2 py-1.5 text-[10px]">
          {counts ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <ClipboardList className="size-3.5" />
              انجام‌شده: {formatPersianNumber(doneCount)} /{" "}
              {formatPersianNumber(total)}
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[11px]"
              // Stop propagation so the card's main onClick (open student
              // status dialog) doesn't fire — we want THIS button's handler.
              onClick={(e) => {
                e.stopPropagation();
                onSendToChat();
              }}
              aria-label="ارسال به گفتگو"
              title="ارسال به گفتگو"
            >
              <Send className="size-3.5" />
              ارسال به گفتگو
            </Button>
            <span className="inline-flex items-center gap-1 font-medium text-primary">
              <Users className="size-3.5" />
              مشاهده وضعیت دانش‌آموزان
            </span>
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

// ----------------- Student card -----------------

function StudentAssignmentCard({ assignment }: { assignment: Assignment }) {
  const status: AssignmentStatus = assignment.myStatus ?? "UNCHECKED";
  const due = assignment.dueDate ? formatPersianCountdown(assignment.dueDate) : null;
  const classLabel = assignment.class?.name ?? null;

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0 },
      }}
    >
      <Card className={statusCardColor(status)}>
        <CardHeader className="pb-1.5">
          <CardTitle className="flex items-start gap-1.5 text-sm">
            <StatusIcon status={status} className="mt-0.5 size-5" />
            <span className="leading-tight">{assignment.title}</span>
          </CardTitle>
          <CardAction>
            {due ? (
              <Badge
                variant={due.overdue ? "destructive" : "secondary"}
                className={
                  due.overdue
                    ? ""
                    : due.soon
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : ""
                }
              >
                <Calendar className="size-3" />
                {due.text}
              </Badge>
            ) : null}
          </CardAction>
          {classLabel ? (
            <CardDescription className="text-xs">
              نام درس: {classLabel}
            </CardDescription>
          ) : null}
          <CardDescription className="text-xs">
            مهلت تحویل:{" "}
            {assignment.dueDate ? formatPersianDate(assignment.dueDate) : "—"}
          </CardDescription>
        </CardHeader>
        {assignment.description ? (
          <CardContent className="pb-1.5">
            <p className="whitespace-pre-wrap break-words text-xs leading-snug">
              {assignment.description}
            </p>
          </CardContent>
        ) : null}
        {(assignment.fileUrl || status) && (
          <>
            <Separator />
            <CardContent className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[10px]">
              <StatusBadge status={status} />
              {assignment.fileUrl ? (
                <a
                  href={assignment.fileUrl}
                  download={assignment.fileName || undefined}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Download className="size-3.5" />
                  دانلود فایل
                </a>
              ) : null}
            </CardContent>
          </>
        )}
      </Card>
    </motion.div>
  );
}

// ----------------- Create dialog -----------------

/**
 * CreateAssignmentDialog — Phase 29 rewrite.
 *
 * New fields (in order):
 *   1. کلاس‌ها (multi-select, REQUIRED) — toggle-chip list of the
 *      teacher's classes. Defaults to the parent's `currentClassId`
 *      being selected. When the teacher opens the dialog from class A,
 *      class A is pre-selected so they can quickly post to just it; or
 *      they can toggle more classes for cross-class assignment posting.
 *   2. عنوان تکلیف (required).
 *   3. مهلت تحویل — JalaliDateTimePicker (replaces the old datetime-local).
 *   4. فایل تکلیف (optional).
 *   5. توضیحات (optional).
 *
 * Submitting calls `onSubmit({ classIds, title, description, dueDate,
 * file })`. The parent's createMutation handles the actual POST + cache
 * invalidation.
 */
function CreateAssignmentDialog({
  open,
  onOpenChange,
  submitting,
  currentClassId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  /**
   * The class the assignments-view is currently showing. Used as the
   * default-selected class in the multi-select list. Can be empty when
   * the user opens the dialog without a current class context.
   */
  currentClassId: string;
  onSubmit: (vars: {
    classIds: string[];
    title: string;
    description?: string;
    dueDate?: string;
    file?: File | null;
  }) => void;
}) {
  const { toast } = useToast();
  // Fetch the teacher's classes (re-uses the existing /api/classes
  // query so the data is shared with the conversation list / send-to-
  // chat dialog).
  const { data: classes, isLoading: classesLoading } = useQuery<ClassItem[]>({
    queryKey: ["classes"],
    queryFn: () => fetchClasses(),
    enabled: open,
    staleTime: 30 * 1000,
  });

  const [classIds, setClassIds] = useState<Set<string>>(
    () => new Set(currentClassId ? [currentClassId] : []),
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  // Reset state when the dialog closes (and re-sync the default-selected
  // class when it opens, in case the user changed which class they're
  // looking at). Five setState calls in a row are intentional — we want
  // the whole form to reset together on (open, currentClassId) change.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setClassIds(new Set(currentClassId ? [currentClassId] : []));
    setTitle("");
    setDescription("");
    setDueDate(null);
    setFile(null);
  }, [open, currentClassId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggleClass(id: string) {
    setClassIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (classIds.size === 0) {
      toast({
        title: "کلاس انتخاب نشده",
        description: "حداقل یک کلاس برای ثبت تکلیف انتخاب کنید.",
        variant: "destructive",
      });
      return;
    }
    onSubmit({
      classIds: Array.from(classIds),
      title: title.trim(),
      description: description.trim() || undefined,
      dueDate: dueDate ?? undefined,
      file,
    });
    // Don't reset here — the parent's onSuccess closes the dialog +
    // the useEffect above re-syncs state on next open.
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          // Don't reset here either — the open-effect handles it next time.
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>افزودن تکلیف جدید</DialogTitle>
          <DialogDescription>
            فرم زیر را تکمیل کنید. عنوان و کلاس‌ها الزامی است.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Phase 29 — multi-select classes (REQUIRED). */}
          <div className="space-y-2">
            <Label>
              کلاس‌ها <span className="text-destructive">*</span>
            </Label>
            {classesLoading ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                در حال بارگذاری کلاس‌ها…
              </div>
            ) : !classes || classes.length === 0 ? (
              <div className="rounded-md border bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                کلاسی برای شما ثبت نشده است.
              </div>
            ) : (
              <div className="scrollbar-rtl flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-md border bg-muted/20 p-2">
                {classes.map((c) => {
                  const selected = classIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleClass(c.id)}
                      aria-pressed={selected}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {selected ? (
                        <Check className="size-3" />
                      ) : null}
                      {c.name}
                      {c.section ? ` · شعبه ${c.section}` : ""}
                    </button>
                  );
                })}
              </div>
            )}
            {classIds.size > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {formatPersianNumber(classIds.size)} کلاس انتخاب شده.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignment-title">
              عنوان تکلیف <span className="text-destructive">*</span>
            </Label>
            <Input
              id="assignment-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: تمرین فصل اول"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignment-due">مهلت تحویل</Label>
            <JalaliDateTimePicker
              id="assignment-due"
              value={dueDate}
              onChange={setDueDate}
              placeholder="انتخاب تاریخ و ساعت (اختیاری)"
              ariaLabel="مهلت تحویل"
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignment-file">فایل تکلیف</Label>
            <Input
              id="assignment-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="cursor-pointer"
            />
            {file ? (
              <p className="text-xs text-muted-foreground" dir="ltr">
                {file.name} (
                {formatPersianNumber(Math.round(file.size / 1024))} KB)
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignment-description">توضیحات (اختیاری)</Label>
            <Textarea
              id="assignment-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="توضیحات بیشتر در مورد تکلیف…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                لغو
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={submitting || !title.trim() || classIds.size === 0}
            >
              {submitting ? "در حال ثبت…" : "ثبت"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------- Students-status dialog -----------------

function AssignmentStudentsDialog({
  assignment,
  classId,
  open,
  onOpenChange,
}: {
  assignment: Assignment | null;
  classId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Stable query key per-assignment. When `assignment` is null (dialog
  // closed) we use a sentinel key so we don't pollute real cache entries.
  const queryKey = useMemo(
    () =>
      assignment
        ? ["assignment-students", assignment.id]
        : ["assignment-students", "__none__"],
    [assignment],
  );

  const {
    data: students,
    isLoading,
    isError,
    refetch,
  } = useQuery<AssignmentStudent[]>({
    queryKey,
    queryFn: () => fetchAssignmentStudents(assignment!.id),
    enabled: !!assignment && open,
  });

  const statusMutation = useMutation({
    mutationFn: (vars: {
      studentId: string;
      status: AssignmentStatus;
      note?: string;
    }) => {
      if (!assignment) throw new Error("تکلیفی انتخاب نشده است");
      return setAssignmentStatus(assignment.id, vars);
    },
    onMutate: async (vars) => {
      if (!assignment) return {};
      const studentsKey = ["assignment-students", assignment.id];
      const assignmentsKey = ["assignments", classId];

      await queryClient.cancelQueries({ queryKey: studentsKey });
      await queryClient.cancelQueries({ queryKey: assignmentsKey });

      const prevStudents = queryClient.getQueryData<AssignmentStudent[]>(
        studentsKey,
      );
      const prevAssignments = queryClient.getQueryData<Assignment[]>(
        assignmentsKey,
      );

      // Optimistic 1: update the student's status row in the dialog.
      if (prevStudents) {
        const next = prevStudents.map((s) =>
          s.id === vars.studentId
            ? {
                ...s,
                status: vars.status,
                updatedAt: new Date().toISOString(),
              }
            : s,
        );
        queryClient.setQueryData(studentsKey, next);
      }

      // Optimistic 2: bump submissionCounts on the teacher's assignment
      // card so the "انجام‌شده: X / Y" tally stays in sync instantly.
      if (prevAssignments) {
        const next = prevAssignments.map((a) => {
          if (a.id !== assignment.id || !a.submissionCounts) return a;
          const oldStatus = prevStudents?.find(
            (s) => s.id === vars.studentId,
          )?.status;
          const counts = { ...a.submissionCounts };
          if (oldStatus && oldStatus !== vars.status && counts[oldStatus] > 0) {
            counts[oldStatus] -= 1;
          }
          if (oldStatus !== vars.status) {
            counts[vars.status] = (counts[vars.status] ?? 0) + 1;
          }
          return { ...a, submissionCounts: counts };
        });
        queryClient.setQueryData(assignmentsKey, next);
      }

      return { prevStudents, prevAssignments };
    },
    onError: (err: Error, _vars, ctx) => {
      if (!assignment) return;
      if (ctx?.prevStudents) {
        queryClient.setQueryData(
          ["assignment-students", assignment.id],
          ctx.prevStudents,
        );
      }
      if (ctx?.prevAssignments) {
        queryClient.setQueryData(
          ["assignments", classId],
          ctx.prevAssignments,
        );
      }
      toast({
        title: "خطا در ثبت وضعیت",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      if (!assignment) return;
      void queryClient.invalidateQueries({
        queryKey: ["assignment-students", assignment.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["assignments", classId],
      });
    },
    onSuccess: (_data, vars) => {
      toast({
        title: "وضعیت ثبت شد",
        description: statusLabel(vars.status),
      });
    },
  });

  function handleChange(studentId: string, next: AssignmentStatus) {
    statusMutation.mutate({ studentId, status: next });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            وضعیت تکلیف{assignment ? `: ${assignment.title}` : ""}
          </DialogTitle>
          <DialogDescription>
            برای هر دانش‌آموز یکی از چهار وضعیت را انتخاب کنید.
          </DialogDescription>
        </DialogHeader>
        {isError ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            بارگذاری ناموفق بود.
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => void refetch()}
            >
              تلاش مجدد
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <LazySkeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !students || students.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            هنوز دانش‌آموزی در این کلاس ثبت‌نام نشده است.
          </div>
        ) : (
          <div className="scrollbar-rtl max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>دانش‌آموز</TableHead>
                  <TableHead>وضعیت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="align-top">
                      <div className="flex flex-col">
                        <span className="font-medium">{s.fullName}</span>
                        <span
                          className="text-xs text-muted-foreground"
                          dir="ltr"
                        >
                          {s.username}
                        </span>
                        {s.updatedAt ? (
                          <span className="text-[10px] text-muted-foreground">
                            آخرین تغییر: {formatPersianDate(s.updatedAt)}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusSelector
                        value={s.status}
                        onChange={(next) => handleChange(s.id, next)}
                        disabled={
                          statusMutation.isPending &&
                          statusMutation.variables?.studentId === s.id
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              بستن
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------- Empty state -----------------

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
 * SendAssignmentToChatDialog — opens when the teacher taps the "ارسال به
 * گفتگو" button on a TeacherAssignmentCard. Lets the teacher pick ANY of
 * their classes/groups (top-level classes + sub-groups) from a Select
 * dropdown and POSTs a linked-assignment card message to that chat.
 *
 * The POST goes to /api/messages with `{ classId, content: title,
 * linkedAssignmentId }`. The chat renders the message as a bordered card
 * (assignment icon + title + due date + "مشاهده تکلیف" button) instead of
 * a text bubble — see class-chat.tsx MessageRow.
 *
 * NOTE: the backend persists the linkedAssignmentId even if the linked
 * assignment is in a DIFFERENT class than the target chat (so a teacher
 * can forward an assignment from class A to class B's chat). The displayed
 * card only carries the assignment's title + due date (no sensitive data);
 * access to the target chat is already enforced by the messages POST
 * route (membership / principal / superadmin).
 */
function SendAssignmentToChatDialog({
  assignment,
  open,
  onOpenChange,
  user,
}: {
  assignment: Assignment | null;
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
    if (!assignment || submitting) return;
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
        // The assignment title is stored as the message `content` so the
        // chat list preview (and any notification) shows something
        // meaningful — the chat card itself shows the linked metadata.
        content: assignment.title,
        linkedAssignmentId: assignment.id,
      });
      // Invalidate the messages query so the chat refetches on next visit
      // and the new linked-card message appears.
      await queryClient.invalidateQueries({
        queryKey: ["messages", targetClassId],
        exact: false,
      });
      toast({
        title: "به گفتگو ارسال شد",
        description: `تکلیف «${assignment.title}» در گفتگو منتشر شد.`,
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
            ارسال تکلیف به گفتگو
          </DialogTitle>
          <DialogDescription>
            یک گروه/کلاس برای ارسال کارت این تکلیف انتخاب کنید. پیام به‌صورت
            کارت ویژه در گفتگو نمایش داده می‌شود.
          </DialogDescription>
        </DialogHeader>
        {assignment ? (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <BookOpen className="size-4 text-primary" />
              {assignment.title}
            </div>
            {assignment.dueDate ? (
              <p className="mt-1 text-xs text-muted-foreground">
                مهلت تحویل: {formatPersianDate(assignment.dueDate)}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="send-to-chat-target">گروه/کلاس مقصد</Label>
          <Select
            value={targetClassId}
            onValueChange={setTargetClassId}
            disabled={classesLoading || submitting}
          >
            <SelectTrigger id="send-to-chat-target" className="w-full">
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
