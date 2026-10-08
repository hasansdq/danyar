"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  Crown,
  GraduationCap,
  MapPin,
  School,
  Search,
  UserCog,
  Users as UsersIcon,
  Video,
} from "lucide-react";
import {
  assignPrincipal,
  fetchSchool,
  fetchSchoolMembers,
  listSuperAdminUsers,
  updateSchool,
  type SuperAdminSchoolDetail as SchoolDetailData,
  type SuperAdminSchoolMembers,
  type SuperAdminSchoolUserSummary,
  type SuperAdminUserListItem,
} from "@/lib/superadmin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/admin/data-table-pagination";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || "") + (parts[1][0] || "");
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

interface SuperAdminSchoolDetailProps {
  schoolId: string;
}

export function SuperAdminSchoolDetail({
  schoolId,
}: SuperAdminSchoolDetailProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const {
    data: school,
    isLoading: schoolLoading,
    isError: schoolError,
    error: schoolErr,
  } = useQuery<SchoolDetailData>({
    queryKey: ["superadmin-school", schoolId],
    queryFn: () => fetchSchool(schoolId),
  });

  const {
    data: members,
    isLoading: membersLoading,
    isError: membersError,
    error: membersErr,
  } = useQuery<SuperAdminSchoolMembers>({
    queryKey: ["superadmin-school-members", schoolId],
    queryFn: () => fetchSchoolMembers(schoolId),
  });

  // Assign principal dialog state
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignUserId, setAssignUserId] = React.useState<string>("");
  const [assigning, setAssigning] = React.useState(false);
  const [assignSearchInput, setAssignSearchInput] = React.useState("");

  const assignSearch = assignSearchInput.trim() || undefined;
  const { data: adminsData, isLoading: adminsLoading } = useQuery({
    queryKey: ["superadmin-schools-admins", schoolId, assignSearch],
    queryFn: () =>
      listSuperAdminUsers({
        page: 1,
        pageSize: 100,
        role: "ADMIN",
        search: assignSearch,
      }),
    enabled: assignOpen,
  });

  // Students pagination (20 per page).
  const [studentsPage, setStudentsPage] = React.useState(1);
  const studentsPageSize = 20;
  const studentsTotal = members?.students.length ?? 0;
  const studentsTotalPages = Math.max(
    1,
    Math.ceil(studentsTotal / studentsPageSize),
  );
  const studentsToShow =
    members?.students.slice(
      (studentsPage - 1) * studentsPageSize,
      studentsPage * studentsPageSize,
    ) ?? [];
  React.useEffect(() => {
    // Reset page if it goes out of range after a refetch.
    if (studentsPage > studentsTotalPages) setStudentsPage(1);
  }, [studentsPage, studentsTotalPages]);

  function openAssign() {
    setAssignUserId(school?.principalId ?? "");
    setAssignSearchInput("");
    setAssignOpen(true);
  }

  async function handleAssign() {
    if (!school || !assignUserId) return;
    setAssigning(true);
    try {
      await assignPrincipal(school.id, assignUserId);
      const admin = adminsData?.items.find((u) => u.id === assignUserId);
      toast({
        title: "مدیر مدرسه تعیین شد",
        description: admin
          ? `${admin.fullName} به‌عنوان مدیر مدرسه ${school.name} تعیین شد`
          : `مدیر مدرسه ${school.name} به‌روزرسانی شد`,
      });
      setAssignOpen(false);
      qc.invalidateQueries({ queryKey: ["superadmin-school", schoolId] });
      qc.invalidateQueries({
        queryKey: ["superadmin-school-members", schoolId],
      });
      qc.invalidateQueries({ queryKey: ["superadmin-schools"] });
    } catch (err) {
      toast({
        title: "خطا در تعیین مدیر",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setAssigning(false);
    }
  }

  if (schoolError) {
    return (
      <div className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              جزئیات مدرسه
            </h2>
            <p className="text-sm text-muted-foreground">
              خطا در بارگذاری اطلاعات مدرسه
            </p>
          </div>
        </header>
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <p className="text-sm text-red-500">
            {(schoolErr as Error)?.message || "خطای ناشناخته"}
          </p>
        </div>
      </div>
    );
  }

  if (schoolLoading || !school) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40 border border-border bg-card/60" />
        <Skeleton className="h-32 w-full border border-border bg-card/60" />
        <Skeleton className="h-64 w-full border border-border bg-card/60" />
        <Skeleton className="h-64 w-full border border-border bg-card/60" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      {/* Back link */}
      <Link
        href="/superadmin/schools"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-emerald-500"
      >
        <ArrowRight className="size-4" />
        بازگشت به فهرست مدارس
      </Link>

      {/* School header */}
      <Card className="border-border bg-card/40">
        <CardHeader className="flex flex-col gap-3 border-b border-border sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
              <Building2 className="size-6" />
            </div>
            <div className="flex flex-col">
              <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
                {school.name}
              </CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {school.address ? (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3" />
                    {school.address}
                  </span>
                ) : (
                  <span className="text-muted-foreground">بدون آدرس</span>
                )}
                <span className="text-muted-foreground">•</span>
                <span className="persian-nums">
                  ایجاد: {formatDate(school.createdAt)}
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="flex items-center gap-1 font-mono" dir="ltr">
                  <span className="text-[10px] text-muted-foreground/70">شناسه یکتا:</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">{school.id}</code>
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-teal-500/40 bg-teal-500/10 text-teal-500 gap-1"
            >
              <School className="size-3" />
              <span>معلمان: </span>
              <span className="persian-nums">
                {members?.teachers.length ?? school.teacherCount}
              </span>
            </Badge>
            <Badge
              variant="outline"
              className="border-border bg-muted text-foreground gap-1"
            >
              <UsersIcon className="size-3" />
              <span>دانش‌آموزان: </span>
              <span className="persian-nums">
                {members?.students.length ?? school.studentCount}
              </span>
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Phase 35b — streaming (online class) toggle for this school. */}
      <Card className="border-border bg-card/40">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Video className="size-4 text-emerald-500" />
            کلاس آنلاین (استریم)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              {school.streamingEnabled ? "فعال" : "غیرفعال"}
            </p>
            <p className="text-xs text-muted-foreground">
              وقتی غیرفعال باشد، کل استریم در این مدرسه غیرفعال می‌شود و
              دکمه و آیکون استریم برای هیچ گروهی نمایان نمی‌شود.
            </p>
          </div>
          <Switch
            checked={school.streamingEnabled}
            onCheckedChange={async (checked) => {
              try {
                await updateSchool(school.id, { streamingEnabled: checked });
                qc.invalidateQueries({ queryKey: ["school", school.id] });
                qc.invalidateQueries({ queryKey: ["schools"] });
                toast({
                  title: checked
                    ? "استریم برای این مدرسه فعال شد"
                    : "استریم برای این مدرسه غیرفعال شد",
                });
              } catch (err) {
                toast({
                  title: "خطا",
                  description: (err as Error).message,
                  variant: "destructive",
                });
              }
            }}
          />
        </CardContent>
      </Card>

      {/* Principal section */}
      <Card className="border-border bg-card/40">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Crown className="size-4 text-amber-500" />
            مدیر مدرسه
            <Badge
              variant="outline"
              className="border-border bg-muted/40 text-foreground persian-nums"
            >
              {members?.principal ? "۱" : "۰"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {membersLoading ? (
            <Skeleton className="h-16 w-full border border-border bg-card/60" />
          ) : membersError ? (
            <p className="text-sm text-red-500">
              خطا در بارگذاری مدیر: {(membersErr as Error)?.message}
            </p>
          ) : members?.principal ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-amber-500/10 text-sm font-semibold text-amber-500">
                    {initials(members.principal.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">
                    {members.principal.fullName}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span dir="ltr">@{members.principal.username}</span>
                    {members.principal.phone ? (
                      <span className="persian-nums" dir="ltr">
                        {members.principal.phone}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="border-amber-500/40 bg-amber-500/10 text-amber-500 gap-1"
                >
                  <UserCog className="size-3" />
                  مدیر مدرسه
                </Badge>
              </div>
              <Button
                variant="outline"
                onClick={openAssign}
                className="border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground"
              >
                <Crown className="size-4 text-amber-500" />
                تغییر مدیر
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 text-muted-foreground">
                <UserCog className="size-8 opacity-60" />
                <p className="text-sm">
                  این مدرسه هنوز مدیر ندارد. یک کاربر با نقش مدیر را تعیین
                  کنید.
                </p>
              </div>
              <Button
                onClick={openAssign}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
              >
                <Crown className="size-4" />
                تعیین مدیر
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Teachers section */}
      <Card className="overflow-hidden border-border bg-card/40">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            <School className="size-4 text-teal-500" />
            معلمان
            <Badge
              variant="outline"
              className="border-teal-500/40 bg-teal-500/10 text-teal-500 persian-nums"
            >
              {members?.teachers.length ?? 0}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {membersLoading ? (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-12 w-full border border-border bg-card/60"
                />
              ))}
            </div>
          ) : membersError ? (
            <p className="p-4 text-sm text-red-500">
              خطا در بارگذاری معلمان: {(membersErr as Error)?.message}
            </p>
          ) : !members || members.teachers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <School className="size-10 opacity-40" />
              <p className="text-sm">
                هیچ معلمی در این مدرسه ثبت نشده است. مدیر مدرسه می‌تواند از پنل
                مدیریت خود معلمان را اضافه کند.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">نام</TableHead>
                    <TableHead className="text-muted-foreground">
                      نام کاربری
                    </TableHead>
                    <TableHead className="text-muted-foreground">تلفن</TableHead>
                    <TableHead className="text-muted-foreground">تاریخ عضویت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.teachers.map((t: SuperAdminSchoolUserSummary) => (
                    <TableRow
                      key={t.id}
                      className="border-border hover:bg-card"
                    >
                      <TableCell className="font-medium text-foreground">
                        {t.fullName}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground"
                        dir="ltr"
                      >
                        @{t.username}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground persian-nums">
                        {t.phone || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground persian-nums">
                        {formatDate(t.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Students section */}
      <Card className="overflow-hidden border-border bg-card/40">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            <GraduationCap className="size-4 text-foreground" />
            دانش‌آموزان
            <Badge
              variant="outline"
              className="border-border bg-muted text-foreground persian-nums"
            >
              {members?.students.length ?? 0}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {membersLoading ? (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-12 w-full border border-border bg-card/60"
                />
              ))}
            </div>
          ) : membersError ? (
            <p className="p-4 text-sm text-red-500">
              خطا در بارگذاری دانش‌آموزان: {(membersErr as Error)?.message}
            </p>
          ) : !members || members.students.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <GraduationCap className="size-10 opacity-40" />
              <p className="text-sm">
                هیچ دانش‌آموزی در این مدرسه ثبت نشده است. مدیر مدرسه می‌تواند
                از پنل مدیریت خود دانش‌آموزان را اضافه کند.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground">نام</TableHead>
                      <TableHead className="text-muted-foreground">
                        نام کاربری
                      </TableHead>
                      <TableHead className="text-muted-foreground">تلفن</TableHead>
                      <TableHead className="text-muted-foreground">
                        تاریخ عضویت
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {studentsToShow.map(
                      (s: SuperAdminSchoolUserSummary) => (
                        <TableRow
                          key={s.id}
                          className="border-border hover:bg-card"
                        >
                          <TableCell className="font-medium text-foreground">
                            {s.fullName}
                          </TableCell>
                          <TableCell
                            className="text-muted-foreground"
                            dir="ltr"
                          >
                            @{s.username}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground persian-nums">
                            {s.phone || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground persian-nums">
                            {formatDate(s.createdAt)}
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                  </TableBody>
                </Table>
              </div>
              <DataTablePagination
                page={studentsPage}
                pageSize={studentsPageSize}
                total={studentsTotal}
                totalPages={studentsTotalPages}
                onPageChange={setStudentsPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Assign Principal Dialog */}
      <Dialog
        open={assignOpen}
        onOpenChange={(o) => !o && setAssignOpen(false)}
      >
        <DialogContent className="border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {members?.principal ? "تغییر مدیر مدرسه" : "تعیین مدیر مدرسه"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              یک کاربر با نقش مدیر را برای مدیریت مدرسه {school.name} انتخاب
              کنید.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="جستجوی مدیر..."
                value={assignSearchInput}
                onChange={(e) => setAssignSearchInput(e.target.value)}
                className="border-border bg-background pr-10 text-foreground placeholder:text-muted-foreground focus-visible:ring-emerald-500/40"
              />
            </div>

            {adminsLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="h-12 w-full border border-border bg-card/60"
                  />
                ))}
              </div>
            ) : adminsData && adminsData.items.length > 0 ? (
              <div className="max-h-72 overflow-y-auto scrollbar-rtl flex flex-col gap-2">
                {adminsData.items.map((u: SuperAdminUserListItem) => {
                  const selected = assignUserId === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setAssignUserId(u.id)}
                      className={`flex items-center gap-3 rounded-lg border p-2 text-right transition-colors ${
                        selected
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-border bg-background/40 hover:border-border hover:bg-card"
                      }`}
                    >
                      <Avatar>
                        <AvatarFallback className="bg-amber-500/10 text-xs font-semibold text-amber-500">
                          {initials(u.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-1 flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {u.fullName}
                        </span>
                        <span
                          className="text-xs text-muted-foreground"
                          dir="ltr"
                        >
                          @{u.username}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 bg-amber-500/10 text-amber-500 gap-1"
                      >
                        <UserCog className="size-3" />
                        مدیر
                      </Badge>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                <UserCog className="size-8 opacity-40" />
                <p className="text-sm">
                  کاربر مدری یافت نشد. ابتدا یک کاربر با نقش مدیر در بخش
                  «کاربران» ایجاد کنید.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAssignOpen(false)}
              disabled={assigning}
              className="border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground"
            >
              انصراف
            </Button>
            <Button
              type="button"
              disabled={assigning || !assignUserId}
              onClick={handleAssign}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {assigning ? "در حال ذخیره..." : "تعیین مدیر"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
