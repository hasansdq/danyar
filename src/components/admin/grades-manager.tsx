"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, GraduationCap, Award } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface ClassMember {
  id: string;
  role: string;
  user: {
    id: string;
    username: string;
    fullName: string;
    role: string;
    phone: string | null;
  };
}

interface ClassDetailData {
  id: string;
  name: string;
  memberships: ClassMember[];
}

interface GradeItem {
  id: string;
  classId: string;
  class: { id: string; name: string; gradeLevel: string | null };
  studentId: string;
  student: { id: string; fullName: string; username: string };
  title: string;
  score: number;
  maxScore: number;
  createdAt: string;
  createdBy: { id: string; fullName: string; username: string; role: string };
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function GradesManager() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const qc = useQueryClient();

  const { data: classesData, isLoading: classesLoading } =
    useQuery<PaginatedClasses>({
      queryKey: ["admin-classes-grades"],
      queryFn: () =>
        apiFetch<PaginatedClasses>("/api/admin/classes?page=1&pageSize=200"),
    });

  const [selectedClassId, setSelectedClassId] = React.useState<string>("");

  React.useEffect(() => {
    if (!selectedClassId && classesData?.items.length) {
      setSelectedClassId(classesData.items[0].id);
    }
  }, [classesData, selectedClassId]);

  const { data: classDetail } = useQuery<ClassDetailData>({
    queryKey: ["admin-class", selectedClassId],
    queryFn: () => apiFetch<ClassDetailData>(`/api/admin/classes/${selectedClassId}`),
    enabled: !!selectedClassId && selectedClassId !== "all",
  });

  const { data: grades, isLoading: gradesLoading } = useQuery<GradeItem[]>({
    queryKey: ["admin-grades", selectedClassId],
    queryFn: () =>
      apiFetch<GradeItem[]>(
        `/api/admin/grades${selectedClassId && selectedClassId !== "all" ? `?classId=${encodeURIComponent(selectedClassId)}` : ""}`,
      ),
    enabled: !!selectedClassId,
  });

  // Students in selected class (for the create form)
  const studentsInClass = React.useMemo(() => {
    return (classDetail?.memberships ?? [])
      .filter((m) => m.role === "STUDENT")
      .map((m) => m.user);
  }, [classDetail]);

  const [formOpen, setFormOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState({
    classId: "",
    studentId: "",
    title: "",
    score: "",
    maxScore: "20",
  });

  const [deleteTarget, setDeleteTarget] = React.useState<GradeItem | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);

  function openCreate() {
    setForm({
      classId:
        selectedClassId && selectedClassId !== "all"
          ? selectedClassId
          : (classesData?.items[0]?.id ?? ""),
      studentId: "",
      title: "",
      score: "",
      maxScore: "20",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.user?.id) {
      toast({ title: "اطلاعات کاربر در دسترس نیست", variant: "destructive" });
      return;
    }
    if (!form.classId || !form.studentId || !form.title) {
      toast({
        title: "کلاس، دانش‌آموز و عنوان الزامی است",
        variant: "destructive",
      });
      return;
    }
    const score = Number(form.score);
    const maxScore = Number(form.maxScore) || 20;
    if (Number.isNaN(score) || Number.isNaN(maxScore)) {
      toast({ title: "نمره باید عدد باشد", variant: "destructive" });
      return;
    }
    if (score < 0 || maxScore <= 0) {
      toast({
        title: "نمره باید >= ۰ و بار نمره > ۰ باشد",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/api/admin/grades", {
        method: "POST",
        body: JSON.stringify({
          classId: form.classId,
          studentId: form.studentId,
          title: form.title.trim(),
          score,
          maxScore,
          createdById: session.user.id,
        }),
      });
      toast({
        title: "نمره ثبت شد",
        description: "نمره جدید با موفقیت ثبت شد",
      });
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-grades"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      toast({
        title: "خطا در ثبت نمره",
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
      await apiFetch(`/api/admin/grades/${deleteTarget.id}`, {
        method: "DELETE",
      });
      toast({ title: "نمره حذف شد" });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-grades"] });
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
          <h2 className="text-2xl font-bold tracking-tight">مدیریت نمرات</h2>
          <p className="text-muted-foreground text-sm">
            ثبت و حذف نمرات دانش‌آموزان
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="size-4" />
          ثبت نمره
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
                  <SelectValue placeholder="انتخاب کلاس" />
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
          <CardTitle className="text-base">لیست نمرات</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {gradesLoading ? (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>دانش‌آموز</TableHead>
                  <TableHead>عنوان</TableHead>
                  <TableHead>کلاس</TableHead>
                  <TableHead>نمره</TableHead>
                  <TableHead>بار نمره</TableHead>
                  <TableHead>تاریخ</TableHead>
                  <TableHead>عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grades && grades.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-muted-foreground py-8 text-center"
                    >
                      نمره‌ای ثبت نشده است
                    </TableCell>
                  </TableRow>
                )}
                {grades?.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">
                      {g.student?.fullName ?? "—"}
                    </TableCell>
                    <TableCell>{g.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{g.class?.name ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="persian-nums font-semibold text-primary">
                      {g.score}
                    </TableCell>
                    <TableCell className="text-muted-foreground persian-nums">
                      {g.maxScore}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs persian-nums">
                      {formatDate(g.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive size-8"
                        onClick={() => setDeleteTarget(g)}
                        aria-label="حذف نمره"
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

      {!gradesLoading && grades && grades.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-center gap-3 py-12">
          <GraduationCap className="size-12 opacity-40" />
          <p>برای این کلاس نمره‌ای ثبت نشده است.</p>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت نمره جدید</DialogTitle>
            <DialogDescription>
              یک نمره برای دانش‌آموز انتخاب‌شده ثبت کنید.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="gradeClass">کلاس</Label>
              <Select
                value={form.classId}
                onValueChange={(v) => setForm({ ...form, classId: v })}
              >
                <SelectTrigger id="gradeClass">
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
              <Label htmlFor="gradeStudent">دانش‌آموز</Label>
              <Select
                value={form.studentId}
                onValueChange={(v) => setForm({ ...form, studentId: v })}
              >
                <SelectTrigger id="gradeStudent">
                  <SelectValue placeholder="دانش‌آموز را انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  {studentsInClass.length === 0 ? (
                    <SelectItem value="none" disabled>
                      دانش‌آموزی عضو این کلاس نیست
                    </SelectItem>
                  ) : (
                    studentsInClass.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.fullName} ({s.username})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="gradeTitle">عنوان نمره</Label>
              <Input
                id="gradeTitle"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="مثال: امتحان فصل اول"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="gradeScore">نمره</Label>
                <Input
                  id="gradeScore"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={form.score}
                  onChange={(e) =>
                    setForm({ ...form, score: e.target.value })
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="gradeMax">بار نمره</Label>
                <Input
                  id="gradeMax"
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  value={form.maxScore}
                  onChange={(e) =>
                    setForm({ ...form, maxScore: e.target.value })
                  }
                />
              </div>
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
                {submitting ? "در حال ثبت..." : "ثبت نمره"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف نمره"
        description={
          deleteTarget ? (
            <>
              آیا از حذف نمره{" "}
              <strong className="text-foreground">{deleteTarget.title}</strong>{" "}
              متعلق به{" "}
              <strong className="text-foreground">
                {deleteTarget.student?.fullName ?? "—"}
              </strong>{" "}
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
