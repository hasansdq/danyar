"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCheck,
  Crown,
  School,
  Search,
  Trash2,
  UserCog,
  UserPlus,
  Users as UsersIcon,
  XCircle,
} from "lucide-react";
import {
  batchEnroll,
  batchUnenroll,
  getSuperAdminClass,
  listSuperAdminUsers,
  type SuperAdminClassDetail as ClassDetailData,
  type SuperAdminUserListItem,
} from "@/lib/superadmin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || "") + (parts[1][0] || "");
}

function memberRoleBadge(role: string) {
  if (role === "TEACHER") {
    return (
      <Badge
        variant="outline"
        className="border-teal-500/40 bg-teal-500/10 text-teal-500"
      >
        معلم
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-border bg-muted text-foreground"
    >
      دانش‌آموز
    </Badge>
  );
}

function userRoleBadge(role: string) {
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

export function SuperAdminClassDetail({ classId }: { classId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: cls, isLoading, isError, error } = useQuery<ClassDetailData>({
    queryKey: ["superadmin-class", classId],
    queryFn: () => getSuperAdminClass(classId),
  });

  // Fetch all users (page 1, large pageSize) for the batch enrollment list.
  const [userSearchInput, setUserSearchInput] = React.useState("");
  const [userSearch, setUserSearch] = React.useState("");
  const [userRoleFilter, setUserRoleFilter] = React.useState<
    "ALL" | "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN"
  >("STUDENT");

  React.useEffect(() => {
    const t = setTimeout(() => setUserSearch(userSearchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [userSearchInput]);

  const usersQuery = useQuery({
    queryKey: ["superadmin-users-batch", userRoleFilter, userSearch],
    queryFn: () =>
      listSuperAdminUsers({
        page: 1,
        pageSize: 200,
        role: userRoleFilter === "ALL" ? "ALL" : (userRoleFilter as any),
        search: userSearch,
      }),
  });

  // Batch enrollment state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [enrollRole, setEnrollRole] = React.useState<"STUDENT" | "TEACHER">(
    "STUDENT",
  );
  const [enrolling, setEnrolling] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const memberIds = React.useMemo(
    () => new Set((cls?.memberships ?? []).map((m) => m.userId)),
    [cls],
  );

  const visibleUsers: SuperAdminUserListItem[] =
    usersQuery.data?.items ?? [];

  function toggleUser(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allVisibleSelected =
    visibleUsers.length > 0 &&
    visibleUsers.every((u) => selectedIds.has(u.id));

  const someVisibleSelected =
    !allVisibleSelected && visibleUsers.some((u) => selectedIds.has(u.id));

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        visibleUsers.forEach((u) => next.add(u.id));
      } else {
        visibleUsers.forEach((u) => next.delete(u.id));
      }
      return next;
    });
  }

  async function handleBatchEnroll() {
    if (selectedIds.size === 0) {
      toast({
        title: "هیچ کاربری انتخاب نشده",
        description: "ابتدا کاربران موردنظر را انتخاب کنید",
        variant: "destructive",
      });
      return;
    }
    setEnrolling(true);
    try {
      const result = await batchEnroll({
        classId,
        userIds: Array.from(selectedIds),
        role: enrollRole,
      });
      const summary = `${result.newlyEnrolled} کاربر جدید عضو شدند، ${result.roleUpdated} نقش به‌روزرسانی شد، ${result.alreadyEnrolled} کاربر قبلاً عضو بوده‌اند`;
      toast({
        title: "عضویت دسته‌ای انجام شد",
        description: summary,
      });
      qc.invalidateQueries({ queryKey: ["superadmin-class", classId] });
      qc.invalidateQueries({ queryKey: ["superadmin-classes"] });
      qc.invalidateQueries({ queryKey: ["superadmin-stats"] });
      setSelectedIds(new Set());
    } catch (err) {
      toast({
        title: "خطا در عضویت دسته‌ای",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setEnrolling(false);
    }
  }

  async function handleBatchRemoveConfirm() {
    if (selectedIds.size === 0) return;
    setRemoving(true);
    try {
      const result = await batchUnenroll({
        classId,
        userIds: Array.from(selectedIds),
      });
      toast({
        title: "حذف دسته‌ای انجام شد",
        description: `${result.removed} کاربر از کلاس حذف شدند`,
      });
      qc.invalidateQueries({ queryKey: ["superadmin-class", classId] });
      qc.invalidateQueries({ queryKey: ["superadmin-classes"] });
      setSelectedIds(new Set());
    } catch (err) {
      toast({
        title: "خطا در حذف دسته‌ای",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      <header className="flex flex-col gap-3">
        <Link
          href="/superadmin/classes"
          className="inline-flex items-center gap-1 text-xs text-emerald-500 hover:underline"
        >
          <ArrowRight className="size-3.5" />
          بازگشت به فهرست کلاس‌ها
        </Link>
        {isLoading ? (
          <Skeleton className="h-9 w-48 border border-border bg-card/60" />
        ) : (
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              {cls?.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              مدیریت اعضا و عضویت دسته‌ای
            </p>
          </div>
        )}
      </header>

      {isError ? (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-6 text-center text-sm text-red-500">
            خطا در بارگذاری کلاس: {(error as Error)?.message || "نامشخص"}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-32 border border-border bg-card/60" />
          <Skeleton className="h-32 border border-border bg-card/60" />
          <Skeleton className="h-32 border border-border bg-card/60" />
        </div>
      ) : (
        <>
          {/* Class info */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="border-border bg-card/40">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
                  <School className="size-5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">پایه تحصیلی</span>
                  <span className="text-sm font-semibold text-foreground">
                    {cls?.gradeLevel || "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border bg-card/40">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
                  <span className="text-sm font-bold">ب</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">بخش</span>
                  <span className="text-sm font-semibold text-foreground">
                    {cls?.section || "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border bg-card/40">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-teal-500/10 text-teal-500 ring-1 ring-teal-500/20">
                  <UsersIcon className="size-5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">تعداد اعضا</span>
                  <span className="persian-nums text-sm font-semibold text-foreground">
                    {(cls?.memberships ?? []).length} نفر
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Members table */}
          <Card className="overflow-hidden border-border bg-card/40">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-base text-foreground">
                اعضای فعلی کلاس
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground">کاربر</TableHead>
                      <TableHead className="text-muted-foreground">
                        نام کاربری
                      </TableHead>
                      <TableHead className="text-muted-foreground">نقش سیستمی</TableHead>
                      <TableHead className="text-muted-foreground">نقش عضویت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cls?.memberships.length === 0 && (
                      <TableRow className="border-border hover:bg-transparent">
                        <TableCell
                          colSpan={4}
                          className="py-8 text-center text-muted-foreground"
                        >
                          هیچ عضوی در این کلاس ثبت نشده است
                        </TableCell>
                      </TableRow>
                    )}
                    {cls?.memberships.map((m) => (
                      <TableRow
                        key={m.id}
                        className="border-border hover:bg-card"
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback className="bg-emerald-500/10 text-emerald-500 text-xs font-semibold">
                                {initials(m.user.fullName)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-foreground">
                              {m.user.fullName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground" dir="ltr">
                          {m.user.username}
                        </TableCell>
                        <TableCell>{userRoleBadge(m.user.role)}</TableCell>
                        <TableCell>{memberRoleBadge(m.role)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Batch enrollment */}
          <Card className="border-border bg-card/40">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-base text-foreground">
                <UserPlus className="size-4 text-emerald-500" />
                عضویت دسته‌ای
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 p-4">
              {/* Controls row */}
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="flex-1">
                  <Label
                    htmlFor="enrollRole"
                    className="mb-1.5 block text-xs text-foreground"
                  >
                    نقش عضویت در کلاس
                  </Label>
                  <Select
                    value={enrollRole}
                    onValueChange={(v) =>
                      setEnrollRole(v as "STUDENT" | "TEACHER")
                    }
                  >
                    <SelectTrigger
                      id="enrollRole"
                      className="border-border bg-background text-foreground focus:ring-emerald-500/40 sm:w-44"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-card text-foreground">
                      <SelectItem value="STUDENT">دانش‌آموز</SelectItem>
                      <SelectItem value="TEACHER">معلم</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1">
                  <Label
                    htmlFor="userRoleFilter"
                    className="mb-1.5 block text-xs text-foreground"
                  >
                    فیلتر نقش کاربر
                  </Label>
                  <Select
                    value={userRoleFilter}
                    onValueChange={(v) =>
                      setUserRoleFilter(v as typeof userRoleFilter)
                    }
                  >
                    <SelectTrigger
                      id="userRoleFilter"
                      className="border-border bg-background text-foreground focus:ring-emerald-500/40 sm:w-44"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-card text-foreground">
                      <SelectItem value="ALL">همه نقش‌ها</SelectItem>
                      <SelectItem value="STUDENT">دانش‌آموز</SelectItem>
                      <SelectItem value="TEACHER">معلم</SelectItem>
                      <SelectItem value="ADMIN">مدیر</SelectItem>
                      <SelectItem value="SUPERADMIN">مدیر کل</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1">
                  <Label
                    htmlFor="userSearch"
                    className="mb-1.5 block text-xs text-foreground"
                  >
                    جستجوی کاربر
                  </Label>
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="userSearch"
                      placeholder="نام یا نام کاربری..."
                      value={userSearchInput}
                      onChange={(e) => setUserSearchInput(e.target.value)}
                      className="border-border bg-background text-foreground placeholder:text-muted-foreground pr-10 focus-visible:ring-emerald-500/40"
                    />
                  </div>
                </div>
              </div>

              {/* Users table */}
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="max-h-96 overflow-y-auto scrollbar-rtl">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead className="w-10 text-muted-foreground">
                          <Checkbox
                            checked={
                              allVisibleSelected
                                ? true
                                : someVisibleSelected
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(v) =>
                              toggleSelectAll(Boolean(v))
                            }
                            aria-label="انتخاب همه"
                          />
                        </TableHead>
                        <TableHead className="text-muted-foreground">کاربر</TableHead>
                        <TableHead className="text-muted-foreground">
                          نام کاربری
                        </TableHead>
                        <TableHead className="text-muted-foreground">نقش</TableHead>
                        <TableHead className="text-muted-foreground">وضعیت عضویت</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usersQuery.isLoading && (
                        <TableRow className="border-border hover:bg-transparent">
                          <TableCell
                            colSpan={5}
                            className="py-6 text-center text-muted-foreground"
                          >
                            در حال بارگذاری کاربران…
                          </TableCell>
                        </TableRow>
                      )}
                      {!usersQuery.isLoading &&
                        visibleUsers.length === 0 && (
                          <TableRow className="border-border hover:bg-transparent">
                            <TableCell
                              colSpan={5}
                              className="py-6 text-center text-muted-foreground"
                            >
                              کاربری یافت نشد
                            </TableCell>
                          </TableRow>
                        )}
                      {visibleUsers.map((u) => {
                        const isMember = memberIds.has(u.id);
                        return (
                          <TableRow
                            key={u.id}
                            className="border-border hover:bg-card"
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(u.id)}
                                onCheckedChange={(v) =>
                                  toggleUser(u.id, Boolean(v))
                                }
                                aria-label={`انتخاب ${u.fullName}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium text-foreground">
                              {u.fullName}
                            </TableCell>
                            <TableCell className="text-muted-foreground" dir="ltr">
                              {u.username}
                            </TableCell>
                            <TableCell>{userRoleBadge(u.role)}</TableCell>
                            <TableCell>
                              {isMember ? (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 gap-1"
                                >
                                  <CheckCheck className="size-3" />
                                  عضو کلاس
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground persian-nums">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} کاربر انتخاب شده`
                    : "هیچ کاربری انتخاب نشده"}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={handleBatchEnroll}
                    disabled={enrolling || selectedIds.size === 0}
                    className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    <CheckCheck className="size-4" />
                    {enrolling ? "در حال عضویت…" : "ثبت عضویت دسته‌ای"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmRemove(true)}
                    disabled={removing || selectedIds.size === 0}
                    className="gap-2 border-red-500/40 bg-transparent text-red-500 hover:bg-red-500/10 hover:text-red-500"
                  >
                    <XCircle className="size-4" />
                    {removing ? "در حال حذف…" : "حذف از کلاس"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="حذف دسته‌ای اعضا"
        description={
          <>
            آیا از حذف{" "}
            <strong className="text-foreground persian-nums">
              {selectedIds.size}
            </strong>{" "}
            کاربر انتخاب‌شده از این کلاس مطمئن هستید؟
          </>
        }
        confirmText="حذف از کلاس"
        loading={removing}
        onConfirm={handleBatchRemoveConfirm}
      />
    </div>
  );
}
