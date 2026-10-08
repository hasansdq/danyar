"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import {
  ChevronDown,
  ChevronLeft,
  CalendarCheck,
  Users,
  UserCheck,
  UserX,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { apiFetch, withQuery } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { fetchClasses } from "@/lib/messenger-api";
import { toPersianDigits } from "@/components/messenger/persian";
import type { ClassItem } from "@/components/messenger/types";

/**
 * AttendancePanel — ADMIN (principal) attendance dashboard.
 *
 * Layout (responsive):
 *   ┌─────────────────────────────────────────────┐
 *   │ 4 stat cards: کل دانش‌آموزان / حاضر / غایب │
 *   │              / تخلفات                       │
 *   ├─────────────────────────────────────────────┤
 *   │ 7-day CSS bar chart (present vs absent)     │
 *   ├─────────────────────────────────────────────┤
 *   │ Select کلاس → per-student expandable list    │
 *   │   ▸ علی محمدی — ۲ غیبت · ۱ تخلف             │
 *   │     [recent absences list]                  │
 *   │     [recent violations list]                │
 *   │   ▸ ...                                     │
 *   └─────────────────────────────────────────────┘
 *
 * Fetches:
 *   - GET /api/admin/attendance/stats             (daily + 7-day)
 *   - GET /api/classes                            (for the class selector)
 *   - GET /api/admin/attendance/by-class?classId= (per-student summary)
 */

type Stats = {
  today: {
    totalStudents: number;
    present: number;
    absent: number;
    violations: number;
  };
  week: Array<{
    date: string;
    monthName: string;
    day: number;
    present: number;
    absent: number;
    violations: number;
  }>;
};

type ByClassRow = {
  userId: string;
  fullName: string;
  username: string;
  totalRecords: number;
  absentCount: number;
  violationCount: number;
  recentAbsences: Array<{ date: string; period: number }>;
  recentViolations: Array<{
    date: string;
    period: number;
    violations: string[];
  }>;
};

const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** Format "1403-07-15" → "۱۵ مهر ۱۴۰۳" (Persian). */
function formatJalali(dateStr: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateStr ?? "");
  if (!m) return dateStr;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  const monthName = PERSIAN_MONTHS[jm - 1] ?? "";
  return `${toPersianDigits(jd)} ${monthName} ${toPersianDigits(jy)}`;
}

export function AttendancePanel() {
  const { toast } = useToast();

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery<Stats>({
    queryKey: ["admin-attendance-stats"],
    queryFn: () => apiFetch<Stats>(`/api/admin/attendance/stats`),
    staleTime: 30_000,
  });

  const { data: classes, isLoading: classesLoading } = useQuery<ClassItem[]>({
    queryKey: ["classes"],
    queryFn: fetchClasses,
    staleTime: 60_000,
  });

  const [classId, setClassId] = useState<string | null>(null);
  React.useEffect(() => {
    if (classId || !classes || classes.length === 0) return;
    setClassId(classes[0].id);
  }, [classes, classId]);

  const {
    data: byClass,
    isLoading: byClassLoading,
    isError: byClassError,
    refetch: refetchByClass,
  } = useQuery<ByClassRow[]>({
    queryKey: ["admin-attendance-by-class", classId ?? ""],
    queryFn: () =>
      apiFetch<ByClassRow[]>(
        withQuery("/api/admin/attendance/by-class", { classId: classId! }),
      ),
    enabled: !!classId,
    staleTime: 30_000,
  });

  // Expandable student rows. Set of userIds.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleExpand(userId: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  // Compute the bar-chart max present+absent across the 7 days so the
  // bars are scaled relatively.
  const weekMax = useMemo(() => {
    if (!stats?.week || stats.week.length === 0) return 1;
    return Math.max(
      1,
      ...stats.week.map((d) => d.present + d.absent),
    );
  }, [stats]);

  React.useEffect(() => {
    if (statsError) {
      toast({
        title: "بارگذاری آمار ناموفق بود",
        description: "لطفاً مجدداً تلاش کنید.",
        variant: "destructive",
      });
    }
  }, [statsError, toast]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4">
      {/* ---------- Header ---------- */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <CalendarCheck className="size-6 text-emerald-500" />
            حضور و غیاب
          </h2>
          <p className="text-sm text-muted-foreground">
            آمار روزانه و گزارش‌های حضور و غیاب مدرسه.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => {
            void refetchStats();
            void refetchByClass();
          }}
        >
          <RefreshCw className="size-4" />
          بارگذاری مجدد
        </Button>
      </header>

      {/* ---------- Stat cards ---------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <LazySkeleton key={i} className="h-28 w-full" />
          ))
        ) : (
          <>
            <StatTile
              title="کل دانش‌آموزان"
              value={stats?.today.totalStudents ?? 0}
              icon={Users}
              color="bg-sky-500/10 text-sky-600 dark:text-sky-400"
            />
            <StatTile
              title="حاضر"
              value={stats?.today.present ?? 0}
              icon={UserCheck}
              color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            />
            <StatTile
              title="غایب"
              value={stats?.today.absent ?? 0}
              icon={UserX}
              color="bg-red-500/10 text-red-600 dark:text-red-400"
            />
            <StatTile
              title="تخلفات"
              value={stats?.today.violations ?? 0}
              icon={AlertTriangle}
              color="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            />
          </>
        )}
      </div>

      {/* ---------- 7-day CSS bar chart ---------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            آمار ۷ روز اخیر
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {statsLoading ? (
            <LazySkeleton className="h-40 w-full" />
          ) : (
            <div className="flex flex-col gap-3">
              {/* Legend */}
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-emerald-500" />
                  حاضر
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-red-500" />
                  غایب
                </span>
              </div>
              <div className="flex h-40 items-end justify-between gap-1.5">
                {(stats?.week ?? []).map((d) => {
                  const total = d.present + d.absent;
                  const totalH = (total / weekMax) * 100;
                  const presentH =
                    total > 0 ? (d.present / total) * 100 : 0;
                  const absentH =
                    total > 0 ? (d.absent / total) * 100 : 0;
                  return (
                    <div
                      key={d.date}
                      className="flex h-full flex-1 flex-col items-center gap-1"
                      title={`${formatJalali(d.date)} · حاضر: ${d.present} · غایب: ${d.absent}`}
                    >
                      <div
                        className="flex w-full max-w-[40px] flex-1 flex-col justify-end overflow-hidden rounded-md border bg-muted/30"
                        style={{ height: `${totalH}%` }}
                      >
                        <div
                          className="w-full bg-red-500/70"
                          style={{ height: `${absentH}%` }}
                        />
                        <div
                          className="w-full bg-emerald-500/70"
                          style={{ height: `${presentH}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {toPersianDigits(d.day)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Per-class summary ---------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span>گزارش به تفکیک کلاس</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                کلاس
              </label>
              <Select
                value={classId ?? undefined}
                onValueChange={setClassId}
              >
                <SelectTrigger className="w-full" aria-label="انتخاب کلاس">
                  <SelectValue placeholder="انتخاب کلاس" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel className="text-xs">کلاس‌ها</SelectLabel>
                    {(classes ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {byClassLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <LazySkeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : byClassError ? (
            <div className="py-6 text-center text-sm text-destructive">
              بارگذاری گزارش ناموفق بود.
            </div>
          ) : !byClass || byClass.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              این کلاس هنوز دانش‌آموزی ندارد.
            </div>
          ) : (
            <div className="divide-y">
              {byClass.map((row) => {
                const open = expanded.has(row.userId);
                return (
                  <div key={row.userId} className="py-1">
                    <button
                      type="button"
                      onClick={() => toggleExpand(row.userId)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-right transition-colors hover:bg-accent"
                      aria-expanded={open}
                    >
                      <ChevronDown
                        className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                          open ? "" : "-rotate-90"
                        }`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span
                          className="truncate text-sm font-medium"
                          dir="auto"
                        >
                          {row.fullName}
                        </span>
                        <span className="text-[11px] text-muted-foreground" dir="ltr">
                          @{row.username}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className="gap-1 border-red-500/30 bg-red-500/5 px-1.5 py-0 text-[10px] text-red-600 dark:text-red-400"
                      >
                        <UserX className="size-3" />
                        {toPersianDigits(row.absentCount)} غیبت
                      </Badge>
                      <Badge
                        variant="outline"
                        className="gap-1 border-amber-500/30 bg-amber-500/5 px-1.5 py-0 text-[10px] text-amber-600 dark:text-amber-400"
                      >
                        <AlertTriangle className="size-3" />
                        {toPersianDigits(row.violationCount)} تخلف
                      </Badge>
                      <span className="hidden text-[10px] text-muted-foreground sm:inline">
                        {toPersianDigits(row.totalRecords)} رکورد
                      </span>
                    </button>
                    {open ? (
                      <div className="grid grid-cols-1 gap-3 px-3 pb-3 pt-1 sm:grid-cols-2">
                        {/* Recent absences */}
                        <div className="rounded-md border p-2">
                          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
                            غیبت‌های اخیر
                          </div>
                          {row.recentAbsences.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              موردی ثبت نشده است.
                            </p>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {row.recentAbsences.map((a, i) => (
                                <li
                                  key={i}
                                  className="flex items-center gap-2 text-xs"
                                >
                                  <ChevronLeft className="size-3 shrink-0 text-muted-foreground" />
                                  <span dir="auto">
                                    {formatJalali(a.date)}
                                  </span>
                                  <Badge
                                    variant="secondary"
                                    className="px-1 py-0 text-[9px]"
                                  >
                                    زنگ {toPersianDigits(a.period)}
                                  </Badge>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        {/* Recent violations */}
                        <div className="rounded-md border p-2">
                          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
                            تخلفات اخیر
                          </div>
                          {row.recentViolations.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              موردی ثبت نشده است.
                            </p>
                          ) : (
                            <ul className="flex flex-col gap-2">
                              {row.recentViolations.map((v, i) => (
                                <li
                                  key={i}
                                  className="flex flex-col gap-1 text-xs"
                                >
                                  <div className="flex items-center gap-2">
                                    <ChevronLeft className="size-3 shrink-0 text-muted-foreground" />
                                    <span dir="auto">
                                      {formatJalali(v.date)}
                                    </span>
                                    <Badge
                                      variant="secondary"
                                      className="px-1 py-0 text-[9px]"
                                    >
                                      زنگ {toPersianDigits(v.period)}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap gap-1 pr-5">
                                    {v.violations.map((vv, j) => (
                                      <Badge
                                        key={`${i}-${j}`}
                                        variant="outline"
                                        className="border-amber-500/30 bg-amber-500/5 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-300"
                                      >
                                        {vv}
                                      </Badge>
                                    ))}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Small inline stat tile — mirrors the StatCard shape but inline to keep
 *  the bundle small (we don't need the shared StatCard's iconClassName
 *  prop semantics here). */
function StatTile({
  title,
  value,
  icon: Icon,
  color,
}: {
  title: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-muted-foreground">
            {title}
          </span>
          <span className="text-2xl font-bold tracking-tight persian-nums">
            {typeof value === "number" ? toPersianDigits(value) : value}
          </span>
        </div>
        <div
          className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${color}`}
        >
          <Icon className="size-6" />
        </div>
      </CardContent>
    </Card>
  );
}
