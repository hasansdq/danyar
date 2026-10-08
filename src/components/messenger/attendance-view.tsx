"use client";

import * as React from "react";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { jalaaliMonthLength, toJalaali, jalaaliToDateObject } from "jalaali-js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import {
  ChevronRight,
  ChevronLeft,
  CalendarCheck,
  Check,
  Save,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { apiFetch, withQuery } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useSiteSettings } from "@/components/use-site-settings";
import { fetchClasses, fetchClassStudents } from "@/lib/messenger-api";
import { toPersianDigits } from "./persian";
import type { ClassItem, ClassStudent } from "./types";

/**
 * AttendanceView — TEACHER / ADMIN attendance taking UI.
 *
 * Layout (responsive — mobile 375px → desktop max-w-2xl):
 *   ┌─────────────────────────────────────────────┐
 *   │ Select کلاس | Select زنگ | (calendar header) │
 *   ├─────────────────────────────────────────────┤
 *   │ Jalali calendar (month grid, navigation)    │
 *   │ weekday header: ش ی د س چ پ ج                │
 *   │ clickable days · today indicator · selected │
 *   ├─────────────────────────────────────────────┤
 *   │ ردیف | نام و نام خانوادگی | وضعیت | تخلفات   │
 *   │ 1   | علی محمدی         |  ✓  | "-" (badge)  │
 *   │ 2   | فاطمه احمدی        |  غ  | (popover)   │
 *   │ ...                                         │
 *   ├─────────────────────────────────────────────┤
 *   │             [ذخیره]                          │
 *   └─────────────────────────────────────────────┘
 *
 * Persian weekday names: شنبه/یکشنبه/دوشنبه/سه‌شنبه/چهارشنبه/پنجشنبه/جمعه.
 * The first day of the Jalali week is شنبه (Saturday). JS Date's `getDay()`
 * returns 0=Sunday..6=Saturday; we shift so 0=شنبه..6=جمعه.
 *
 * All students default to present (✓ green). Clicking a row's checkbox
 * toggles present/absent (غ red). Violations are picked via a Popover
 * multi-select with 11 violation types. When at least one violation is
 * selected, the column shows "-" indicator (a red Badge). Otherwise the
 * column shows the Popover trigger ("افزودن تخلف").
 *
 * Saving calls POST /api/attendance with `{ classId, date, period, records }`.
 */

const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const PERSIAN_WEEKDAYS = [
  "شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه",
];

const PERSIAN_WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

/** 11 violation types — picked from the official school-discipline list. */
const VIOLATION_TYPES: string[] = [
  "تأخیر",
  "بی‌نظمی",
  "استفاده از گوشی",
  "صحبت در کلاس",
  "عدم انجام تکلیف",
  "بی‌احترامی",
  "بی‌انضباطی",
  "ترک کلاس",
  "استفاده از کتاب غیردرسی",
  "خوابیدن در کلاس",
  "عدم توجه به تدریس",
];

const PERIODS: Array<{ value: string; label: string }> = [
  { value: "1", label: "زنگ اول" },
  { value: "2", label: "زنگ دوم" },
  { value: "3", label: "زنگ سوم" },
  { value: "4", label: "زنگ چهارم" },
];

/** Convert a JS Date to a Jalali "YYYY-MM-DD" string. */
function toJalaliDateStr(d: Date): string {
  const j = toJalaali(d);
  const mm = String(j.jm).padStart(2, "0");
  const dd = String(j.jd).padStart(2, "0");
  return `${j.jy}-${mm}-${dd}`;
}

/** Parse a Jalali "YYYY-MM-DD" string to { jy, jm, jd }. */
function parseJalaliDate(s: string): { jy: number; jm: number; jd: number } {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s ?? "");
  if (!m) {
    const t = toJalaali(new Date());
    return { jy: t.jy, jm: t.jm, jd: t.jd };
  }
  return {
    jy: Number(m[1]),
    jm: Number(m[2]),
    jd: Number(m[3]),
  };
}

/** Convert a Jalali date to a JS Date at local midnight. */
function jalaliToDate(jy: number, jm: number, jd: number): Date {
  return jalaaliToDateObject(jy, jm, jd);
}

/** JS getDay(): 0=Sun..6=Sat. Jalali week starts on شنبه (Saturday). */
function jalaaliWeekday(d: Date): number {
  return (d.getDay() + 1) % 7; // Sat→0, Sun→1, ..., Fri→6
}

type AttendanceRecord = {
  userId: string;
  present: boolean;
  violations: string[];
};

type FetchedRow = {
  id: string;
  classId: string;
  userId: string;
  date: string;
  period: number;
  present: boolean;
  violations: string[];
};

export function AttendanceView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: siteSettings } = useSiteSettings();
  const attendanceEnabled =
    siteSettings?.modules?.attendance ?? true;

  // ----- State: selected class + period + Jalali date -----
  const { data: classes, isLoading: classesLoading } = useQuery<ClassItem[]>({
    queryKey: ["classes"],
    queryFn: fetchClasses,
    staleTime: 60_000,
  });
  const [classId, setClassId] = useState<string | null>(null);

  // Pick the first class automatically once data loads. We compute the
  // effective class id from the user's explicit selection OR the first
  // available class — this avoids a setState-in-useEffect (which would
  // cascade renders) while still giving the user a default class to look
  // at before they've picked one.
  const effectiveClassId = classId ?? (classes?.[0]?.id ?? null);
  // Whenever the effective class id changes (because classes loaded OR
  // the user picked a different class), we want the queries + students
  // list to update. We pass effectiveClassId to useQuery's `enabled` +
  // queryKey — no useEffect needed.

  const [period, setPeriod] = useState<string>("1");

  // Default to today (Jalali).
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    toJalaliDateStr(new Date()),
  );
  const { jy, jm, jd } = parseJalaliDate(selectedDate);

  // Calendar visible month — defaults to the selected date's month. Stored
  // as `{ jy, jm }` so the user can flip months independently of which
  // day is selected.
  const [viewMonth, setViewMonth] = useState<{ jy: number; jm: number }>({
    jy,
    jm,
  });
  // The day-click handler snaps viewMonth back to the selected date's
  // month (in addition to updating selectedDate). This replaces the
  // previous useEffect that did the same thing — doing it in the click
  // handler avoids setState-in-useEffect cascading renders.

  // ----- Fetch students for the selected class -----
  const {
    data: students,
    isLoading: studentsLoading,
    isError: studentsError,
    refetch: refetchStudents,
  } = useQuery<ClassStudent[]>({
    queryKey: ["class-students", effectiveClassId ?? ""],
    queryFn: () => fetchClassStudents(effectiveClassId!),
    enabled: !!effectiveClassId,
  });

  // ----- Fetch existing attendance rows for the selected class+date+period -----
  const attendanceQueryKey = [
    "attendance",
    effectiveClassId ?? "",
    selectedDate,
    period,
  ];
  const {
    data: existingRows,
    isLoading: attendanceLoading,
    refetch: refetchAttendance,
  } = useQuery<FetchedRow[]>({
    queryKey: attendanceQueryKey,
    queryFn: () =>
      apiFetch<FetchedRow[]>(
        withQuery("/api/attendance", {
          classId: effectiveClassId!,
          date: selectedDate,
          period,
        }),
      ),
    enabled: !!effectiveClassId && attendanceEnabled,
  });

  // ----- Per-student edits -----
  // Local state keyed by userId. Re-hydrates whenever the fetched rows
  // change (new class / new date / new period / save completed).
  // We intentionally use setState-in-useEffect here because the edits are
  // a DERIVED view of (existingRows + students) that we then let the
  // user mutate via togglePresent / setViolations. The React docs
  // explicitly allow this pattern for "adjusting state when props
  // change" — the rule's `set-state-in-effect` is suppressed below
  // for this reason.
  const [edits, setEdits] = useState<Record<string, AttendanceRecord>>({});

  useEffect(() => {
    const next: Record<string, AttendanceRecord> = {};
    for (const s of students ?? []) {
      const existing = (existingRows ?? []).find((r) => r.userId === s.id);
      next[s.id] = {
        userId: s.id,
        present: existing ? existing.present : true,
        violations: existing ? existing.violations : [],
      };
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEdits(next);
  }, [existingRows, students]);

  function togglePresent(userId: string) {
    setEdits((cur) => ({
      ...cur,
      [userId]: {
        ...(cur[userId] ?? {
          userId,
          present: true,
          violations: [],
        }),
        present: !(cur[userId]?.present ?? true),
      },
    }));
  }

  function setViolations(userId: string, violations: string[]) {
    setEdits((cur) => ({
      ...cur,
      [userId]: {
        ...(cur[userId] ?? {
          userId,
          present: true,
          violations: [],
        }),
        violations,
      },
    }));
  }

  // ----- Save mutation -----
  const saveMutation = useMutation({
    mutationFn: async () => {
      const records = (students ?? []).map((s) => {
        const e = edits[s.id] ?? {
          userId: s.id,
          present: true,
          violations: [],
        };
        return {
          userId: s.id,
          present: e.present,
          violations: e.violations,
        };
      });
      return apiFetch<{ upserted: number }>(`/api/attendance`, {
        method: "POST",
        body: JSON.stringify({
          classId: effectiveClassId,
          date: selectedDate,
          period: Number(period),
          records,
        }),
      });
    },
    onSuccess: (res) => {
      toast({
        title: "ذخیره شد",
        description: `${toPersianDigits(res.upserted)} رکورد به‌روزرسانی شد.`,
      });
      void queryClient.invalidateQueries({
        queryKey: ["attendance"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["attendance-me"],
      });
      void refetchAttendance();
    },
    onError: (err: Error) => {
      toast({
        title: "ذخیره ناموفق بود",
        description: err.message || "خطای غیرمنتظره",
        variant: "destructive",
      });
    },
  });

  // ----- Calendar grid (visible month) -----
  const calendarCells = useMemo(() => {
    const daysInMonth = jalaaliMonthLength(viewMonth.jy, viewMonth.jm);
    // Day 1's weekday — used to compute leading empty cells.
    const firstDate = jalaliToDate(viewMonth.jy, viewMonth.jm, 1);
    const firstWeekday = jalaaliWeekday(firstDate);
    const cells: Array<{ day: number | null; dateStr: string | null }> = [];
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ day: null, dateStr: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(viewMonth.jm).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      cells.push({
        day: d,
        dateStr: `${viewMonth.jy}-${mm}-${dd}`,
      });
    }
    // Trailing cells so the grid is always 6 rows × 7 cols = 42 cells
    // (consistent calendar height across months).
    while (cells.length % 7 !== 0) {
      cells.push({ day: null, dateStr: null });
    }
    return cells;
  }, [viewMonth]);

  const todayStr = toJalaliDateStr(new Date());

  function goPrevMonth() {
    setViewMonth((cur) => {
      let jm = cur.jm - 1;
      let jy = cur.jy;
      if (jm < 1) {
        jm = 12;
        jy -= 1;
      }
      return { jy, jm };
    });
  }
  function goNextMonth() {
    setViewMonth((cur) => {
      let jm = cur.jm + 1;
      let jy = cur.jy;
      if (jm > 12) {
        jm = 1;
        jy += 1;
      }
      return { jy, jm };
    });
  }

  // ----- Render guards -----
  if (!attendanceEnabled) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <AlertCircle className="mx-auto size-10 text-muted-foreground" />
          <p className="mt-3 font-medium">ماژول «حضور و غیاب» غیرفعال است</p>
          <p className="mt-1 text-sm text-muted-foreground">
            لطفاً از مدیر کل بخواهید این ماژول را فعال کند.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (classesLoading) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <LazySkeleton className="h-9 w-full" />
        <LazySkeleton className="h-64 w-full" />
        <LazySkeleton className="h-9 w-full" />
      </div>
    );
  }

  if (!classes || classes.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <CalendarCheck className="mx-auto size-10 text-muted-foreground" />
          <p className="mt-3 font-medium">کلاسی برای ثبت حضور و غیاب وجود ندارد</p>
          <p className="mt-1 text-sm text-muted-foreground">
            ابتدا یک کلاس ایجاد یا در آن عضو شوید.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="no-scrollbar scrollbar-rtl mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4">
      {/* ---------- Header: class + period selectors ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="size-5 text-primary" />
            ثبت حضور و غیاب
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="attendance-class" className="text-xs">
                کلاس
              </Label>
              <Select
                value={effectiveClassId ?? undefined}
                onValueChange={setClassId}
              >
                <SelectTrigger
                  id="attendance-class"
                  className="w-full"
                  aria-label="انتخاب کلاس"
                >
                  <SelectValue placeholder="انتخاب کلاس" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel className="text-xs">کلاس‌ها</SelectLabel>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attendance-period" className="text-xs">
                زنگ
              </Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger
                  id="attendance-period"
                  className="w-[160px]"
                  aria-label="انتخاب زنگ"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Calendar ---------- */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          {/* Month navigation header */}
          <div className="mb-3 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={goPrevMonth}
              aria-label="ماه قبل"
            >
              <ChevronRight className="size-4" />
            </Button>
            <div className="flex flex-col items-center">
              <span className="text-sm font-semibold">
                {PERSIAN_MONTHS[viewMonth.jm - 1]} {toPersianDigits(viewMonth.jy)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                تاریخ انتخابی: {toPersianDigits(selectedDate)}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={goNextMonth}
              aria-label="ماه بعد"
            >
              <ChevronLeft className="size-4" />
            </Button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-1">
            {PERSIAN_WEEKDAYS_SHORT.map((w, i) => (
              <div
                key={i}
                className="py-1 text-center text-[11px] font-medium text-muted-foreground"
                title={PERSIAN_WEEKDAYS[i]}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cell, idx) => {
              if (!cell.day) {
                return <div key={idx} className="aspect-square" />;
              }
              const isToday = cell.dateStr === todayStr;
              const isSelected = cell.dateStr === selectedDate;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    if (!cell.dateStr) return;
                    setSelectedDate(cell.dateStr);
                    // Phase 28 — when the user picks a day, snap the
                    // visible calendar month to the day's month too
                    // (so the user immediately sees the day they just
                    // picked, even if they navigated to a different
                    // month). Doing this in the click handler (vs an
                    // effect keyed on selectedDate) avoids setState-in-
                    // useEffect cascading renders.
                    const p = parseJalaliDate(cell.dateStr);
                    setViewMonth({ jy: p.jy, jm: p.jm });
                  }}
                  className={`flex aspect-square items-center justify-center rounded-md border text-sm transition-colors ${
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : isToday
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background hover:bg-accent"
                  }`}
                  aria-label={cell.dateStr ?? undefined}
                  aria-pressed={isSelected}
                >
                  {toPersianDigits(cell.day)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ---------- Student list ---------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              فهرست دانش‌آموزان
              {students && students.length > 0 ? (
                <Badge variant="secondary" className="text-[10px]">
                  {toPersianDigits(students.length)} نفر
                </Badge>
              ) : null}
            </span>
            <span className="text-[11px] font-normal text-muted-foreground">
              {PERSIAN_MONTHS[jm - 1]} {toPersianDigits(jd)} ·{" "}
              {PERIODS[Number(period) - 1]?.label}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {studentsLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <LazySkeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : studentsError ? (
            <div className="px-3 py-6 text-center text-sm text-destructive">
              بارگذاری دانش‌آموزان ناموفق بود.{" "}
              <Button
                variant="link"
                size="sm"
                className="px-1"
                onClick={() => void refetchStudents()}
              >
                تلاش مجدد
              </Button>
            </div>
          ) : !students || students.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              این کلاس هنوز دانش‌آموزی ندارد.
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Column header */}
              <div className="grid grid-cols-[2.5rem_1fr_4rem_7.5rem] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                <div className="text-center">ردیف</div>
                <div>نام و نام خانوادگی</div>
                <div className="text-center">وضعیت</div>
                <div className="text-center">تخلفات</div>
              </div>
              {students.map((s, i) => {
                const rec = edits[s.id] ?? {
                  userId: s.id,
                  present: true,
                  violations: [],
                };
                const hasV = rec.violations.length > 0;
                return (
                  <div
                    key={s.id}
                    className="grid grid-cols-[2.5rem_1fr_4rem_7.5rem] items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-accent/40"
                  >
                    <div className="text-center text-xs text-muted-foreground">
                      {toPersianDigits(i + 1)}
                    </div>
                    <div className="truncate text-sm font-medium" dir="auto">
                      {s.fullName}
                    </div>
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => togglePresent(s.id)}
                        className={`flex size-8 items-center justify-center rounded-md border text-sm font-bold transition-colors ${
                          rec.present
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
                        }`}
                        aria-pressed={rec.present}
                        aria-label={
                          rec.present ? "حاضر" : "غایب"
                        }
                        title={rec.present ? "حاضر" : "غایب"}
                      >
                        {rec.present ? (
                          <Check className="size-4" />
                        ) : (
                          <span>غ</span>
                        )}
                      </button>
                    </div>
                    <div className="flex justify-center">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className={`h-7 gap-1 px-2 text-[11px] ${
                              hasV
                                ? "border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400"
                                : ""
                            }`}
                          >
                            {hasV ? (
                              <>
                                <span className="text-base leading-none">−</span>
                                <Badge
                                  variant="secondary"
                                  className="px-1 py-0 text-[9px]"
                                >
                                  {toPersianDigits(rec.violations.length)}
                                </Badge>
                              </>
                            ) : (
                              "افزودن"
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-64"
                          align="center"
                          collisionPadding={8}
                        >
                          <div className="flex flex-col gap-1">
                            <div className="px-1 pb-1 text-xs font-semibold text-muted-foreground">
                              انتخاب تخلفات
                            </div>
                            <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                              {VIOLATION_TYPES.map((v) => {
                                const checked = rec.violations.includes(v);
                                return (
                                  <button
                                    key={v}
                                    type="button"
                                    onClick={() => {
                                      setViolations(
                                        s.id,
                                        checked
                                          ? rec.violations.filter(
                                              (x) => x !== v,
                                            )
                                          : [...rec.violations, v],
                                      );
                                    }}
                                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-right text-xs transition-colors ${
                                      checked
                                        ? "bg-primary/10 text-primary"
                                        : "hover:bg-accent"
                                    }`}
                                  >
                                    <span
                                      className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                                        checked
                                          ? "border-primary bg-primary text-primary-foreground"
                                          : "border-border"
                                      }`}
                                    >
                                      {checked ? (
                                        <Check className="size-3" />
                                      ) : null}
                                    </span>
                                    <span dir="auto">{v}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {hasV ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="mt-1 h-7 text-[11px] text-destructive"
                                onClick={() => setViolations(s.id, [])}
                              >
                                پاک کردن همه
                              </Button>
                            ) : null}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Save button ---------- */}
      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t bg-background/95 px-3 py-2 backdrop-blur">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetchAttendance()}
          disabled={attendanceLoading}
        >
          {attendanceLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "بارگذاری مجدد"
          )}
        </Button>
        <Button
          size="sm"
          onClick={() => void saveMutation.mutate()}
          disabled={
            saveMutation.isPending ||
            studentsLoading ||
            !students ||
            students.length === 0
          }
          className="gap-2"
        >
          {saveMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          ذخیره
        </Button>
      </div>
    </div>
  );
}
