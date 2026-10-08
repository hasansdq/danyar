"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ThumbsUp, ThumbsDown, Award } from "lucide-react";
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

interface BehaviorItem {
  id: string;
  classId: string;
  class: { id: string; name: string; gradeLevel: string | null };
  studentId: string;
  student: { id: string; fullName: string; username: string };
  type: string; // POSITIVE | NEGATIVE
  reason: string;
  value: number;
  createdAt: string;
  createdBy: { id: string; fullName: string; username: string; role: string };
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

function BehaviorBadge({ type }: { type: string }) {
  if (type === "POSITIVE") {
    return (
      <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600">
        <ThumbsUp className="size-3" /> مثبت
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <ThumbsDown className="size-3" /> منفی
    </Badge>
  );
}

export function BehaviorManager() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const qc = useQueryClient();

  const { data: classesData, isLoading: classesLoading } =
    useQuery<PaginatedClasses>({
      queryKey: ["admin-classes-behavior"],
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

  const { data: behaviors, isLoading: behaviorsLoading } = useQuery<
    BehaviorItem[]
  >({
    queryKey: ["admin-behaviors", selectedClassId],
    queryFn: () =>
      apiFetch<BehaviorItem[]>(
        `/api/admin/behavior${selectedClassId && selectedClassId !== "all" ? `?classId=${encodeURIComponent(selectedClassId)}` : ""}`,
      ),
    enabled: !!selectedClassId,
  });

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
    type: "POSITIVE" as "POSITIVE" | "NEGATIVE",
    reason: "",
    value: "1",
  });

  const [deleteTarget, setDeleteTarget] =
    React.useState<BehaviorItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  function openCreate() {
    setForm({
      classId:
        selectedClassId && selectedClassId !== "all"
          ? selectedClassId
          : (classesData?.items[0]?.id ?? ""),
      studentId: "",
      type: "POSITIVE",
      reason: "",
      value: "1",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.user?.id) {
      toast({ title: "اطلاعات کاربر در دسترس نیست", variant: "destructive" });
      return;
    }
    if (!form.classId || !form.studentId || !form.reason) {
      toast({
        title: "کلاس، دانش‌آموز و علت الزامی است",
        variant: "destructive",
      });
      return;
    }
    const value = Number(form.value) || (form.type === "POSITIVE" ? 1 : -1);
    if (Number.isNaN(value)) {
      toast({ title: "مقدار باید عدد باشد", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/api/admin/behavior", {
        method: "POST",
        body: JSON.stringify({
          classId: form.classId,
          studentId: form.studentId,
          type: form.type,
          reason: form.reason.trim(),
          value,
          createdById: session.user.id,
        }),
      });
      toast({
        title: "نشان رفتاری ثبت شد",
        description: "نشان رفتاری جدید با موفقیت ثبت شد",
      });
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-behaviors"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      toast({
        title: "خطا در ثبت نشان",
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
      await apiFetch(`/api/admin/behavior/${deleteTarget.id}`, {
        method: "DELETE",
      });
      toast({ title: "نشان رفتاری حذف شد" });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-behaviors"] });
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
          <h2 className="text-2xl font-bold tracking-tight">نمرات رفتاری</h2>
          <p className="text-muted-foreground text-sm">
            ثبت و مدیریت نشان‌های رفتاری دانش‌آموزان
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="size-4" />
          ثبت نشان رفتاری
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
          <CardTitle className="text-base">لیست نشان‌های رفتاری</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {behaviorsLoading ? (
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
                  <TableHead>نوع</TableHead>
                  <TableHead>علت</TableHead>
                  <TableHead>کلاس</TableHead>
                  <TableHead>مقدار</TableHead>
                  <TableHead>تاریخ</TableHead>
                  <TableHead>عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {behaviors && behaviors.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-muted-foreground py-8 text-center"
                    >
                      نشان رفتاری ثبت نشده است
                    </TableCell>
                  </TableRow>
                )}
                {behaviors?.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">
                      {b.student?.fullName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <BehaviorBadge type={b.type} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {b.reason}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{b.class?.name ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="persian-nums font-semibold">
                      {b.value > 0 ? `+${b.value}` : b.value}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs persian-nums">
                      {formatDate(b.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive size-8"
                        onClick={() => setDeleteTarget(b)}
                        aria-label="حذف نشان"
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

      {!behaviorsLoading && behaviors && behaviors.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-center gap-3 py-12">
          <Award className="size-12 opacity-40" />
          <p>برای این کلاس نشان رفتاری ثبت نشده است.</p>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت نشان رفتاری</DialogTitle>
            <DialogDescription>
              یک نشان رفتاری مثبت یا منفی برای دانش‌آموز ثبت کنید.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="behClass">کلاس</Label>
              <Select
                value={form.classId}
                onValueChange={(v) => setForm({ ...form, classId: v })}
              >
                <SelectTrigger id="behClass">
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
              <Label htmlFor="behStudent">دانش‌آموز</Label>
              <Select
                value={form.studentId}
                onValueChange={(v) => setForm({ ...form, studentId: v })}
              >
                <SelectTrigger id="behStudent">
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

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="behType">نوع نشان</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      type: v as "POSITIVE" | "NEGATIVE",
                      value: v === "POSITIVE" ? "1" : "-1",
                    })
                  }
                >
                  <SelectTrigger id="behType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POSITIVE">مثبت</SelectItem>
                    <SelectItem value="NEGATIVE">منفی</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="behValue">مقدار</Label>
                <Input
                  id="behValue"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  value={form.value}
                  onChange={(e) =>
                    setForm({ ...form, value: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="behReason">علت</Label>
              <Textarea
                id="behReason"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                rows={3}
                required
                placeholder="توضیح دلیل این نشان رفتاری..."
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
                {submitting ? "در حال ثبت..." : "ثبت نشان"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف نشان رفتاری"
        description={
          deleteTarget ? (
            <>
              آیا از حذف این نشان رفتاری متعلق به{" "}
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
