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
import { Badge } from "@/components/ui/badge";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart3,
  Save,
  RefreshCw,
  Inbox,
  ClipboardList,
  Users,
} from "lucide-react";
import {
  fetchClassStudents,
  fetchGrades,
  bulkCreateGrades,
} from "@/lib/messenger-api";
import { useToast } from "@/hooks/use-toast";
import {
  formatPersianDate,
  formatPersianNumber,
} from "./persian";
import type { ClassStudent, Grade } from "./types";

/**
 * Grades view for the selected class.
 *
 * - GET /api/grades?classId= → STUDENT sees own; TEACHER/ADMIN see all
 * - Student view: list of the student's own grades (cards with progress).
 * - Teacher view: a bulk-create UI — one textbox for the exam name, one
 *   max-score input, and one number input per student in the class. Submit
 *   calls POST /api/teacher/grades/bulk to create one Grade per student in
 *   a single transaction. Below the form, the most recent grades already
 *   entered for the class are shown for context.
 */
export function GradesView({
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

  // Fetch class's STUDENT members (teacher view only).
  const {
    data: students,
    isLoading: studentsLoading,
    isError: studentsError,
    refetch: refetchStudents,
  } = useQuery<ClassStudent[]>({
    queryKey: ["class-students", classId],
    queryFn: () => fetchClassStudents(classId),
    enabled: isTeacher,
  });

  // Fetch existing grades (both views). For students this returns only
  // their own grades; for teachers/admins this returns all grades in the
  // class — used both as context and to invalidate after a bulk submit.
  const {
    data: grades,
    isLoading: gradesLoading,
    isError: gradesError,
    refetch: refetchGrades,
  } = useQuery<Grade[]>({
    queryKey: ["grades", classId, currentUserId],
    queryFn: () => fetchGrades(classId),
  });

  function handleRefetch() {
    void refetchGrades();
    if (isTeacher) void refetchStudents();
  }

  // --- teacher bulk-create state ---
  const [examTitle, setExamTitle] = useState("");
  const [maxScore, setMaxScore] = useState("20");
  // gradeInputs: studentId → raw string from the number input. Empty string
  // means "no grade for this student" (skip on submit).
  const [gradeInputs, setGradeInputs] = useState<Record<string, string>>({});

  // Reset teacher-form state whenever the class changes — otherwise stale
  // inputs from the previous class would persist when the user switches.
  // Pattern from React 19's "You Might Not Need an Effect" doc: store the
  // previous prop in state, and reset state during render (this is the
  // officially supported alternative to setState-in-useEffect).
  const [prevClassId, setPrevClassId] = useState(classId);
  if (classId !== prevClassId) {
    setPrevClassId(classId);
    setExamTitle("");
    setMaxScore("20");
    setGradeInputs({});
  }

  // Derived: numeric maxScore (NaN if invalid).
  const maxScoreNum = Number(maxScore);
  const maxScoreValid = Number.isFinite(maxScoreNum) && maxScoreNum > 0;

  // Validate each per-student input. A row is "valid" if it's either empty
  // (skip) or a number in [0, maxScore].
  const validationByStudent = useMemo(() => {
    const map: Record<string, { ok: boolean; reason?: string; value?: number }> = {};
    if (!students) return map;
    for (const s of students) {
      const raw = (gradeInputs[s.id] ?? "").trim();
      if (raw === "") {
        map[s.id] = { ok: true };
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        map[s.id] = { ok: false, reason: "نمره باید عدد باشد" };
        continue;
      }
      if (n < 0) {
        map[s.id] = { ok: false, reason: "نمره نمی‌تواند منفی باشد", value: n };
        continue;
      }
      if (maxScoreValid && n > maxScoreNum) {
        map[s.id] = {
          ok: false,
          reason: `بیشتر از بارم (${formatPersianNumber(maxScoreNum)})`,
          value: n,
        };
        continue;
      }
      map[s.id] = { ok: true, value: n };
    }
    return map;
  }, [students, gradeInputs, maxScoreNum, maxScoreValid]);

  const validGrades = useMemo(() => {
    if (!students) return [];
    const out: Array<{ studentId: string; score: number }> = [];
    for (const s of students) {
      const v = validationByStudent[s.id];
      if (v && v.value !== undefined) {
        out.push({ studentId: s.id, score: v.value });
      }
    }
    return out;
  }, [students, validationByStudent]);

  const hasAnyInput = validGrades.length > 0;
  const hasInvalid = students
    ? students.some((s) => validationByStudent[s.id]?.ok === false)
    : false;

  const canSubmit =
    isTeacher &&
    examTitle.trim().length > 0 &&
    maxScoreValid &&
    hasAnyInput &&
    !hasInvalid;

  // --- mutation ---
  const bulkMutation = useMutation({
    mutationFn: async () => {
      if (!maxScoreValid) throw new Error("بارم نمره نامعتبر است");
      return bulkCreateGrades({
        classId,
        examTitle: examTitle.trim(),
        maxScore: maxScoreNum,
        grades: validGrades.map((g) => ({
          studentId: g.studentId,
          score: g.score,
        })),
      });
    },
    onSuccess: (data) => {
      // Invalidate the grades query so the recent-grades section refreshes.
      void queryClient.invalidateQueries({
        queryKey: ["grades", classId, currentUserId],
      });
      toast({
        title: "نمرات با موفقیت ثبت شدند",
        description: `${formatPersianNumber(data.count)} نمره برای آزمون «${examTitle.trim()}» ثبت شد.`,
      });
      // Reset inputs but keep the exam title so the teacher can submit
      // another batch with the same exam name (rare but possible).
      setGradeInputs({});
    },
    onError: (err: Error) => {
      toast({
        title: "خطا در ثبت نمرات",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    bulkMutation.mutate();
  }

  return (
    <div className="flex h-full flex-col">
      {/* ---------- TOOLBAR ---------- */}
      <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {grades
            ? `${formatPersianNumber(grades.length)} نمره`
            : "در حال بارگذاری…"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="بارگذاری مجدد"
          onClick={handleRefetch}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {/* ---------- CONTENT ---------- */}
      <div className="scrollbar-rtl flex-1 overflow-y-auto p-3">
        {gradesError ? (
          <EmptyState
            title="بارگذاری ناموفق بود"
            description="لطفاً مجدداً تلاش کنید."
            actionLabel="بارگذاری مجدد"
            onAction={() => void refetchGrades()}
          />
        ) : gradesLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <LazySkeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : !isTeacher ? (
          /* --- Student view --- */
          !grades || grades.length === 0 ? (
            <EmptyState
              title="هنوز نمره‌ای برای شما ثبت نشده است"
              description="استاد هنوز در این کلاس برای شما نمره‌ای ثبت نکرده است."
            />
          ) : (
            <StudentGradesList grades={grades} />
          )
        ) : studentsError ? (
          <EmptyState
            title="بارگذاری دانش‌آموزان ناموفق بود"
            description="لطفاً مجدداً تلاش کنید."
            actionLabel="بارگذاری مجدد"
            onAction={() => void refetchStudents()}
          />
        ) : studentsLoading ? (
          <div className="space-y-3">
            <LazySkeleton className="h-24 w-full" />
            <LazySkeleton className="h-40 w-full" />
            <LazySkeleton className="h-32 w-full" />
          </div>
        ) : !students || students.length === 0 ? (
          <EmptyState
            title="هنوز دانش‌آموزی در این کلاس ثبت‌نام نشده است"
            description="از پنل مدیریت، دانش‌آموزان را اضافه کنید."
          />
        ) : (
          /* --- Teacher view: bulk-create form + recent grades --- */
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
            }}
            className="space-y-4"
          >
            {/* Bulk-create form card */}
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0 },
              }}
            >
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                      <ClipboardList className="size-4" />
                    </span>
                    ثبت نمرات
                  </CardTitle>
                  <CardDescription className="text-xs">
                    نام آزمون را وارد کنید، سپس برای هر دانش‌آموز یک نمره
                    وارد کنید. ردیف‌های خالی نادیده گرفته می‌شوند.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Exam name + max score */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                      <div className="space-y-1.5">
                        <Label htmlFor="exam-title">آزمون</Label>
                        <Input
                          id="exam-title"
                          value={examTitle}
                          onChange={(e) => setExamTitle(e.target.value)}
                          placeholder="مثال: آزمون فصل اول"
                          required
                          autoFocus
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="exam-max">نمره از</Label>
                        <Input
                          id="exam-max"
                          type="number"
                          step="0.25"
                          min="0.25"
                          value={maxScore}
                          onChange={(e) => setMaxScore(e.target.value)}
                          dir="ltr"
                          className="text-left"
                          required
                          inputMode="decimal"
                        />
                      </div>
                    </div>

                    {/* Students table */}
                    <div className="rounded-lg border bg-secondary/20">
                      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                        <span className="flex items-center gap-1.5 text-xs font-medium">
                          <Users className="size-3.5 text-muted-foreground" />
                          دانش‌آموزان کلاس
                          <Badge variant="secondary" className="text-[10px]">
                            {formatPersianNumber(students.length)} نفر
                          </Badge>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          نمره از: {formatPersianNumber(maxScoreNum || 0)}
                        </span>
                      </div>
                      {/* Horizontal-scroll wrapper for the table on mobile */}
                      <div className="max-h-[320px] overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12 text-center">
                                ردیف
                              </TableHead>
                              <TableHead>نام دانش‌آموز</TableHead>
                              <TableHead className="w-28 text-center">
                                نمره
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {students.map((s, idx) => {
                              const v = validationByStudent[s.id];
                              const isInvalid = v?.ok === false;
                              const initial = (s.fullName || s.username || "?")
                                .trim()
                                .charAt(0)
                                .toUpperCase();
                              return (
                                <TableRow key={s.id}>
                                  <TableCell className="text-center text-xs text-muted-foreground">
                                    {formatPersianNumber(idx + 1)}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <Avatar className="size-7">
                                        <AvatarFallback
                                          className="text-[10px] font-bold"
                                          style={
                                            s.avatarColor
                                              ? {
                                                  backgroundColor: s.avatarColor,
                                                  color: "#fff",
                                                }
                                              : {
                                                  backgroundColor:
                                                    "hsl(var(--primary))",
                                                  color: "hsl(var(--primary-foreground))",
                                                }
                                          }
                                        >
                                          {initial}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex flex-col leading-tight">
                                        <span className="text-sm font-medium">
                                          {s.fullName}
                                        </span>
                                        <span
                                          dir="ltr"
                                          className="font-mono text-[10px] text-muted-foreground"
                                        >
                                          {s.username}
                                        </span>
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <Input
                                      type="number"
                                      step="0.25"
                                      min="0"
                                      max={maxScoreValid ? maxScore : undefined}
                                      value={gradeInputs[s.id] ?? ""}
                                      onChange={(e) =>
                                        setGradeInputs((prev) => ({
                                          ...prev,
                                          [s.id]: e.target.value,
                                        }))
                                      }
                                      placeholder="—"
                                      dir="ltr"
                                      inputMode="decimal"
                                      aria-label={`نمره ${s.fullName}`}
                                      className={`mx-auto h-9 w-20 text-center ${
                                        isInvalid
                                          ? "border-destructive focus-visible:ring-destructive"
                                          : ""
                                      }`}
                                    />
                                    {isInvalid && v?.reason ? (
                                      <p className="mt-1 text-[10px] text-destructive">
                                        {v.reason}
                                      </p>
                                    ) : null}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* Submit row */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {hasAnyInput
                          ? `${formatPersianNumber(validGrades.length)} نمره آماده ثبت است`
                          : "حداقل برای یک دانش‌آموز نمره وارد کنید"}
                      </span>
                      <Button
                        type="submit"
                        disabled={!canSubmit || bulkMutation.isPending}
                      >
                        {bulkMutation.isPending ? (
                          <>
                            <RefreshCw className="size-4 animate-spin" />
                            در حال ثبت…
                          </>
                        ) : (
                          <>
                            <Save className="size-4" />
                            ثبت همه نمرات
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>

            {/* Recent grades section */}
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0 },
              }}
            >
              <RecentGradesSection grades={grades ?? []} />
            </motion.div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Student view                                                     */
/* ---------------------------------------------------------------- */

function StudentGradesList({ grades }: { grades: Grade[] }) {
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
      {grades.map((g) => {
        const pct = Math.max(0, Math.min(100, (g.score / g.maxScore) * 100));
        return (
          <motion.div
            key={g.id}
            variants={{
              hidden: { opacity: 0, y: 8 },
              visible: { opacity: 1, y: 0 },
            }}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <span className="bg-green-500/10 text-green-600 flex size-7 items-center justify-center rounded-md">
                      <BarChart3 className="size-4" />
                    </span>
                    {g.title}
                  </span>
                  <span className="font-mono text-sm">
                    <span className="text-primary font-bold">
                      {formatPersianNumber(
                        Number.isInteger(g.score)
                          ? g.score
                          : Number(g.score.toFixed(1)),
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      از{" "}
                      {formatPersianNumber(
                        Number.isInteger(g.maxScore)
                          ? g.maxScore
                          : Number(g.maxScore.toFixed(1)),
                      )}
                    </span>
                  </span>
                </CardTitle>
                <CardDescription className="text-xs">
                  {formatPersianDate(g.createdAt)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={pct} className="h-2" />
                <p className="mt-2 text-xs text-muted-foreground">
                  درصد: {formatPersianNumber(Math.round(pct))}٪
                </p>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

/* ---------------------------------------------------------------- */
/* Teacher view — recent grades section                             */
/* ---------------------------------------------------------------- */

function RecentGradesSection({ grades }: { grades: Grade[] }) {
  // Show up to 8 most recent rows. The API already returns grades ordered
  // by createdAt desc, so we can just slice.
  const recent = grades.slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="bg-emerald-500/10 text-emerald-600 flex size-7 items-center justify-center rounded-md">
            <BarChart3 className="size-4" />
          </span>
          نمرات ثبت‌شده اخیر
        </CardTitle>
        <CardDescription className="text-xs">
          آخرین نمرات ثبت‌شده در این کلاس (نمای کلی)
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {recent.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <Inbox className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              هنوز نمره‌ای در این کلاس ثبت نشده است.
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>دانش‌آموز</TableHead>
                  <TableHead>آزمون</TableHead>
                  <TableHead className="text-center">نمره</TableHead>
                  <TableHead className="text-center">درصد</TableHead>
                  <TableHead>تاریخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((g) => {
                  const pct = Math.max(
                    0,
                    Math.min(100, (g.score / g.maxScore) * 100),
                  );
                  return (
                    <TableRow key={g.id}>
                      <TableCell className="font-medium">
                        {g.student.fullName}
                      </TableCell>
                      <TableCell className="text-sm">{g.title}</TableCell>
                      <TableCell className="text-center font-mono">
                        <span className="font-bold">
                          {formatPersianNumber(
                            Number.isInteger(g.score)
                              ? g.score
                              : Number(g.score.toFixed(1)),
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          /{" "}
                          {formatPersianNumber(
                            Number.isInteger(g.maxScore)
                              ? g.maxScore
                              : Number(g.maxScore.toFixed(1)),
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={pct >= 50 ? "secondary" : "destructive"}
                          className={
                            pct >= 50
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : ""
                          }
                        >
                          {formatPersianNumber(Math.round(pct))}٪
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatPersianDate(g.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- */
/* Shared empty state                                               */
/* ---------------------------------------------------------------- */

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
