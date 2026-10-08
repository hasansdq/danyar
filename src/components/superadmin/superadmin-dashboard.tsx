"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Users as UsersIcon,
  GraduationCap,
  School,
  Building2,
  MessagesSquare,
  ClipboardList,
  Vote,
  Crown,
  UserCog,
  TrendingUp,
  ArrowLeft,
  KeyRound,
  UserPlus,
  Award,
  FileQuestion,
  type LucideIcon,
} from "lucide-react";
import { getSuperAdminStats, type SuperAdminStats } from "@/lib/superadmin-api";
import { SuperAdminStatCard } from "@/components/superadmin/superadmin-stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function roleBadge(role: string) {
  switch (role) {
    case "SUPERADMIN":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 gap-1"
        >
          <Crown className="size-3" />
          مدیر کل
        </Badge>
      );
    case "ADMIN":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 text-amber-500 gap-1"
        >
          <UserCog className="size-3" />
          مدیر
        </Badge>
      );
    case "TEACHER":
      return (
        <Badge
          variant="outline"
          className="border-teal-500/40 bg-teal-500/10 text-teal-500"
        >
          معلم
        </Badge>
      );
    case "STUDENT":
    default:
      return (
        <Badge
          variant="outline"
          className="border-border bg-muted text-foreground"
        >
          دانش‌آموز
        </Badge>
      );
  }
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

const QUICK_ACTIONS = [
  {
    href: "/superadmin/users",
    label: "افزودن کاربر",
    description: "ایجاد حساب جدید برای مدیر، معلم یا دانش‌آموز",
    icon: UserPlus,
  },
  {
    href: "/superadmin/schools",
    label: "ایجاد مدرسه",
    description: "تعریف مدرسه جدید و تعیین مدیر آن",
    icon: Building2,
  },
  {
    href: "/superadmin/permissions",
    label: "کنترل دسترسی نقش‌ها",
    description: "فعال/غیرفعال کردن ماژولار قابلیت‌های هر نقش",
    icon: KeyRound,
  },
];

export function SuperAdminDashboard() {
  const { data, isLoading, isError, error } = useQuery<SuperAdminStats>({
    queryKey: ["superadmin-stats"],
    queryFn: getSuperAdminStats,
  });

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              داشبورد مدیر کل
            </h2>
            <p className="text-sm text-muted-foreground">
              نمای کلی از وضعیت سامانه آموزشی
            </p>
          </div>
        </header>
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <p className="text-sm text-red-500">
            خطا در بارگذاری آمار: {(error as Error)?.message || "نامشخص"}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in-up">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              داشبورد مدیر کل
            </h2>
            <p className="text-sm text-muted-foreground">
              نمای کلی از وضعیت سامانه آموزشی
            </p>
          </div>
          <TrendingUp className="size-6 text-emerald-500" />
        </header>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-24 w-full border border-border bg-card/60"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full border border-border bg-card/60" />
          <Skeleton className="h-64 w-full border border-border bg-card/60" />
        </div>
      </div>
    );
  }

  const stats: Array<{
    title: string;
    value: number;
    icon: LucideIcon;
    description?: string;
    iconClassName?: string;
  }> = [
    {
      title: "کل کاربران",
      value: data.totalUsers,
      icon: UsersIcon,
      description: "همه حساب‌ها",
    },
    {
      title: "دانش‌آموزان",
      value: data.totalStudents,
      icon: GraduationCap,
      iconClassName:
        "bg-teal-500/10 text-teal-500 ring-teal-500/20",
    },
    {
      title: "معلمان",
      value: data.totalTeachers,
      icon: UsersIcon,
      iconClassName:
        "bg-amber-500/10 text-amber-500 ring-amber-500/20",
    },
    {
      title: "مدیران",
      value: data.totalAdmins,
      icon: UserCog,
      iconClassName: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
    },
    {
      title: "مدیران کل",
      value: data.totalSuperAdmins,
      icon: Crown,
      iconClassName: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
      description: "بالاترین دسترسی",
    },
    {
      title: "مدارس",
      value: data.totalSchools,
      icon: Building2,
      iconClassName: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
      description: "مدارس فعال سامانه",
    },
    {
      title: "کلاس‌ها",
      value: data.totalClasses,
      icon: School,
    },
    {
      title: "پیام‌ها",
      value: data.totalMessages,
      icon: MessagesSquare,
    },
    {
      title: "تکالیف",
      value: data.totalAssignments,
      icon: ClipboardList,
    },
    {
      title: "نظرسنجی‌ها",
      value: data.totalPolls,
      icon: Vote,
    },
    {
      title: "نمونه سوالات",
      value: data.totalSampleQuestions,
      icon: FileQuestion,
    },
    {
      title: "نمرات ثبت‌شده",
      value: data.totalGrades,
      icon: Award,
    },
  ];

  return (
    <div className="flex flex-col gap-6 animate-fade-in-up">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            داشبورد مدیر کل
          </h2>
          <p className="text-sm text-muted-foreground">
            نمای کلی از وضعیت سامانه آموزشی و کنترل کامل نقش‌ها
          </p>
        </div>
        <TrendingUp className="size-6 text-emerald-500" />
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {stats.map((s) => (
          <SuperAdminStatCard
            key={s.title}
            title={s.title}
            value={s.value}
            icon={s.icon}
            description={s.description}
            iconClassName={s.iconClassName}
          />
        ))}
      </div>

      {/* Quick actions */}
      <section className="rounded-xl border border-border bg-card/40 p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          دسترسی‌های سریع
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.href}
                href={a.href}
                className={cn(
                  "group flex items-start gap-3 rounded-lg border border-border bg-card/40 p-3 transition-colors",
                  "hover:border-emerald-500/40 hover:bg-card",
                )}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20 transition-colors group-hover:bg-emerald-500/20">
                  <Icon className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {a.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{a.description}</span>
                </div>
                <ArrowLeft className="ml-auto size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-emerald-500" />
              </Link>
            );
          })}
        </div>
      </section>

      {/* Recent users + recent classes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-border bg-card/40">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-base font-semibold text-foreground">
              آخرین کاربران
            </h3>
            <Link
              href="/superadmin/users"
              className="text-xs text-emerald-500 hover:underline"
            >
              مشاهده همه
            </Link>
          </header>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">نام</TableHead>
                <TableHead className="text-muted-foreground">نام کاربری</TableHead>
                <TableHead className="text-muted-foreground">نقش</TableHead>
                <TableHead className="text-muted-foreground">تاریخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentUsers.length === 0 && (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    کاربری یافت نشد
                  </TableCell>
                </TableRow>
              )}
              {data.recentUsers.map((u) => (
                <TableRow
                  key={u.id}
                  className="border-border hover:bg-card"
                >
                  <TableCell className="font-medium text-foreground">
                    {u.fullName}
                  </TableCell>
                  <TableCell className="text-muted-foreground" dir="ltr">
                    {u.username}
                  </TableCell>
                  <TableCell>{roleBadge(u.role)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground persian-nums">
                    {formatDate(u.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card/40">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-base font-semibold text-foreground">
              آخرین کلاس‌ها
            </h3>
            <Link
              href="/superadmin/classes"
              className="text-xs text-emerald-500 hover:underline"
            >
              مشاهده همه
            </Link>
          </header>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">نام کلاس</TableHead>
                <TableHead className="text-muted-foreground">بخش</TableHead>
                <TableHead className="text-muted-foreground">اعضا</TableHead>
                <TableHead className="text-muted-foreground">تاریخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentClasses.length === 0 && (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    کلاسی یافت نشد
                  </TableCell>
                </TableRow>
              )}
              {data.recentClasses.map((c) => (
                <TableRow
                  key={c.id}
                  className="border-border hover:bg-card"
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/superadmin/classes/${c.id}`}
                      className="text-emerald-500 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.section || "—"}
                  </TableCell>
                  <TableCell className="persian-nums text-foreground">
                    {c._count?.memberships ?? 0}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground persian-nums">
                    {formatDate(c.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
    </div>
  );
}
