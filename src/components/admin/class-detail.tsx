"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCheck,
  School,
  Search,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
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
import {
  FileSettingsDialog,
  FileSettingsSummary,
} from "@/components/messenger/file-settings-dialog";
import type { FileSettings } from "@/components/messenger/types";
import { SlidersHorizontal } from "lucide-react";

interface MemberUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  phone: string | null;
}

interface Member {
  id: string;
  role: "STUDENT" | "TEACHER";
  createdAt: string;
  user: MemberUser;
}

interface ClassDetailData {
  id: string;
  name: string;
  description: string | null;
  gradeLevel: string | null;
  createdAt: string;
  updatedAt: string;
  memberships: Member[];
  studentCount: number;
  teacherCount: number;
  // Per-class file-upload settings (phase-3). Optional because older GET
  // responses may not include them yet; the form falls back to defaults.
  fileUploadEnabled?: boolean;
  maxFileSizeMb?: number;
  allowedFileTypes?: string[] | null;
}

interface ClassListItem {
  id: string;
  name: string;
  gradeLevel: string | null;
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

interface PaginatedClasses {
  items: ClassListItem[];
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

function memberRoleBadge(role: string) {
  return role === "TEACHER" ? (
    <Badge variant="secondary">معلم</Badge>
  ) : (
    <Badge variant="outline">دانش‌آموز</Badge>
  );
}

export function ClassDetail({ classId }: { classId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const enrollSectionRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to the enrollment section when navigated with ?tab=enroll
  React.useEffect(() => {
    if (searchParams.get("tab") !== "enroll") return;
    const t = setTimeout(() => {
      enrollSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
    return () => clearTimeout(t);
  }, [searchParams]);

  const { data: cls, isLoading, isError, error } = useQuery<ClassDetailData>({
    queryKey: ["admin-class", classId],
    queryFn: () => apiFetch<ClassDetailData>(`/api/admin/classes/${classId}`),
  });

  // Fetch all users (page 1, large pageSize) for the batch enrollment list.
  // We fetch up to 200 to keep the list manageable.
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

  const { data: usersData } = useQuery<PaginatedUsers>({
    queryKey: ["admin-users-batch", userRoleFilter, userSearch],
    queryFn: () =>
      apiFetch<PaginatedUsers>(`/api/admin/users?${userParams.toString()}`),
  });

  // Fetch list of classes for the target-class dropdown.
  const { data: classesData } = useQuery<PaginatedClasses>({
    queryKey: ["admin-classes-batch"],
    queryFn: () =>
      apiFetch<PaginatedClasses>("/api/admin/classes?page=1&pageSize=200"),
  });

  // Batch enrollment state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [targetClassId, setTargetClassId] = React.useState<string>(classId);
  const [enrollRole, setEnrollRole] = React.useState<"STUDENT" | "TEACHER">(
    "STUDENT",
  );
  const [enrolling, setEnrolling] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  // Per-class file-upload settings dialog (admin). The same FileSettingsDialog
  // is reused from the messenger, but with an `onSave` callback that hits
  // PATCH /api/admin/classes/[id] instead of the teacher endpoint.
  const [fileSettingsOpen, setFileSettingsOpen] = React.useState(false);

  // Reset target class when the route changes
  React.useEffect(() => {
    setTargetClassId(classId);
  }, [classId]);

  const memberIds = React.useMemo(
    () => new Set((cls?.memberships ?? []).map((m) => m.user.id)),
    [cls],
  );

  // Filtered list of users to render in the batch enrollment table.
  // Apply role filter + search via the API (we already passed the params above).
  const visibleUsers = usersData?.items ?? [];

  // Selection helpers
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
    if (!targetClassId) {
      toast({
        title: "کلاس مقصد را انتخاب کنید",
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
      // Invalidate queries for both the current class and the target class.
      qc.invalidateQueries({ queryKey: ["admin-class", classId] });
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
    if (selectedIds.size === 0) return;
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
      qc.invalidateQueries({ queryKey: ["admin-class", classId] });
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

  async function removeSingleMember(userId: string) {
    try {
      await apiFetch(`/api/admin/classes/${classId}/members/${userId}`, {
        method: "DELETE",
      });
      toast({
        title: "عضو حذف شد",
        description: "کاربر از کلاس حذف شد",
      });
      qc.invalidateQueries({ queryKey: ["admin-class", classId] });
      qc.invalidateQueries({ queryKey: ["admin-classes"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      toast({
        title: "خطا در حذف عضو",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  // -------------------- File-upload settings (phase 3) --------------------

  /**
   * onSave callback for the FileSettingsDialog. Hits PATCH /api/admin/classes/[id]
   * (NOT the teacher endpoint), sending only the file-settings fields. Maps
   * whatever shape the server returns back into the FileSettings contract
   * the dialog expects (with a graceful fallback to the input values if the
   * response omits the fields — keeps the UI robust to API drift).
   */
  async function handleSaveFileSettings(
    values: FileSettings,
  ): Promise<FileSettings> {
    const res = await apiFetch<{
      fileUploadEnabled?: boolean;
      maxFileSizeMb?: number;
      allowedFileTypes?: string[] | null;
    }>(`/api/admin/classes/${classId}`, {
      method: "PATCH",
      body: JSON.stringify({
        fileUploadEnabled: values.fileUploadEnabled,
        maxFileSizeMb: values.maxFileSizeMb,
        allowedFileTypes: values.allowedFileTypes,
      }),
    });
    return {
      fileUploadEnabled: res.fileUploadEnabled ?? values.fileUploadEnabled,
      maxFileSizeMb: res.maxFileSizeMb ?? values.maxFileSizeMb,
      allowedFileTypes: res.allowedFileTypes ?? values.allowedFileTypes,
    };
  }

  /**
   * After the dialog saves successfully, invalidate the admin-class query so
   * the summary card re-renders with the latest server snapshot.
   */
  function handleFileSettingsSaved() {
    qc.invalidateQueries({ queryKey: ["admin-class", classId] });
    qc.invalidateQueries({ queryKey: ["admin-classes"] });
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      <Link
        href="/admin/classes"
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
      >
        <ArrowRight className="size-4" />
        بازگشت به لیست کلاس‌ها
      </Link>

      {isError ? (
        <Card>
          <CardContent className="text-destructive p-6 text-center text-sm">
            خطا در بارگذاری کلاس: {(error as Error)?.message}
          </CardContent>
        </Card>
      ) : isLoading || !cls ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          {/* Class info header */}
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <School className="text-primary size-6" />
                    <h2 className="text-2xl font-bold tracking-tight">
                      {cls.name}
                    </h2>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {cls.description || "بدون توضیحات"}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {cls.gradeLevel && (
                      <Badge variant="outline">پایه: {cls.gradeLevel}</Badge>
                    )}
                    <Badge variant="secondary" className="gap-1">
                      <UserPlus className="size-3" />
                      <span className="persian-nums">
                        {cls.studentCount} دانش‌آموز
                      </span>
                    </Badge>
                    <Badge variant="secondary" className="gap-1">
                      <School className="size-3" />
                      <span className="persian-nums">
                        {cls.teacherCount} معلم
                      </span>
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* File-upload settings */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <SlidersHorizontal className="text-primary size-4" />
                    تنظیمات ارسال فایل
                  </CardTitle>
                  <p className="text-muted-foreground text-xs">
                    محدودیت ارسال فایل در گفتگوی این کلاس را برای اعضا تعیین
                    کنید. این تنظیمات فقط برای گفتگوی کلاس اعمال می‌شود.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 self-start sm:self-auto"
                  onClick={() => setFileSettingsOpen(true)}
                >
                  <SlidersHorizontal className="size-4" />
                  ویرایش تنظیمات
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <FileSettingsSummary
                settings={{
                  fileUploadEnabled: cls.fileUploadEnabled,
                  maxFileSizeMb: cls.maxFileSizeMb,
                  allowedFileTypes: cls.allowedFileTypes,
                }}
              />
            </CardContent>
          </Card>

          {/* Members table */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">اعضای کلاس</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>نام</TableHead>
                    <TableHead>نام کاربری</TableHead>
                    <TableHead>نقش در کلاس</TableHead>
                    <TableHead>نقش سیستمی</TableHead>
                    <TableHead>عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cls.memberships.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-muted-foreground py-8 text-center"
                      >
                        هیچ عضوی در این کلاس وجود ندارد
                      </TableCell>
                    </TableRow>
                  )}
                  {cls.memberships.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                              {initials(m.user.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {m.user.fullName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.user.username}
                      </TableCell>
                      <TableCell>{memberRoleBadge(m.role)}</TableCell>
                      <TableCell>{roleBadge(m.user.role)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive size-8"
                          onClick={() => removeSingleMember(m.user.id)}
                          aria-label="حذف عضو"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* BATCH ENROLLMENT SECTION */}
          <Card ref={enrollSectionRef} id="enroll">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCheck className="text-primary size-5" />
                عضویت دسته‌ای
              </CardTitle>
              <p className="text-muted-foreground text-xs">
                کاربران موردنظر را انتخاب کنید، سپس کلاس مقصد و نقش را مشخص
                کرده و روی «عضویت دسته‌ای» بزنید. همچنین می‌توانید با حذف دسته‌ای
                اعضای انتخاب‌شده را از کلاس خارج کنید.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 p-4">
              {/* Controls row */}
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
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

                  <div className="relative flex-1 sm:w-64">
                    <Search className="text-muted-foreground absolute right-3 top-1/2 size-4 -translate-y-1/2" />
                    <Input
                      placeholder="جستجوی کاربر..."
                      value={userSearchInput}
                      onChange={(e) => setUserSearchInput(e.target.value)}
                      className="pr-10 sm:w-64"
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

                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="targetClass" className="text-xs">
                      کلاس مقصد
                    </Label>
                    <Select
                      value={targetClassId}
                      onValueChange={(v) => setTargetClassId(v)}
                    >
                      <SelectTrigger id="targetClass" className="w-48">
                        <SelectValue />
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
                  </div>

                  <div className="flex flex-col gap-1">
                    <Label htmlFor="enrollRole" className="text-xs">
                      نقش عضویت
                    </Label>
                    <Select
                      value={enrollRole}
                      onValueChange={(v) =>
                        setEnrollRole(v as "STUDENT" | "TEACHER")
                      }
                    >
                      <SelectTrigger id="enrollRole" className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STUDENT">دانش‌آموز</SelectItem>
                        <SelectItem value="TEACHER">معلم</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Selection summary + actions */}
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
                    disabled={enrolling || selectedIds.size === 0}
                    className="gap-2"
                  >
                    <UserPlus className="size-4" />
                    {enrolling ? "در حال ثبت..." : "عضویت دسته‌ای"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmRemove(true)}
                    disabled={removing || selectedIds.size === 0}
                    className="gap-2"
                  >
                    <XCircle className="size-4" />
                    حذف دسته‌ای
                  </Button>
                </div>
              </div>

              {/* Users table with checkboxes */}
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
                  {visibleUsers.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-muted-foreground py-8 text-center"
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
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

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

      {/* File-upload settings dialog (admin variant — uses the admin
          classes PATCH endpoint instead of the teacher one). */}
      <FileSettingsDialog
        open={fileSettingsOpen}
        onOpenChange={setFileSettingsOpen}
        classLabel={cls?.name}
        initialSettings={
          cls
            ? {
                fileUploadEnabled: cls.fileUploadEnabled,
                maxFileSizeMb: cls.maxFileSizeMb,
                allowedFileTypes: cls.allowedFileTypes,
              }
            : null
        }
        onSave={handleSaveFileSettings}
        onSaved={handleFileSettingsSaved}
      />
    </div>
  );
}
