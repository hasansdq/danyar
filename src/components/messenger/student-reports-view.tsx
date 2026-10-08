"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { jalaaliToDateObject } from "jalaali-js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Inbox, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { toPersianDigits } from "./persian";

/**
 * StudentReportsView — STUDENT's own attendance reports page.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │ غیبت‌ها (N)                                  │
 *   │  · [Jalali date] · [period] · [className]    │
 *   │  · ...                                       │
 *   ├─────────────────────────────────────────────┤
 *   │ تخلفات (N)                                   │
 *   │  · [Jalali date] · [period] · [className]    │
 *   │    [violation badges...]                      │
 *   │  · ...                                       │
 *   └─────────────────────────────────────────────┘
 *
 * Fetches from GET /api/attendance/me (no module gate — students always
 * see their own reports).
 *
 * Empty states:
 *   - No absences → "هنوز غیبتی ثبت نشده است"
 *   - No violations → "هنوز تخلفی ثبت نشده است"
 *
 * Responsive + scrollable (parent wraps with `flex flex-col min-h-0 flex-1`
 * and inner `overflow-y-auto min-h-0 flex-1`).
 */

const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const PERSIAN_WEEKDAYS = [
  "شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه",
];

/** Convert a Jalali "YYYY-MM-DD" string to a Persian long-form display. */
function formatJalaliLong(dateStr: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateStr ?? "");
  if (!m) return dateStr;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  const d = jalaaliToDateObject(jy, jm, jd);
  const weekdayIdx = (d.getDay() + 1) % 7; // Sat→0..Fri→6
  const monthName = PERSIAN_MONTHS[jm - 1] ?? "";
  return `${PERSIAN_WEEKDAYS[weekdayIdx]} ${toPersianDigits(jd)} ${monthName} ${toPersianDigits(jy)}`;
}

type MeRow = {
  id: string;
  classId: string;
  userId: string;
  date: string;
  period: number;
  present: boolean;
  violations: string[];
  class: {
    id: string;
    name: string;
    gradeLevel?: string | null;
    section?: string | null;
  };
};

export function StudentReportsView() {
  const { toast } = useToast();
  const [, setJustLoaded] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<MeRow[]>({
    queryKey: ["attendance-me"],
    queryFn: () => apiFetch<MeRow[]>(`/api/attendance/me`),
    staleTime: 30_000,
  });

  React.useEffect(() => {
    setJustLoaded(true);
  }, []);

  React.useEffect(() => {
    if (isError && error) {
      toast({
        title: "بارگذاری گزارش‌ها ناموفق بود",
        description: (error as Error)?.message || "خطای غیرمنتظره",
        variant: "destructive",
      });
    }
  }, [isError, error, toast]);

  const absences = useMemo(
    () => (data ?? []).filter((r) => !r.present),
    [data],
  );
  const withViolations = useMemo(
    () => (data ?? []).filter((r) => r.violations.length > 0),
    [data],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <LazySkeleton className="h-7 w-32" />
        <LazySkeleton className="h-16 w-full" />
        <LazySkeleton className="h-16 w-full" />
        <LazySkeleton className="h-7 w-32" />
        <LazySkeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <AlertTriangle className="size-10 text-destructive" />
        <p className="font-medium">بارگذاری گزارش‌ها ناموفق بود</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-sm text-primary hover:underline"
        >
          تلاش مجدد
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="overflow-y-auto min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3 sm:p-4">
          {/* ---------- Absences ---------- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>غیبت‌ها</span>
                <Badge variant="secondary" className="text-[10px]">
                  {toPersianDigits(absences.length)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {absences.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                  <Inbox className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    هنوز غیبتی ثبت نشده است
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {absences.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-red-600 dark:text-red-400">
                        <span className="text-sm font-bold">غ</span>
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {formatJalaliLong(r.date)}
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                            زنگ {toPersianDigits(r.period)}
                          </Badge>
                          <span className="truncate" dir="auto">
                            {r.class?.name ?? "—"}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---------- Violations ---------- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>تخلفات</span>
                <Badge variant="secondary" className="text-[10px]">
                  {toPersianDigits(withViolations.length)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {withViolations.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                  <Inbox className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    هنوز تخلفی ثبت نشده است
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {withViolations.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-col gap-1.5 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="size-4" />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">
                            {formatJalaliLong(r.date)}
                          </span>
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                              زنگ {toPersianDigits(r.period)}
                            </Badge>
                            <span className="truncate" dir="auto">
                              {r.class?.name ?? "—"}
                            </span>
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 pr-11">
                        {r.violations.map((v, i) => (
                          <Badge
                            key={`${r.id}-v${i}`}
                            variant="outline"
                            className="border-amber-500/30 bg-amber-500/5 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-300"
                          >
                            {v}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
