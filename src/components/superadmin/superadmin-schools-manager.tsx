"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Crown,
  Eye,
  MapPin,
  Pencil,
  Plus,
  School,
  Search,
  Trash2,
  UserCog,
  Users as UsersIcon,
} from "lucide-react";
import {
  assignPrincipal,
  createSchool,
  deleteSchool,
  fetchSchools,
  listSuperAdminUsers,
  updateSchool,
  type SuperAdminSchoolListItem,
  type SuperAdminUserListItem,
} from "@/lib/superadmin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

interface SchoolFormValues {
  name: string;
  address: string;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || "") + (parts[1][0] || "");
}

export function SuperAdminSchoolsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["superadmin-schools", page, pageSize, search],
    queryFn: () => fetchSchools({ page, pageSize, search }),
  });

  // Create / Edit dialog state
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] =
    React.useState<SuperAdminSchoolListItem | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState<SchoolFormValues>({
    name: "",
    address: "",
  });

  // Delete state
  const [deleteTarget, setDeleteTarget] =
    React.useState<SuperAdminSchoolListItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // Assign-principal dialog state
  const [assignTarget, setAssignTarget] =
    React.useState<SuperAdminSchoolListItem | null>(null);
  const [assignUserId, setAssignUserId] = React.useState<string>("");
  const [assigning, setAssigning] = React.useState(false);
  const [assignSearchInput, setAssignSearchInput] = React.useState("");

  // Load ADMIN users (paginated, search) — fetch a big page so the select can
  // show admins without a school OR the current principal for reassignment.
  const assignSearch = assignSearchInput.trim() || undefined;
  const { data: adminsData, isLoading: adminsLoading } = useQuery({
    queryKey: ["superadmin-schools-admins", assignSearch],
    queryFn: () =>
      listSuperAdminUsers({
        page: 1,
        pageSize: 100,
        role: "ADMIN",
        search: assignSearch,
      }),
    enabled: !!assignTarget,
  });

  function openCreate() {
    setEditing(null);
    setForm({ name: "", address: "" });
    setFormOpen(true);
  }

  function openEdit(s: SuperAdminSchoolListItem) {
    setEditing(s);
    setForm({ name: s.name, address: s.address || "" });
    setFormOpen(true);
  }

  function openAssign(s: SuperAdminSchoolListItem) {
    setAssignTarget(s);
    setAssignUserId(s.principalId ?? "");
    setAssignSearchInput("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const name = form.name.trim();
      if (!name) throw new Error("نام مدرسه الزامی است");
      const payload = {
        name,
        address: form.address.trim() || null,
      };
      if (editing) {
        await updateSchool(editing.id, payload);
        toast({
          title: "مدرسه ویرایش شد",
          description: `مدرسه ${payload.name} به‌روزرسانی شد`,
        });
      } else {
        await createSchool(payload);
        toast({
          title: "مدرسه ایجاد شد",
          description: `مدرسه ${payload.name} با موفقیت ایجاد شد`,
        });
      }
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["superadmin-schools"] });
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
      await deleteSchool(deleteTarget.id);
      toast({
        title: "مدرسه حذف شد",
        description: `مدرسه ${deleteTarget.name} حذف شد`,
      });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["superadmin-schools"] });
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

  async function handleAssign() {
    if (!assignTarget || !assignUserId) return;
    setAssigning(true);
    try {
      await assignPrincipal(assignTarget.id, assignUserId);
      const admin = adminsData?.items.find((u) => u.id === assignUserId);
      toast({
        title: "مدیر مدرسه تعیین شد",
        description: admin
          ? `${admin.fullName} به‌عنوان مدیر مدرسه ${assignTarget.name} تعیین شد`
          : `مدیر مدرسه ${assignTarget.name} به‌روزرسانی شد`,
      });
      setAssignTarget(null);
      qc.invalidateQueries({ queryKey: ["superadmin-schools"] });
      qc.invalidateQueries({ queryKey: ["superadmin-stats"] });
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

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            مدیریت مدارس
          </h2>
          <p className="text-sm text-muted-foreground">
            ایجاد، ویرایش و مدیریت مدارس — تعیین مدیر هر مدرسه
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
        >
          <Plus className="size-4" />
          ایجاد مدرسه
        </Button>
      </header>

      <Card className="border-border bg-card/40">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="جستجو بر اساس نام یا آدرس مدرسه..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="border-border bg-background pr-10 text-foreground placeholder:text-muted-foreground focus-visible:ring-emerald-500/40"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border bg-card/40">
        <CardContent className="p-0">
          {isError ? (
            <div className="p-6 text-center text-sm text-red-500">
              خطا در بارگذاری مدارس: {(error as Error)?.message}
            </div>
          ) : isLoading ? (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <LazySkeleton
                  key={i}
                  className="h-14 w-full border border-border bg-card/60"
                />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">نام مدرسه</TableHead>
                    <TableHead className="text-muted-foreground">آدرس</TableHead>
                    <TableHead className="text-muted-foreground">مدیر مدرسه</TableHead>
                    <TableHead className="text-muted-foreground">معلمان</TableHead>
                    <TableHead className="text-muted-foreground">دانش‌آموزان</TableHead>
                    <TableHead className="text-muted-foreground text-left">
                      عملیات
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.length === 0 && (
                    <TableRow className="border-border hover:bg-transparent">
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-muted-foreground"
                      >
                        مدرسه‌ای یافت نشد
                      </TableCell>
                    </TableRow>
                  )}
                  {data?.items.map((s) => (
                    <TableRow
                      key={s.id}
                      className="border-border hover:bg-card"
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/superadmin/schools/${s.id}`}
                          className="flex items-center gap-2 text-emerald-500 hover:underline"
                        >
                          <Building2 className="size-4" />
                          {s.name}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                        {s.address ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3 shrink-0" />
                            <span className="truncate">{s.address}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.principal ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 bg-amber-500/10 text-amber-500 gap-1"
                          >
                            <UserCog className="size-3" />
                            <span className="truncate max-w-[140px]">
                              {s.principal.fullName}
                            </span>
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-border bg-muted/40 text-muted-foreground"
                          >
                            بدون مدیر
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="border-teal-500/40 bg-teal-500/10 text-teal-500 gap-1"
                        >
                          <School className="size-3" />
                          <span className="persian-nums">{s.teacherCount}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="border-border bg-muted text-foreground gap-1"
                        >
                          <UsersIcon className="size-3" />
                          <span className="persian-nums">
                            {s.studentCount}
                          </span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            className="size-8 text-foreground hover:bg-muted hover:text-emerald-500"
                          >
                            <Link href={`/superadmin/schools/${s.id}`}>
                              <Eye className="size-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-foreground hover:bg-muted hover:text-amber-500"
                            onClick={() => openAssign(s)}
                            aria-label="تعیین مدیر"
                            title="تعیین / تغییر مدیر مدرسه"
                          >
                            <Crown className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-foreground hover:bg-muted hover:text-emerald-500"
                            onClick={() => openEdit(s)}
                            aria-label="ویرایش"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                            onClick={() => setDeleteTarget(s)}
                            aria-label="حذف"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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

      {!isLoading && data && data.items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <Building2 className="size-12 opacity-40" />
          <p>هیچ مدرسه‌ای یافت نشد. می‌توانید مدرسه جدید ایجاد کنید.</p>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editing ? "ویرایش مدرسه" : "ایجاد مدرسه جدید"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editing
                ? "اطلاعات مدرسه را به‌روز کنید."
                : "اطلاعات مدرسه جدید را وارد کنید. کاربران (معلمان و دانش‌آموزان) توسط مدیر همان مدرسه اضافه خواهند شد."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="schoolName" className="text-foreground">
                نام مدرسه
              </Label>
              <Input
                id="schoolName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="مثال: مدرسه شهید بهشتی"
                className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-emerald-500/40"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="schoolAddress" className="text-foreground">
                آدرس (اختیاری)
              </Label>
              <Input
                id="schoolAddress"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="مثال: تهران، خیابان ولیعصر، پلاک ۱۲"
                className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-emerald-500/40"
              />
            </div>
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
                    : "ایجاد مدرسه"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Principal Dialog */}
      <Dialog
        open={!!assignTarget}
        onOpenChange={(o) => !o && setAssignTarget(null)}
      >
        <DialogContent className="border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              تعیین مدیر مدرسه
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {assignTarget
                ? `یک کاربر با نقش مدیر را برای مدیریت مدرسه ${assignTarget.name} انتخاب کنید.`
                : "یک کاربر با نقش مدیر را انتخاب کنید."}
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
                  <LazySkeleton
                    key={i}
                    className="h-12 w-full border border-border bg-card/60"
                  />
                ))}
              </div>
            ) : adminsData && adminsData.items.length > 0 ? (
              <div className="flex flex-col gap-2">
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
                          {u.username}
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
              onClick={() => setAssignTarget(null)}
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

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف مدرسه"
        description={
          deleteTarget ? (
            <>
              آیا از حذف مدرسه{" "}
              <strong className="text-foreground">{deleteTarget.name}</strong>{" "}
              مطمئن هستید؟ معلمان، دانش‌آموزان و کلاس‌های این مدرسه از این
              مدرسه جدا می‌شوند (اما حذف نمی‌شوند). این عملیات قابل بازگشت
              نیست.
            </>
          ) : (
            ""
          )
        }
        confirmText="حذف"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
