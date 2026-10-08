"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  Pencil,
  Plus,
  School,
  Search,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import {
  createSuperAdminClass,
  deleteSuperAdminClass,
  listSuperAdminClasses,
  updateSuperAdminClass,
  type SuperAdminClassListItem,
} from "@/lib/superadmin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Badge } from "@/components/ui/badge";
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

interface ClassFormValues {
  name: string;
  description: string;
  gradeLevel: string;
  section: string;
}

export function SuperAdminClassesManager() {
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
    queryKey: ["superadmin-classes", page, pageSize, search],
    queryFn: () => listSuperAdminClasses({ page, pageSize, search }),
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] =
    React.useState<SuperAdminClassListItem | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState<ClassFormValues>({
    name: "",
    description: "",
    gradeLevel: "",
    section: "",
  });

  const [deleteTarget, setDeleteTarget] =
    React.useState<SuperAdminClassListItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", description: "", gradeLevel: "", section: "" });
    setFormOpen(true);
  }

  function openEdit(c: SuperAdminClassListItem) {
    setEditing(c);
    setForm({
      name: c.name,
      description: c.description || "",
      gradeLevel: c.gradeLevel || "",
      section: c.section || "",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const name = form.name.trim();
      if (!name) throw new Error("نام کلاس الزامی است");
      const payload = {
        name,
        description: form.description.trim() || null,
        gradeLevel: form.gradeLevel.trim() || null,
        section: form.section.trim() || null,
      };
      if (editing) {
        await updateSuperAdminClass(editing.id, payload);
        toast({
          title: "کلاس ویرایش شد",
          description: `کلاس ${payload.name} به‌روزرسانی شد`,
        });
      } else {
        await createSuperAdminClass(payload);
        toast({
          title: "کلاس ایجاد شد",
          description: `کلاس ${payload.name} با موفقیت ایجاد شد`,
        });
      }
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["superadmin-classes"] });
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
      await deleteSuperAdminClass(deleteTarget.id);
      toast({
        title: "کلاس حذف شد",
        description: `کلاس ${deleteTarget.name} حذف شد`,
      });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["superadmin-classes"] });
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

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            مدیریت کلاس‌ها
          </h2>
          <p className="text-sm text-muted-foreground">
            ایجاد، ویرایش و مدیریت کلاس‌های آموزشی — با بخش (section)
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          <Plus className="size-4" />
          ایجاد کلاس
        </Button>
      </header>

      <Card className="border-border bg-card/40">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="جستجو بر اساس نام یا توضیحات کلاس..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground pr-10 focus-visible:ring-emerald-500/40"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border bg-card/40">
        <CardContent className="p-0">
          {isError ? (
            <div className="p-6 text-center text-sm text-red-500">
              خطا در بارگذاری کلاس‌ها: {(error as Error)?.message}
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
                    <TableHead className="text-muted-foreground">نام کلاس</TableHead>
                    <TableHead className="text-muted-foreground">شناسه یکتا</TableHead>
                    <TableHead className="text-muted-foreground">پایه</TableHead>
                    <TableHead className="text-muted-foreground">بخش</TableHead>
                    <TableHead className="text-muted-foreground">توضیحات</TableHead>
                    <TableHead className="text-muted-foreground">دانش‌آموزان</TableHead>
                    <TableHead className="text-muted-foreground">معلمان</TableHead>
                    <TableHead className="text-muted-foreground text-left">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.length === 0 && (
                    <TableRow className="border-border hover:bg-transparent">
                      <TableCell
                        colSpan={8}
                        className="py-8 text-center text-muted-foreground"
                      >
                        کلاسی یافت نشد
                      </TableCell>
                    </TableRow>
                  )}
                  {data?.items.map((c) => (
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
                      <TableCell>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground" dir="ltr">
                          {c.id}
                        </code>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.gradeLevel || "—"}
                      </TableCell>
                      <TableCell>
                        {c.section ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                          >
                            بخش {c.section}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                        {c.description || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="border-teal-500/40 bg-teal-500/10 text-teal-500 gap-1"
                        >
                          <UsersIcon className="size-3" />
                          <span className="persian-nums">{c.studentCount}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 text-amber-500 gap-1"
                        >
                          <School className="size-3" />
                          <span className="persian-nums">{c.teacherCount}</span>
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
                            <Link href={`/superadmin/classes/${c.id}`}>
                              <Eye className="size-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-foreground hover:bg-muted hover:text-emerald-500"
                            onClick={() => openEdit(c)}
                            aria-label="ویرایش"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                            onClick={() => setDeleteTarget(c)}
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
          <School className="size-12 opacity-40" />
          <p>هیچ کلاسی یافت نشد. می‌توانید کلاس جدید ایجاد کنید.</p>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editing ? "ویرایش کلاس" : "ایجاد کلاس جدید"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editing
                ? "اطلاعات کلاس را به‌روز کنید."
                : "اطلاعات کلاس جدید را وارد کنید. فیلد «بخش» اختیاری است."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="className" className="text-foreground">
                نام کلاس
              </Label>
              <Input
                id="className"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="مثال: کلاس دهم ریاضی"
                className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-emerald-500/40"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="gradeLevel" className="text-foreground">
                  پایه تحصیلی
                </Label>
                <Input
                  id="gradeLevel"
                  value={form.gradeLevel}
                  onChange={(e) =>
                    setForm({ ...form, gradeLevel: e.target.value })
                  }
                  placeholder="مثال: پایه دهم"
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-emerald-500/40"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="section" className="text-foreground">
                  بخش (اختیاری)
                </Label>
                <Input
                  id="section"
                  value={form.section}
                  onChange={(e) =>
                    setForm({ ...form, section: e.target.value })
                  }
                  placeholder="مثال: الف"
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-emerald-500/40"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description" className="text-foreground">
                توضیحات (اختیاری)
              </Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="توضیحاتی درباره این کلاس..."
                rows={3}
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
                    : "ایجاد کلاس"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف کلاس"
        description={
          deleteTarget ? (
            <>
              آیا از حذف کلاس{" "}
              <strong className="text-foreground">{deleteTarget.name}</strong>{" "}
              مطمئن هستید؟ همه عضویت‌ها، پیام‌ها، تکالیف و نمرات این کلاس نیز
              حذف خواهند شد.
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
