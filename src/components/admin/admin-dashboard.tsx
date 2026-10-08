"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Users as UsersIcon,
  GraduationCap,
  School,
  MessagesSquare,
  ClipboardList,
  Award,
  FileQuestion,
  TrendingUp,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/admin/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface AdminStats {
  totalUsers: number;
  totalStudents: number;
  totalTeachers: number;
  totalAdmins: number;
  totalClasses: number;
  totalMessages: number;
  totalAssignments: number;
  totalSampleQuestions: number;
  totalGrades: number;
  totalBehaviors: number;
  recentUsers: Array<{
    id: string;
    username: string;
    fullName: string;
    role: string;
    createdAt: string;
  }>;
  recentClasses: Array<{
    id: string;
    name: string;
    gradeLevel: string | null;
    createdAt: string;
    _count: { memberships: number };
  }>;
}

function roleBadge(role: string) {
  if (role === "ADMIN")
    return <Badge variant="default">مدیر</Badge>;
  if (role === "TEACHER")
    return (
      <Badge variant="secondary">معلم</Badge>
    );
  return <Badge variant="outline">دانش‌آموز</Badge>;
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

export function AdminDashboard() {
  const { data, isLoading, isError, error } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: () => apiFetch<AdminStats>("/api/admin/stats"),
  });

  if (isError) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-destructive text-sm">
            خطا در بارگذاری آمار: {(error as Error)?.message || "نامشخص"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const stats = [
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
      iconClassName: "bg-teal-500/10 text-teal-600",
    },
    {
      title: "معلمان",
      value: data.totalTeachers,
      icon: UsersIcon,
      iconClassName: "bg-amber-500/10 text-amber-600",
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">داشبورد مدیریت</h2>
          <p className="text-muted-foreground text-sm">
            نمای کلی از وضعیت سامانه آموزشی
          </p>
        </div>
        <TrendingUp className="size-6 text-primary" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard
            key={s.title}
            title={s.title}
            value={s.value}
            icon={s.icon}
            description={s.description}
            iconClassName={s.iconClassName}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">آخرین کاربران</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نام</TableHead>
                  <TableHead>نام کاربری</TableHead>
                  <TableHead>نقش</TableHead>
                  <TableHead>تاریخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentUsers.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-muted-foreground text-center text-sm"
                    >
                      کاربری یافت نشد
                    </TableCell>
                  </TableRow>
                )}
                {data.recentUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.fullName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.username}
                    </TableCell>
                    <TableCell>{roleBadge(u.role)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs persian-nums">
                      {formatDate(u.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">آخرین کلاس‌ها</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نام کلاس</TableHead>
                  <TableHead>پایه</TableHead>
                  <TableHead>اعضا</TableHead>
                  <TableHead>تاریخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentClasses.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-muted-foreground text-center text-sm"
                    >
                      کلاسی یافت نشد
                    </TableCell>
                  </TableRow>
                )}
                {data.recentClasses.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/classes/${c.id}`}
                        className="text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {c.gradeLevel || "—"}
                    </TableCell>
                    <TableCell className="persian-nums">
                      {c._count?.memberships ?? 0}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs persian-nums">
                      {formatDate(c.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
