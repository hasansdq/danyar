"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, FileQuestion, FileText, Download } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

interface ClassListItem {
  id: string;
  name: string;
  gradeLevel: string | null;
}

interface PaginatedClasses {
  items: ClassListItem[];
  total: number;
}

interface SampleQuestionItem {
  id: string;
  classId: string;
  class: { id: string; name: string; gradeLevel: string | null };
  title: string;
  description: string | null;
  fileName: string | null;
  fileUrl: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    fullName: string;
    username: string;
    role: string;
  };
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function SampleQuestionsManager() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const qc = useQueryClient();

  const { data: classesData, isLoading: classesLoading } =
    useQuery<PaginatedClasses>({
      queryKey: ["admin-classes-sq"],
      queryFn: () =>
        apiFetch<PaginatedClasses>("/api/admin/classes?page=1&pageSize=200"),
    });

  const [selectedClassId, setSelectedClassId] = React.useState<string>("");

  React.useEffect(() => {
    if (!selectedClassId && classesData?.items.length) {
      setSelectedClassId(classesData.items[0].id);
    }
  }, [classesData, selectedClassId]);

  const queryStr = selectedClassId
    ? `?classId=${encodeURIComponent(selectedClassId)}`
    : "";
  const { data: questions, isLoading: questionsLoading } = useQuery<
    SampleQuestionItem[]
  >({
    queryKey: ["admin-sample-questions", selectedClassId],
    queryFn: () =>
      apiFetch<SampleQuestionItem[]>(`/api/admin/sample-questions${queryStr}`),
    enabled: !!classesData,
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState({
    classId: "",
    title: "",
    description: "",
    file: null as File | null,
  });

  const [deleteTarget, setDeleteTarget] =
    React.useState<SampleQuestionItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  function openCreate() {
    setForm({
      classId: selectedClassId || classesData?.items[0]?.id || "",
      title: "",
      description: "",
      file: null,
    });
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.user?.id) {
      toast({ title: "اطلاعات کاربر در دسترس نیست", variant: "destructive" });
      return;
    }
    if (!form.classId || !form.title) {
      toast({ title: "کلاس و عنوان الزامی است", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("classId", form.classId);
      fd.append("title", form.title.trim());
      fd.append("description", form.description.trim());
      fd.append("createdById", session.user.id);
      if (form.file) fd.append("file", form.file);
      await apiFetch("/api/admin/sample-questions", { method: "POST", body: fd });
      toast({
        title: "نمونه سوال ایجاد شد",
        description: "نمونه سوال جدید با موفقیت ایجاد شد",
      });
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-sample-questions"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      toast({
        title: "خطا در ایجاد نمونه سوال",
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
      await apiFetch(`/api/admin/sample-questions/${deleteTarget.id}`, {
        method: "DELETE",
      });
      toast({ title: "نمونه سوال حذف شد" });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-sample-questions"] });
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
          <h2 className="text-2xl font-bold tracking-tight">نمونه سوالات</h2>
          <p className="text-muted-foreground text-sm">
            مدیریت نمونه سوالات کلاس‌ها
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="size-4" />
          افزودن نمونه سوال
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <Label htmlFor="classFilter" className="text-sm whitespace-nowrap">
              کلاس:
            </Label>
            {classesLoading ? (
              <Skeleton className="h-9 w-64" />
            ) : (
              <Select
                value={selectedClassId}
                onValueChange={setSelectedClassId}
              >
                <SelectTrigger id="classFilter" className="w-full sm:w-64">
                  <SelectValue placeholder="همه کلاس‌ها" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه کلاس‌ها</SelectItem>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">لیست نمونه سوالات</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {questionsLoading ? (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>عنوان</TableHead>
                  <TableHead>کلاس</TableHead>
                  <TableHead>فایل</TableHead>
                  <TableHead>تاریخ ایجاد</TableHead>
                  <TableHead>عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions && questions.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-muted-foreground py-8 text-center"
                    >
                      نمونه سوال یافت نشد
                    </TableCell>
                  </TableRow>
                )}
                {questions?.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileQuestion className="text-primary size-4 shrink-0" />
                        <span className="font-medium">{q.title}</span>
                      </div>
                      {q.description && (
                        <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                          {q.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{q.class?.name ?? "—"}</Badge>
                    </TableCell>
                    <TableCell>
                      {q.fileUrl ? (
                        <a
                          href={q.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                        >
                          <Download className="size-3" />
                          {q.fileName || "دانلود"}
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          بدون فایل
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs persian-nums">
                      {formatDate(q.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive size-8"
                        onClick={() => setDeleteTarget(q)}
                        aria-label="حذف"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!questionsLoading && questions && questions.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-center gap-3 py-12">
          <FileText className="size-12 opacity-40" />
          <p>نمونه سوال برای این کلاس وجود ندارد.</p>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>افزودن نمونه سوال جدید</DialogTitle>
            <DialogDescription>
              یک نمونه سوال جدید برای کلاس انتخاب‌شده ایجاد کنید.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sqClass">کلاس</Label>
              <Select
                value={form.classId}
                onValueChange={(v) => setForm({ ...form, classId: v })}
              >
                <SelectTrigger id="sqClass">
                  <SelectValue placeholder="کلاس را انتخاب کنید" />
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="sqTitle">عنوان</Label>
              <Input
                id="sqTitle"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="مثال: نمونه سوال فصل اول"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sqDesc">توضیحات (اختیاری)</Label>
              <Textarea
                id="sqDesc"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sqFile">فایل پیوست (اختیاری)</Label>
              <Input
                id="sqFile"
                type="file"
                onChange={(e) =>
                  setForm({
                    ...form,
                    file: e.target.files?.[0] || null,
                  })
                }
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
                {submitting ? "در حال ایجاد..." : "ایجاد نمونه سوال"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف نمونه سوال"
        description={
          deleteTarget ? (
            <>
              آیا از حذف نمونه سوال{" "}
              <strong className="text-foreground">{deleteTarget.title}</strong>{" "}
              مطمئن هستید؟
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
