"use client";

import { useState, FormEvent, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ThumbsUp,
  ThumbsDown,
  Plus,
  RefreshCw,
  Inbox,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { fetchClassMembers, fetchBehavior, postBehavior } from "@/lib/messenger-api";
import { useToast } from "@/hooks/use-toast";
import {
  formatPersianDate,
  formatPersianNumber,
} from "./persian";
import type { BehaviorMark, ClassMember } from "./types";

type BehaviorType = "POSITIVE" | "NEGATIVE";

/**
 * Behavior marks view for the selected class.
 *
 * - GET /api/behavior?classId= → STUDENT sees own; TEACHER/ADMIN see all
 * - Student view: two cards — positive total + negative total — plus a list
 * - Teacher view: table of all marks + "ثبت نمره رفتاری" → POST /api/teacher/behavior
 */
export function BehaviorView({
  classId,
  currentUserId,
  isTeacher,
}: {
  classId: string;
  currentUserId: string;
  isTeacher: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: members } = useQuery<ClassMember[]>({
    queryKey: ["class-members", classId],
    queryFn: () => fetchClassMembers(classId),
    enabled: isTeacher,
  });

  const {
    data: marks,
    isLoading,
    isError,
    refetch,
  } = useQuery<BehaviorMark[]>({
    queryKey: ["behavior", classId, currentUserId],
    queryFn: () => fetchBehavior(classId),
  });

  const students = useMemo(
    () => (members ?? []).filter((m) => m.role === "STUDENT"),
    [members],
  );

  const createMutation = useMutation({
    mutationFn: async (vars: {
      classId: string;
      studentId: string;
      type: BehaviorType;
      reason: string;
      value?: number;
    }) =>
      postBehavior(vars),
    onSuccess: (created) => {
      queryClient.setQueryData<BehaviorMark[]>(
        ["behavior", classId, currentUserId],
        (prev) => (prev ? [created, ...prev] : [created]),
      );
      toast({ title: "نمره رفتاری ثبت شد" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "خطا در ثبت نمره رفتاری",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {marks ? `${formatPersianNumber(marks.length)} نمره رفتاری` : "در حال بارگذاری…"}
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
              ثبت نمره رفتاری
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
              <LazySkeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : !marks || marks.length === 0 ? (
          <EmptyState
            title="نمره رفتاری یافت نشد"
            description={
              isTeacher
                ? "برای ثبت اولین نمره رفتاری، روی «ثبت نمره رفتاری» بزنید."
                : "استاد هنوز نمره رفتاری برای شما در این کلاس ثبت نکرده است."
            }
            actionLabel={isTeacher ? "ثبت نمره رفتاری" : undefined}
            onAction={isTeacher ? () => setDialogOpen(true) : undefined}
          />
        ) : isTeacher ? (
          <TeacherBehaviorTable marks={marks} />
        ) : (
          <StudentBehaviorList marks={marks} />
        )}
      </div>

      <CreateBehaviorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        classId={classId}
        students={students}
        submitting={createMutation.isPending}
        onSubmit={(vars) => createMutation.mutate(vars)}
      />
    </div>
  );
}

function StudentBehaviorList({ marks }: { marks: BehaviorMark[] }) {
  const positive = marks.filter((m) => m.type === "POSITIVE");
  const negative = marks.filter((m) => m.type === "NEGATIVE");
  const positiveSum = positive.reduce((s, m) => s + m.value, 0);
  const negativeSum = negative.reduce((s, m) => s + m.value, 0);

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
      }}
      className="space-y-3"
    >
      {/* totals */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-emerald-500/5 border-emerald-500/30">
          <CardContent className="flex items-center gap-3 py-3">
            <span className="bg-emerald-500/15 text-emerald-600 flex size-10 items-center justify-center rounded-full">
              <TrendingUp className="size-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">مجموع نمرات مثبت</p>
              <p className="text-xl font-bold text-emerald-600">
                +{formatPersianNumber(positiveSum)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-rose-500/5 border-rose-500/30">
          <CardContent className="flex items-center gap-3 py-3">
            <span className="bg-rose-500/15 text-rose-600 flex size-10 items-center justify-center rounded-full">
              <TrendingDown className="size-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">مجموع نمرات منفی</p>
              <p className="text-xl font-bold text-rose-600">
                {formatPersianNumber(negativeSum)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* list */}
      {marks.map((m) => {
        const positive = m.type === "POSITIVE";
        return (
          <motion.div
            key={m.id}
            variants={{
              hidden: { opacity: 0, y: 8 },
              visible: { opacity: 1, y: 0 },
            }}
          >
            <Card
              className={
                positive
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-rose-500/30 bg-rose-500/5"
              }
            >
              <CardContent className="flex items-start gap-3 py-3">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                    positive
                      ? "bg-emerald-500/15 text-emerald-600"
                      : "bg-rose-500/15 text-rose-600"
                  }`}
                >
                  {positive ? (
                    <ThumbsUp className="size-4" />
                  ) : (
                    <ThumbsDown className="size-4" />
                  )}
                </span>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium leading-snug">{m.reason}</p>
                    <Badge
                      variant="secondary"
                      className={
                        positive
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                      }
                    >
                      {positive ? "+" : ""}
                      {formatPersianNumber(m.value)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatPersianDate(m.createdAt)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

function TeacherBehaviorTable({ marks }: { marks: BehaviorMark[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>دانش‌آموز</TableHead>
              <TableHead>نوع</TableHead>
              <TableHead>دلیل</TableHead>
              <TableHead>مقدار</TableHead>
              <TableHead>تاریخ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {marks.map((m) => {
              const positive = m.type === "POSITIVE";
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.student.fullName}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        positive
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                      }
                    >
                      {positive ? (
                        <>
                          <ThumbsUp className="size-3" />
                          مثبت
                        </>
                      ) : (
                        <>
                          <ThumbsDown className="size-3" />
                          منفی
                        </>
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{m.reason}</TableCell>
                  <TableCell className="font-mono">
                    {positive ? "+" : ""}
                    {formatPersianNumber(m.value)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatPersianDate(m.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CreateBehaviorDialog({
  open,
  onOpenChange,
  classId,
  students,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  students: ClassMember[];
  submitting: boolean;
  onSubmit: (vars: {
    classId: string;
    studentId: string;
    type: BehaviorType;
    reason: string;
    value?: number;
  }) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [type, setType] = useState<BehaviorType>("POSITIVE");
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("1");

  function reset() {
    setStudentId("");
    setType("POSITIVE");
    setReason("");
    setValue("1");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const v = Number(value);
    if (!studentId || !reason.trim() || Number.isNaN(v) || !Number.isInteger(v)) {
      return;
    }
    onSubmit({
      classId,
      studentId,
      type,
      reason: reason.trim(),
      value: v,
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
          <DialogTitle>ثبت نمره رفتاری</DialogTitle>
          <DialogDescription>
            دانش‌آموز، نوع، دلیل و مقدار نمره رفتاری را وارد کنید.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="behavior-student">دانش‌آموز</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger id="behavior-student" className="w-full">
                <SelectValue placeholder="انتخاب دانش‌آموز…" />
              </SelectTrigger>
              <SelectContent>
                {students.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    دانش‌آموزی موجود نیست
                  </SelectItem>
                ) : (
                  students.map((s) => (
                    <SelectItem key={s.id} value={s.userId}>
                      {s.fullName} ({s.username})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>نوع نمره</Label>
            <ToggleGroup
              type="single"
              value={type}
              onValueChange={(v) => {
                if (v === "POSITIVE" || v === "NEGATIVE") {
                  setType(v);
                  setValue(v === "POSITIVE" ? "1" : "-1");
                }
              }}
              className="grid grid-cols-2 gap-2"
            >
              <ToggleGroupItem
                value="POSITIVE"
                variant="outline"
                className="data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300 data-[state=on]:border-emerald-500/40"
              >
                <ThumbsUp className="size-4" />
                مثبت
              </ToggleGroupItem>
              <ToggleGroupItem
                value="NEGATIVE"
                variant="outline"
                className="data-[state=on]:bg-rose-500/15 data-[state=on]:text-rose-700 dark:data-[state=on]:text-rose-300 data-[state=on]:border-rose-500/40"
              >
                <ThumbsDown className="size-4" />
                منفی
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="behavior-reason">دلیل</Label>
            <Textarea
              id="behavior-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: شرکت فعال در کلاس"
              rows={2}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="behavior-value">مقدار</Label>
            <Input
              id="behavior-value"
              type="number"
              step="1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              dir="ltr"
              className="text-left"
              required
            />
            <p className="text-xs text-muted-foreground">
              علامت مقدار به‌طور خودکار بر اساس نوع نمره اعمال می‌شود.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                لغو
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={
                submitting ||
                !studentId ||
                !reason.trim() ||
                Number.isNaN(Number(value))
              }
            >
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
