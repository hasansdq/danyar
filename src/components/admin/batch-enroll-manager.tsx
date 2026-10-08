"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCheck,
  Search,
  UserPlus,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "next-auth/react";
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

interface ClassListItem {
  id: string;
  name: string;
  gradeLevel: string | null;
  studentCount: number;
  teacherCount: number;
}

interface ClassDetailData {
  id: string;
  name: string;
  memberships: Array<{ userId: string; role: string }>;
}

interface PaginatedClasses {
  items: ClassListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface UserListItem {
  id: string;
  username: string;
  fullName: string;
  role: string;
  phone: string | null;
  _count?: { memberships: number };
}

interface PaginatedUsers {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || "") + (parts[1][0] || "");
}

function roleBadge(role: string) {
  if (role === "ADMIN")
    return <Badge variant="default">مدیر</Badge>;
  if (role === "TEACHER")
    return <Badge variant="secondary">معلم</Badge>;
  return <Badge variant="outline">دانش‌آموز</Badge>;
}

export function BatchEnrollmentManager() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const qc = useQueryClient();

  // Fetch list of classes for the target-class dropdown.
  const { data: classesData, isLoading: classesLoading } =
    useQuery<PaginatedClasses>({
      queryKey: ["admin-classes-batch-standalone"],
      queryFn: () =>
        apiFetch<PaginatedClasses>("/api/admin/classes?page=1&pageSize=200"),
    });

  // Target class state — defaults to the first class in the list.
  const [targetClassId, setTargetClassId] = React.useState<string>("");

  React.useEffect(() => {
    if (!targetClassId && classesData?.items.length) {
      setTargetClassId(classesData.items[0].id);
    }
  }, [classesData, targetClassId]);

  // Fetch members of the target class to highlight existing members.
  const { data: targetClass } = useQuery<ClassDetailData>({
    queryKey: ["admin-class", targetClassId],
    queryFn: () => apiFetch<ClassDetailData>(`/api/admin/classes/${targetClassId}`),
    enabled: !!targetClassId,
  });

  // Fetch all users (page 1, large pageSize) for the batch enrollment list.
  const [userSearchInput, setUserSearchInput] = React.useState("");
  const [userSearch, setUserSearch] = React.useState("");
  const [userRoleFilter, setUserRoleFilter] = React.useState<
    "ALL" | "STUDENT" | "TEACHER"
  >("STUDENT");

  React.useEffect(() => {
    const t = setTimeout(() => setUserSearch(userSearchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [userSearchInput]);

  const userParams = new URLSearchParams({
    page: "1",
    pageSize: "200",
  });
  if (userRoleFilter !== "ALL") userParams.set("role", userRoleFilter);
  if (userSearch) userParams.set("search", userSearch);

  const { data: usersData, isLoading: usersLoading } = useQuery<PaginatedUsers>({
    queryKey: ["admin-users-batch", userRoleFilter, userSearch],
    queryFn: () =>
      apiFetch<PaginatedUsers>(`/api/admin/users?${userParams.toString()}`),
  });

  // Batch enrollment state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [enrollRole, setEnrollRole] = React.useState<"STUDENT" | "TEACHER">(
    "STUDENT",
  );
  const [enrolling, setEnrolling] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const memberIds = React.useMemo(
    () => new Set((targetClass?.memberships ?? []).map((m) => m.userId)),
    [targetClass],
  );

  const visibleUsers = usersData?.items ?? [];

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

  // Reset selection when target class changes
  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [targetClassId]);

  async function handleBatchEnroll() {
    if (!targetClassId) {
      toast({
        title: "ابتدا کلاس مقصد را انتخاب کنید",
        variant: "destructive",
      });
      return;
    }
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
      const result = await apiFetch<{
        newlyEnrolled: number;
        roleUpdated: number;
        alreadyEnrolled: number;
        invalidUserIds: string[];
      }>("/api/admin/enroll", {
        method: "POST",
        body: JSON.stringify({
          classId: targetClassId,
          userIds: Array.from(selectedIds),
          role: enrollRole,
        }),
      });
      const summary = `${result.newlyEnrolled} کاربر جدید عضو شدند، ${result.roleUpdated} نقش به‌روزرسانی شد، ${result.alreadyEnrolled} کاربر قبلاً عضو بوده‌اند`;
      toast({
        title: "عضویت دسته‌ای انجام شد",
        description: summary,
      });
      qc.invalidateQueries({ queryKey: ["admin-class", targetClassId] });
      qc.invalidateQueries({ queryKey: ["admin-classes"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
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
    if (selectedIds.size === 0 || !targetClassId) return;
    setRemoving(true);
    try {
      const result = await apiFetch<{ removed: number }>("/api/admin/enroll", {
        method: "DELETE",
        body: JSON.stringify({
          classId: targetClassId,
          userIds: Array.from(selectedIds),
        }),
      });
      toast({
        title: "حذف دسته‌ای انجام شد",
        description: `${result.removed} کاربر از کلاس حذف شدند`,
      });
      qc.invalidateQueries({ queryKey: ["admin-class", targetClassId] });
      qc.invalidateQueries({ queryKey: ["admin-classes"] });
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
      <div>
        <h2 className="text-2xl font-bold tracking-tight">عضویت دسته‌ای</h2>
        <p className="text-muted-foreground text-sm">
          کاربران را انتخاب کنید و به‌صورت گروهی در یک کلاس ثبت نام کنید یا
          از کلاس حذف نمایید.
        </p>
      </div>

      {/* Target class selection */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <Label htmlFor="targetClass" className="text-sm">
              کلاس مقصد
            </Label>
            {classesLoading ? (
              <Skeleton className="h-9 w-64" />
            ) : (
              <Select value={targetClassId} onValueChange={setTargetClassId}>
                <SelectTrigger id="targetClass" className="w-full sm:w-64">
                  <SelectValue placeholder="یک کلاس انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  {classesData?.items.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.gradeLevel ? ` (${c.gradeLevel})` : ""}
                    </SelectItem>
                  )) ?? null}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="enrollRole" className="text-sm">
              نقش عضویت
            </Label>
            <Select
              value={enrollRole}
              onValueChange={(v) => setEnrollRole(v as "STUDENT" | "TEACHER")}
            >
              <SelectTrigger id="enrollRole" className="w-full sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STUDENT">دانش‌آموز</SelectItem>
                <SelectItem value="TEACHER">معلم</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {targetClass && (
            <div className="flex flex-wrap items-end gap-2">
              <Badge variant="secondary" className="gap-1">
                <UserPlus className="size-3" />
                <span className="persian-nums">
                  {targetClass.memberships.filter((m) => m.role === "STUDENT").length}{" "}
                  دانش‌آموز
                </span>
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <span className="persian-nums">
                  {targetClass.memberships.filter((m) => m.role === "TEACHER").length}{" "}
                  معلم
                </span>
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Batch enrollment panel */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCheck className="text-primary size-5" />
            انتخاب کاربران
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                id="select-all"
                checked={
                  allVisibleSelected
                    ? true
                    : someVisibleSelected
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(v) => toggleSelectAll(!!v)}
              />
              <Label htmlFor="select-all" className="text-sm">
                انتخاب همه ({visibleUsers.length})
              </Label>
            </div>

            <div className="relative flex-1 sm:max-w-xs">
              <Search className="text-muted-foreground absolute right-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                placeholder="جستجوی کاربر..."
                value={userSearchInput}
                onChange={(e) => setUserSearchInput(e.target.value)}
                className="pr-10"
              />
            </div>

            <Select
              value={userRoleFilter}
              onValueChange={(v) =>
                setUserRoleFilter(v as "ALL" | "STUDENT" | "TEACHER")
              }
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="فیلتر نقش" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">همه نقش‌ها</SelectItem>
                <SelectItem value="STUDENT">دانش‌آموزان</SelectItem>
                <SelectItem value="TEACHER">معلمان</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <div className="text-sm">
              <span className="font-medium persian-nums">
                {selectedIds.size}
              </span>{" "}
              کاربر انتخاب شده
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleBatchEnroll}
                disabled={
                  enrolling || selectedIds.size === 0 || !targetClassId
                }
                className="gap-2"
              >
                <UserPlus className="size-4" />
                {enrolling ? "در حال ثبت..." : "عضویت دسته‌ای"}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setConfirmRemove(true)}
                disabled={
                  removing || selectedIds.size === 0 || !targetClassId
                }
                className="gap-2"
              >
                <XCircle className="size-4" />
                حذف دسته‌ای
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>نام</TableHead>
                <TableHead>نام کاربری</TableHead>
                <TableHead>نقش</TableHead>
                <TableHead>عضو این کلاس</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-10 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : visibleUsers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-muted-foreground py-8 text-center"
                  >
                    کاربری یافت نشد
                  </TableCell>
                </TableRow>
              ) : (
                visibleUsers.map((u) => {
                  const isMember = memberIds.has(u.id);
                  const isSelf = session?.user?.id === u.id;
                  return (
                    <TableRow
                      key={u.id}
                      data-state={selectedIds.has(u.id) ? "selected" : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(u.id)}
                          onCheckedChange={(v) => toggleUser(u.id, !!v)}
                          aria-label={`انتخاب ${u.fullName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                              {initials(u.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{u.fullName}</span>
                          {isSelf && (
                            <Badge variant="outline" className="text-[10px]">
                              شما
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.username}
                      </TableCell>
                      <TableCell>{roleBadge(u.role)}</TableCell>
                      <TableCell>
                        {isMember ? (
                          <Badge variant="default" className="gap-1">
                            <CheckCheck className="size-3" /> عضو
                          </Badge>
                        ) : (
                          <Badge variant="outline">غیرعضو</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="حذف دسته‌ای از کلاس"
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
