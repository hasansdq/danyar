"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  School,
  Users as UsersIcon,
  Eye,
  UserPlus,
  Layers,
  Send,
  Loader2,
  ChevronLeft,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { toPersianDigits } from "@/components/messenger/persian";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTablePagination } from "@/components/admin/data-table-pagination";

interface SubjectGroup {
  id: string;
  name: string;
  section: string | null;
  createdAt: string;
  _count: { memberships: number };
}

interface ClassListItem {
  id: string;
  name: string;
  description: string | null;
  gradeLevel: string | null;
  createdAt: string;
  studentCount: number;
  teacherCount: number;
  groups: SubjectGroup[];
}

interface PaginatedClasses {
  items: ClassListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface ClassFormValues {
  name: string;
  description: string;
  gradeLevel: string;
}

export function ClassesManager() {
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

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) params.set("search", search);

  const { data, isLoading, isError, error } = useQuery<PaginatedClasses>({
    queryKey: ["admin-classes", page, pageSize, search],
    queryFn: () =>
      apiFetch<PaginatedClasses>(`/api/admin/classes?${params.toString()}`),
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ClassListItem | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState<ClassFormValues>({
    name: "",
    description: "",
    gradeLevel: "",
  });

  const [deleteTarget, setDeleteTarget] = React.useState<ClassListItem | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);

  // Phase 25 — the class row the principal clicked "manage subject groups"
  // on. The dialog is mounted once at the bottom of the component and
  // controlled by this state, so we don't render a dialog per row.
  const [manageGroupsTarget, setManageGroupsTarget] =
    React.useState<ClassListItem | null>(null);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", description: "", gradeLevel: "" });
    setFormOpen(true);
  }

  function openEdit(c: ClassListItem) {
    setEditing(c);
    setForm({
      name: c.name,
      description: c.description || "",
      gradeLevel: c.gradeLevel || "",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: {
        name: string;
        description?: string | null;
        gradeLevel?: string | null;
      } = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        gradeLevel: form.gradeLevel.trim() || null,
      };
      if (editing) {
        await apiFetch(`/api/admin/classes/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast({
          title: "کلاس ویرایش شد",
          description: `کلاس ${payload.name} به‌روزرسانی شد`,
        });
      } else {
        await apiFetch("/api/admin/classes", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({
          title: "کلاس ایجاد شد",
          description: `کلاس ${payload.name} با موفقیت ایجاد شد`,
        });
      }
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-classes"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
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
      await apiFetch(`/api/admin/classes/${deleteTarget.id}`, {
        method: "DELETE",
      });
      toast({
        title: "کلاس حذف شد",
        description: `کلاس ${deleteTarget.name} حذف شد`,
      });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-classes"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">مدیریت کلاس‌ها</h2>
          <p className="text-muted-foreground text-sm">
            ایجاد، ویرایش و مدیریت کلاس‌های آموزشی
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="size-4" />
          ایجاد کلاس
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="text-muted-foreground absolute right-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              placeholder="جستجو بر اساس نام یا توضیحات کلاس..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pr-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="text-destructive p-6 text-center text-sm">
              خطا در بارگذاری کلاس‌ها: {(error as Error)?.message}
            </div>
          ) : isLoading ? (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <LazySkeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نام کلاس</TableHead>
                  <TableHead>پایه تحصیلی</TableHead>
                  <TableHead>توضیحات</TableHead>
                  <TableHead>دانش‌آموزان</TableHead>
                  <TableHead>معلمان</TableHead>
                  <TableHead>گروه‌های درسی</TableHead>
                  <TableHead>عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-muted-foreground py-8 text-center"
                    >
                      کلاسی یافت نشد
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/admin/classes/${c.id}`}
                        className="text-primary font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {c.gradeLevel || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-xs truncate">
                      {c.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1">
                        <UsersIcon className="size-3" />
                        <span className="persian-nums">{c.studentCount}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        <School className="size-3" />
                        <span className="persian-nums">{c.teacherCount}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.groups.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="gap-1 bg-sky-500/10 text-sky-700 hover:bg-sky-500/10"
                        >
                          <UsersIcon className="size-3" />
                          {toPersianDigits(c.groups.length)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button asChild variant="ghost" size="icon" className="size-8" aria-label="مشاهده اعضا">
                          <Link href={`/admin/classes/${c.id}`}>
                            <Eye className="size-4" />
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="icon" className="size-8 text-primary" aria-label="عضویت دسته‌ای" title="عضویت دسته‌ای (افزودن معلم/دانش‌آموز)">
                          <Link href={`/admin/classes/${c.id}?tab=enroll`}>
                            <UserPlus className="size-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-sky-600 hover:bg-sky-500/10 hover:text-sky-600"
                          onClick={() => setManageGroupsTarget(c)}
                          aria-label="مدیریت گروه‌های درسی"
                          title="مدیریت گروه‌های درسی"
                        >
                          <Layers className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(c)}
                          aria-label="ویرایش"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive size-8"
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
        <div className="text-muted-foreground flex flex-col items-center gap-3 py-12">
          <School className="size-12 opacity-40" />
          <p>هیچ کلاسی یافت نشد. می‌توانید کلاس جدید ایجاد کنید.</p>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "ویرایش کلاس" : "ایجاد کلاس جدید"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "اطلاعات کلاس را به‌روز کنید."
                : "اطلاعات کلاس جدید را وارد کنید."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="className">نام کلاس</Label>
              <Input
                id="className"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="مثال: کلاس دهم ریاضی"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="gradeLevel">پایه تحصیلی</Label>
              <Input
                id="gradeLevel"
                value={form.gradeLevel}
                onChange={(e) =>
                  setForm({ ...form, gradeLevel: e.target.value })
                }
                placeholder="مثال: پایه دهم"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">توضیحات (اختیاری)</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="توضیحاتی درباره این کلاس..."
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={submitting}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={submitting}>
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
              مطمئن هستید؟ همه عضویت‌ها، پیام‌ها، تکالیف و نمرات این کلاس نیز حذف
              خواهند شد.
            </>
          ) : (
            ""
          )
        }
        confirmText="حذف"
        loading={deleting}
        onConfirm={handleDelete}
      />

      <ManageSubjectGroupsDialog
        classId={manageGroupsTarget?.id ?? null}
        className={manageGroupsTarget?.name ?? ""}
        groups={manageGroupsTarget?.groups ?? []}
        open={!!manageGroupsTarget}
        onOpenChange={(o) => !o && setManageGroupsTarget(null)}
      />
    </div>
  );
}

interface ManageSubjectGroupsDialogProps {
  classId: string | null;
  className: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: SubjectGroup[];
}

/**
 * Phase 25 — "Manage Subject Groups" dialog.
 *
 * Lets a school principal create a new subject-group chat (a ClassRoom row
 * with `parentClassId` set) inside a top-level class, and lists the existing
 * groups. Creating a group POSTs to `/api/teacher/create-group`, which
 * auto-enrolls the principal as TEACHER and every existing student of the
 * parent class as STUDENT (server-side, in one transaction). After success
 * we optimistically prepend the new group to the local list AND invalidate
 * the `admin-classes` query so the parent table's count badge refreshes.
 */
function ManageSubjectGroupsDialog({
  classId,
  className,
  open,
  onOpenChange,
  groups: initialGroups,
}: ManageSubjectGroupsDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [groupName, setGroupName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  // Local copy of the groups list so we can show optimistic updates right
  // after a successful create (the parent's `manageGroupsTarget` snapshot
  // would otherwise stay stale until the user closes & reopens the dialog).
  const [localGroups, setLocalGroups] =
    React.useState<SubjectGroup[]>(initialGroups);

  // Re-sync the local list + clear the input whenever the dialog is opened
  // or switched to a different class. We intentionally only depend on
  // `open` and `classId` so optimistic updates made after a successful
  // create are not clobbered by the parent re-rendering (the parent's
  // `manageGroupsTarget` snapshot would otherwise stay stale until the
  // user closes & reopens the dialog).
  React.useEffect(() => {
    if (open) {
      setLocalGroups(initialGroups);
      setGroupName("");
    }
  }, [open, classId]);

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!classId) return;
    const trimmed = groupName.trim();
    if (!trimmed) return;
    // Phase 25 — auto-naming pattern: the user types just the SUBJECT name
    // (e.g. "ریاضی"), and the actual group name becomes
    // "{subject} {className}" (e.g. "ریاضی هفتم 702"). This keeps group
    // names unique across classes (the ClassRoom.name @unique constraint
    // would otherwise clash on common subject names like "ریاضی") + makes
    // it obvious which class each group belongs to in the conversation list.
    const finalName = `${trimmed} ${className}`.trim();
    setSubmitting(true);
    try {
      const created = await apiFetch<{
        id: string;
        name: string;
        section: string | null;
        createdAt: string;
      }>("/api/teacher/create-group", {
        method: "POST",
        body: JSON.stringify({ parentClassId: classId, name: finalName }),
      });
      // Optimistic local update so the principal sees the new group
      // immediately. The member count starts at 1 (the principal
      // themselves, auto-enrolled as TEACHER) and will be corrected to the
      // server value the next time the dialog is reopened.
      setLocalGroups((prev) => [
        ...prev,
        {
          id: created.id,
          name: created.name,
          section: created.section,
          createdAt: created.createdAt,
          _count: { memberships: 1 },
        },
      ]);
      setGroupName("");
      toast({
        title: "گروه ایجاد شد",
        description: `گروه درسی «${created.name}» با موفقیت ایجاد شد`,
      });
      // Refresh the parent classes table so the "گروه‌های درسی" count
      // badge for this class updates.
      qc.invalidateQueries({ queryKey: ["admin-classes"] });
    } catch (err) {
      toast({
        title: "خطا در ایجاد گروه",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>گروه‌های درسی: {className}</DialogTitle>
          <DialogDescription>
            ایجاد و مدیریت گروه‌های درسی (هر درس یک گروه مجزا)
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <form onSubmit={handleCreateGroup} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="subjectGroupName">نام درس</Label>
              <Input
                id="subjectGroupName"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="مثال: ریاضی"
                required
                disabled={submitting}
                autoFocus
              />
              {/* Phase 25 — auto-naming preview: shows the FINAL group name
                  that will be sent to the API. The pattern is
                  "{subject} {className}" so common subject names like
                  "ریاضی" don't clash across classes (ClassRoom.name is
                  globally @unique). */}
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                نام نهایی گروه:{" "}
                <span className="text-foreground font-medium persian-nums">
                  {groupName.trim() ? `${groupName.trim()} ${className}`.trim() : "—"}
                </span>
                <span className="ml-1 text-muted-foreground/70">
                  (نام درس + نام کلاس)
                </span>
              </p>
            </div>
            <Button
              type="submit"
              disabled={submitting || !groupName.trim()}
              className="gap-2 self-start"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              ایجاد گروه
            </Button>
          </form>

          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pl-1">
            {localGroups.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                هنوز گروه درسی ایجاد نشده است
              </p>
            ) : (
              localGroups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{g.name}</span>
                    <div className="flex items-center gap-1">
                      {g.section ? (
                        <Badge variant="outline" className="text-[10px]">
                          {g.section}
                        </Badge>
                      ) : null}
                      <Badge
                        variant="secondary"
                        className="gap-1 text-[10px]"
                      >
                        <UsersIcon className="size-3" />
                        <span className="persian-nums">
                          {toPersianDigits(g._count?.memberships ?? 0)}
                        </span>
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-8"
                    disabled
                    title="به‌زودی"
                    aria-label="حذف گروه (به‌زودی)"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="gap-2"
          >
            <ChevronLeft className="size-4" />
            بستن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
