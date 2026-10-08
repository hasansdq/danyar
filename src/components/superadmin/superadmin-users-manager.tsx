"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  Crown,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserCircle,
  UserCog,
  LogIn,
  UserPlus,
  Loader2,
} from "lucide-react";
import {
  createSuperAdminUser,
  deleteSuperAdminUser,
  listSuperAdminUsers,
  updateSuperAdminUser,
  type SuperAdminRole,
  type SuperAdminUserListItem,
} from "@/lib/superadmin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AddToClassDialog } from "@/components/admin/add-to-class-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTablePagination } from "@/components/admin/data-table-pagination";
// Phase 36g fix — apiFetch was used in SchoolSelect/SchoolFilterSelect but
// not imported → school list never loaded → school selector showed nothing.
import { apiFetch } from "@/lib/api-fetch";

type RoleFilter = "ALL" | SuperAdminRole;

interface UserFormValues {
  username: string;
  password: string;
  fullName: string;
  role: SuperAdminRole;
  phone: string;
  schoolId: string;
}

const ROLE_LABEL: Record<SuperAdminRole, string> = {
  SUPERADMIN: "مدیر کل",
  ADMIN: "مدیر",
  TEACHER: "معلم",
  STUDENT: "دانش‌آموز",
};

/**
 * Role badge with color coding:
 *   STUDENT   = slate
 *   TEACHER   = teal
 *   ADMIN     = amber
 *   SUPERADMIN = emerald
 */
function roleBadge(role: SuperAdminRole) {
  switch (role) {
    case "SUPERADMIN":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 gap-1"
        >
          <Crown className="size-3" />
          {ROLE_LABEL[role]}
        </Badge>
      );
    case "ADMIN":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 text-amber-500 gap-1"
        >
          <UserCog className="size-3" />
          {ROLE_LABEL[role]}
        </Badge>
      );
    case "TEACHER":
      return (
        <Badge
          variant="outline"
          className="border-teal-500/40 bg-teal-500/10 text-teal-500"
        >
          {ROLE_LABEL[role]}
        </Badge>
      );
    case "STUDENT":
    default:
      return (
        <Badge
          variant="outline"
          className="border-border bg-muted text-foreground"
        >
          {ROLE_LABEL[role]}
        </Badge>
      );
  }
}

export function SuperAdminUsersManager() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const qc = useQueryClient();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [role, setRole] = React.useState<RoleFilter>("ALL");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  // Phase 36g — school filter for searching users by school.
  const [schoolFilter, setSchoolFilter] = React.useState<string>("ALL");

  // Debounce search
  React.useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["superadmin-users", page, pageSize, role, search, schoolFilter],
    queryFn: () =>
      listSuperAdminUsers({
        page,
        pageSize,
        role: role as any,
        search,
        schoolId: schoolFilter === "ALL" ? undefined : schoolFilter,
      }),
  });

  // Create / edit dialog state
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SuperAdminUserListItem | null>(
    null,
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState<UserFormValues>({
    username: "",
    password: "",
    fullName: "",
    role: "STUDENT",
    phone: "",
    schoolId: "",
  });

  // Delete state
  const [deleteTarget, setDeleteTarget] =
    React.useState<SuperAdminUserListItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // Batch selection + bulk-delete + add-to-class dialog state
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = React.useState<{
    done: number;
    total: number;
  }>({ done: 0, total: 0 });
  const [addToClassOpen, setAddToClassOpen] = React.useState(false);

  function openCreate() {
    setEditing(null);
    setForm({
      username: "",
      password: "",
      fullName: "",
      role: "STUDENT",
      phone: "",
      schoolId: "",
    });
    setFormOpen(true);
  }

  function openEdit(u: SuperAdminUserListItem) {
    setEditing(u);
    setForm({
      username: u.username,
      password: "",
      fullName: u.fullName,
      role: u.role,
      phone: u.phone || "",
      schoolId: u.school?.id || "",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const username = form.username.trim();
      const fullName = form.fullName.trim();
      if (!username || !fullName) {
        throw new Error("نام کاربری و نام کامل الزامی است");
      }
      if (editing) {
        const payload: Record<string, string> = { username, fullName, role: form.role };
        if (form.phone.trim()) payload.phone = form.phone.trim();
        if (form.password) payload.password = form.password;
        if (form.role !== "SUPERADMIN") payload.schoolId = form.schoolId;
        await updateSuperAdminUser(editing.id, payload);
        toast({
          title: "کاربر ویرایش شد",
          description: `اطلاعات ${fullName} به‌روزرسانی شد`,
        });
      } else {
        if (!form.password) {
          throw new Error("رمز عبور برای کاربر جدید الزامی است");
        }
        if (form.role !== "SUPERADMIN" && !form.schoolId) {
          throw new Error("انتخاب مدرسه برای این نقش الزامی است");
        }
        const created = await createSuperAdminUser({
          username,
          fullName,
          role: form.role,
          password: form.password,
          phone: form.phone.trim() || undefined,
          schoolId: form.role !== "SUPERADMIN" ? form.schoolId : undefined,
        } as any);
        toast({
          title: "کاربر ایجاد شد",
          description: `کاربر ${created.fullName} با موفقیت ایجاد شد`,
        });
      }
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["superadmin-users"] });
      qc.invalidateQueries({ queryKey: ["superadmin-stats"] });
    } catch (err) {
      toast({
        title: "خطا",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSuperAdminUser(deleteTarget.id);
      toast({
        title: "کاربر حذف شد",
        description: `کاربر ${deleteTarget.fullName} حذف شد`,
      });
      setDeleteTarget(null);
      // Make sure a just-deleted row is removed from the selection set.
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["superadmin-users"] });
      qc.invalidateQueries({ queryKey: ["superadmin-stats"] });
    } catch (err) {
      toast({
        title: "خطا در حذف",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  function toggleUser(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!data?.items?.length) return;
    const allOnPage = data.items.map((u) => u.id);
    const allSelected = allOnPage.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of allOnPage) next.delete(id);
      } else {
        for (const id of allOnPage) next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function openBulkAddToClass() {
    if (selected.size === 0) return;
    setAddToClassOpen(true);
  }

  function openSingleAddToClass(userId: string) {
    setSelected(new Set([userId]));
    setAddToClassOpen(true);
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    setBulkDeleteProgress({ done: 0, total: ids.length });
    let successCount = 0;
    let firstError: string | null = null;
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        try {
          await deleteSuperAdminUser(id);
          successCount++;
        } catch (err) {
          if (!firstError) firstError = (err as Error).message;
        }
        setBulkDeleteProgress({ done: i + 1, total: ids.length });
      }
      if (successCount > 0) {
        toast({
          title: "حذف گروهی انجام شد",
          description: `${successCount} از ${ids.length} کاربر حذف شد`,
        });
      }
      if (firstError) {
        toast({
          title: "برخی حذف‌ها ناموفق بود",
          description: firstError,
          variant: "destructive",
        });
      }
      clearSelection();
      setBulkDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ["superadmin-users"] });
      qc.invalidateQueries({ queryKey: ["superadmin-stats"] });
    } finally {
      setBulkDeleting(false);
      setBulkDeleteProgress({ done: 0, total: 0 });
    }
  }

  // Impersonation: the superadmin logs in as the target user (no password
  // needed). The backend sets a fresh next-auth session cookie for the target
  // user; we then redirect to the right landing page for that user's role.
  const router = useRouter();
  async function handleImpersonate(userId: string) {
    try {
      const res = await fetch(
        `/api/superadmin/impersonate/${userId}`,
        { method: "POST", credentials: "include" }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "خطا در ورود به عنوان کاربر");
      }
      toast({
        title: "ورود موفق",
        description: `به‌عنوان ${json.data?.fullName ?? "کاربر"} وارد شدید`,
      });
      // Redirect to the target user's landing page.
      router.push(json.data?.redirectTo ?? "/");
      router.refresh();
    } catch (err) {
      toast({
        title: "خطا در ورود",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  const currentUser = session?.user;

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            مدیریت کاربران
          </h2>
          <p className="text-sm text-muted-foreground">
            ایجاد، ویرایش و حذف کاربران سامانه — شامل مدیر کل و مدیر
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          <Plus className="size-4" />
          افزودن کاربر
        </Button>
      </header>

      {/* Batch action bar (sticky above the table) */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-30 flex flex-col gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 shadow-sm backdrop-blur animate-fade-in-up sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span className="bg-emerald-500 text-white rounded-full size-6 flex items-center justify-center text-xs font-semibold persian-nums">
              {selected.size}
            </span>
            <span>کاربر انتخاب شده</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={openBulkAddToClass}
              className="gap-2 border-emerald-500/40 bg-card text-foreground hover:bg-emerald-500/10 hover:text-emerald-600"
            >
              <UserPlus className="size-4" />
              افزودن به کلاس
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkDeleteOpen(true)}
              className="gap-2 border-red-500/40 bg-card text-red-500 hover:bg-red-500/10 hover:text-red-500"
            >
              <Trash2 className="size-4" />
              حذف گروهی
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="text-muted-foreground hover:text-foreground"
            >
              لغو انتخاب
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card className="border-border bg-card/40">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="جستجو بر اساس نام یا نام کاربری..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground pr-10 focus-visible:ring-emerald-500/40"
            />
          </div>
          {/* Phase 36g — school filter dropdown */}
          <SchoolFilterSelect
            value={schoolFilter}
            onChange={(v) => {
              setSchoolFilter(v);
              setPage(1);
            }}
          />
          <Select
            value={role}
            onValueChange={(v) => {
              setRole(v as RoleFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full border-border bg-background text-foreground focus:ring-emerald-500/40 sm:w-44">
              <SelectValue placeholder="فیلتر نقش" />
            </SelectTrigger>
            <SelectContent className="border-border bg-card text-foreground">
              <SelectItem value="ALL">همه نقش‌ها</SelectItem>
              <SelectItem value="STUDENT">دانش‌آموز</SelectItem>
              <SelectItem value="TEACHER">معلم</SelectItem>
              <SelectItem value="ADMIN">مدیر</SelectItem>
              <SelectItem value="SUPERADMIN">مدیر کل</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden border-border bg-card/40">
        <CardContent className="p-0">
          {isError ? (
            <div className="p-6 text-center text-sm text-red-500">
              خطا در بارگذاری کاربران: {(error as Error)?.message}
            </div>
          ) : isLoading ? (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <LazySkeleton
                  key={i}
                  className="h-12 w-full border border-border bg-card/60"
                />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="w-12 text-center text-muted-foreground px-4">
                      <Checkbox
                        aria-label="انتخاب همه"
                        checked={
                          !!data?.items?.length &&
                          data.items.every((u) => selected.has(u.id))
                        }
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead className="text-muted-foreground text-center">کاربر</TableHead>
                    <TableHead className="text-muted-foreground text-center">نام کاربری</TableHead>
                    <TableHead className="text-muted-foreground text-center">نقش</TableHead>
                    <TableHead className="text-muted-foreground text-center">مدرسه</TableHead>
                    <TableHead className="text-muted-foreground text-center">تلفن</TableHead>
                    <TableHead className="text-muted-foreground text-center">عضویت‌ها</TableHead>
                    <TableHead className="text-muted-foreground text-center">
                      عملیات
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.length === 0 && (
                    <TableRow className="border-border hover:bg-transparent">
                      <TableCell
                        colSpan={8}
                        className="py-8 text-center text-muted-foreground"
                      >
                        کاربری یافت نشد
                      </TableCell>
                    </TableRow>
                  )}
                  {data?.items.map((u) => {
                    const isSelf = currentUser?.id === u.id;
                    const isSuperAdmin = u.role === "SUPERADMIN";
                    const isChecked = selected.has(u.id);
                    return (
                      <TableRow
                        key={u.id}
                        data-state={isChecked ? "selected" : undefined}
                        className="border-border hover:bg-card"
                      >
                        <TableCell className="text-center px-4">
                          <Checkbox
                            aria-label={`انتخاب ${u.fullName}`}
                            checked={isChecked}
                            onCheckedChange={() => toggleUser(u.id)}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-center gap-2">
                              <span className="font-medium text-foreground">
                                {u.fullName}
                              </span>
                              {isSelf && (
                                <Badge
                                  variant="outline"
                                  className="border-border bg-muted text-[10px] text-foreground"
                                >
                                  شما
                                </Badge>
                              )}
                              {isSuperAdmin && (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-500 gap-1"
                                >
                                  <Crown className="size-3" />
                                  بالاترین دسترسی
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground" dir="ltr">
                          {u.username}
                        </TableCell>
                        <TableCell className="text-center">{roleBadge(u.role)}</TableCell>
                        {/* Phase 36i — school column */}
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {u.school?.name || "—"}
                        </TableCell>
                        <TableCell
                          className="text-center text-xs text-muted-foreground persian-nums"
                          dir="ltr"
                        >
                          {u.phone || "—"}
                        </TableCell>
                        <TableCell className="text-center persian-nums text-foreground">
                          {u._count?.memberships ?? 0}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
                              onClick={() => void handleImpersonate(u.id)}
                              disabled={isSelf}
                              aria-label="ورود با این کاربر"
                              title="ورود به حساب این کاربر (بدون رمز)"
                            >
                              <LogIn className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-teal-600 hover:bg-teal-500/10 hover:text-teal-600"
                              onClick={() => openSingleAddToClass(u.id)}
                              aria-label="افزودن به کلاس"
                              title="افزودن این کاربر به کلاس"
                            >
                              <UserPlus className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-foreground hover:bg-muted hover:text-emerald-500"
                              onClick={() => openEdit(u)}
                              aria-label="ویرایش"
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                              onClick={() => setDeleteTarget(u)}
                              disabled={isSelf}
                              aria-label="حذف"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {data && (
            <DataTablePagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Empty state */}
      {!isLoading && data && data.items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <UserCircle className="size-12 opacity-40" />
          <p>هیچ کاربری یافت نشد. می‌توانید کاربر جدید اضافه کنید.</p>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editing ? "ویرایش کاربر" : "افزودن کاربر جدید"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editing
                ? "رمز عبور را خالی بگذارید تا تغییر نکند."
                : "اطلاعات کاربر جدید را وارد کنید. می‌توانید نقش مدیر یا مدیر کل را نیز انتخاب کنید."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {editing && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                {editing.avatar ? (
                  <img
                    src={editing.avatar}
                    alt={editing.fullName}
                    className="size-16 rounded-full object-cover border-2 border-border"
                  />
                ) : (
                  <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 text-xl font-bold border-2 border-border">
                    {editing.fullName.charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {editing.fullName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate" dir="ltr">
                    @{editing.username}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    تصویر پروفایل کاربر
                  </p>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-foreground">
                نام و نام خانوادگی
              </Label>
              <Input
                id="fullName"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                required
                placeholder="مثال: علی رضایی"
                className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-emerald-500/40"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="username" className="text-foreground">
                  نام کاربری
                </Label>
                <Input
                  id="username"
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                  required
                  autoComplete="off"
                  dir="ltr"
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground text-left focus-visible:ring-emerald-500/40"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-foreground">
                  رمز عبور
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  placeholder={editing ? "بدون تغییر" : "حداقل ۴ کاراکتر"}
                  required={!editing}
                  autoComplete="new-password"
                  dir="ltr"
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground text-left focus-visible:ring-emerald-500/40"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="role" className="text-foreground">
                  نقش
                </Label>
                <Select
                  value={form.role}
                  onValueChange={(v) =>
                    setForm({ ...form, role: v as SuperAdminRole })
                  }
                >
                  <SelectTrigger
                    id="role"
                    className="border-border bg-background text-foreground focus:ring-emerald-500/40"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-card text-foreground">
                    <SelectItem value="STUDENT">دانش‌آموز</SelectItem>
                    <SelectItem value="TEACHER">معلم</SelectItem>
                    <SelectItem value="ADMIN">مدیر</SelectItem>
                    <SelectItem value="SUPERADMIN">مدیر کل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone" className="text-foreground">
                  تلفن (اختیاری)
                </Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="09123456789"
                  inputMode="tel"
                  dir="ltr"
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground text-left focus-visible:ring-emerald-500/40"
                />
              </div>
            </div>
            {/* Phase 23 — school selector (required for non-SUPERADMIN) */}
            {form.role !== "SUPERADMIN" ? (
              <div className="flex flex-col gap-2">
                <Label className="text-foreground">
                  مدرسه <span className="text-destructive">*</span>
                </Label>
                <SchoolSelect
                  value={form.schoolId}
                  onChange={(v) => setForm({ ...form, schoolId: v })}
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={submitting}
                className="border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground"
              >
                انصراف
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {submitting
                  ? "در حال ذخیره..."
                  : editing
                    ? "ذخیره تغییرات"
                    : "ایجاد کاربر"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm (single) */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف کاربر"
        description={
          deleteTarget ? (
            <>
              آیا از حذف کاربر{" "}
              <strong className="text-foreground">
                {deleteTarget.fullName}
              </strong>{" "}
              با نام کاربری{" "}
              <strong className="text-foreground" dir="ltr">
                {deleteTarget.username}
              </strong>{" "}
              مطمئن هستید؟ این عملیات قابل بازگشت نیست.
            </>
          ) : (
            ""
          )
        }
        confirmText="حذف"
        loading={deleting}
        onConfirm={handleDelete}
      />

      {/* Bulk delete confirm */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => !o && !bulkDeleting && setBulkDeleteOpen(false)}
        title="حذف گروهی کاربران"
        description={
          <>
            آیا از حذف{" "}
            <strong className="text-foreground persian-nums">
              {selected.size}
            </strong>{" "}
            کاربر انتخاب‌شده مطمئن هستید؟ این عملیات قابل بازگشت است و حذف‌ها
            یکی‌یکی انجام می‌شود.
            {bulkDeleting && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                {bulkDeleting && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                <span className="persian-nums">
                  {bulkDeleteProgress.done} از {bulkDeleteProgress.total}
                </span>
              </div>
            )}
          </>
        }
        confirmText="حذف گروهی"
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
      />

      {/* Add to class dialog (shared: batch + single).
          The dialog is fed by `Array.from(selected)` — for the per-user
          icon we pre-seed selected with that single id, so the dialog
          works in both modes. `onSuccess` clears the synthetic selection
          so the sticky batch bar doesn't pop up after closing. */}
      <AddToClassDialog
        open={addToClassOpen}
        onOpenChange={(o) => setAddToClassOpen(o)}
        userIds={Array.from(selected)}
        enrollApiBase="/api/superadmin/enroll"
        classesApiBase="/api/superadmin/classes"
        invalidateKeys={[["superadmin-users"], ["superadmin-stats"]]}
        onSuccess={() => {
          clearSelection();
        }}
      />
    </div>
  );
}

// --- School selector sub-component ---
function SchoolSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: schools } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["all-schools"],
    // Phase 36g fix — the schools API returns a paginated { items, total, ... }
    // object (after apiFetch unwraps the { data: ... } envelope). Extract
    // the `.items` array so .map works.
    queryFn: async () => {
      const res = await apiFetch<{ items: { id: string; name: string }[] }>("/api/superadmin/schools?pageSize=100");
      return res.items;
    },
  });
  return (
    <Select value={value || "none"} onValueChange={onChange}>
      <SelectTrigger className="border-border bg-background text-foreground focus:ring-emerald-500/40">
        <SelectValue placeholder="انتخاب مدرسه..." />
      </SelectTrigger>
      <SelectContent className="border-border bg-card text-foreground">
        {schools?.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Phase 36g — School filter for the users list. Same as SchoolSelect but
// includes an "All schools" option at the top (value="ALL").
function SchoolFilterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: schools } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["all-schools"],
    queryFn: async () => {
      const res = await apiFetch<{ items: { id: string; name: string }[] }>("/api/superadmin/schools?pageSize=100");
      return res.items;
    },
  });
  return (
    <Select value={value || "ALL"} onValueChange={onChange}>
      <SelectTrigger className="w-full border-border bg-background text-foreground focus:ring-emerald-500/40 sm:w-48">
        <SelectValue placeholder="فیلتر مدرسه" />
      </SelectTrigger>
      <SelectContent className="border-border bg-card text-foreground">
        <SelectItem value="ALL">همه مدارس</SelectItem>
        {schools?.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
