"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type EnrollRole = "STUDENT" | "TEACHER";

interface ClassItem {
  id: string;
  name: string;
  description?: string | null;
  gradeLevel?: string | null;
  section?: string | null;
  school?: { id: string; name: string } | null;
  studentCount?: number;
  teacherCount?: number;
  memberCount?: number;
}

interface PaginatedClasses {
  items: ClassItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface EnrollResult {
  classId: string;
  role: EnrollRole;
  requested: number;
  newlyEnrolled: number;
  roleUpdated: number;
  alreadyEnrolled: number;
  invalidUserIds?: string[];
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export interface AddToClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The user IDs to enroll. For batch mode this is the selected set; for
   * single (per-user icon) mode this is just `[userId]`.
   */
  userIds: string[];
  /**
   * POST endpoint for enrollment.
   * Admin:  `/api/admin/enroll`
   * Super:  `/api/superadmin/enroll`
   */
  enrollApiBase: string;
  /**
   * GET endpoint that lists classes (paginated). Will fetch with
   * `?pageSize=100`.
   */
  classesApiBase: string;
  /** Optional cache key used by the parent list (so we can invalidate). */
  invalidateKeys?: readonly unknown[][];
  /** Called after a successful enroll (e.g. refetch users list). */
  onSuccess?: (result: EnrollResult) => void;
}

export function AddToClassDialog({
  open,
  onOpenChange,
  userIds,
  enrollApiBase,
  classesApiBase,
  invalidateKeys,
  onSuccess,
}: AddToClassDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [classId, setClassId] = React.useState<string>("");
  const [role, setRole] = React.useState<EnrollRole>("STUDENT");
  const [submitting, setSubmitting] = React.useState(false);

  // Reset local state when the dialog is closed/reopened with a new set.
  React.useEffect(() => {
    if (open) {
      setClassId("");
      setRole("STUDENT");
      setSubmitting(false);
    }
  }, [open]);

  // Fetch classes list (page=1, pageSize=100 → covers most schools; we
  // don't paginate the selector).
  const { data: classesData, isLoading: classesLoading } =
    useQuery<PaginatedClasses>({
      queryKey: ["add-to-class-classes", classesApiBase, open],
      queryFn: () =>
        apiFetch<PaginatedClasses>(
          `${classesApiBase}?page=1&pageSize=100`,
        ),
      enabled: open,
      staleTime: 60_000,
    });

  const classes = classesData?.items ?? [];

  const count = userIds.length;
  const canSubmit = classId !== "" && count > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!classId || count === 0) return;
    setSubmitting(true);
    try {
      const result = await apiFetch<EnrollResult>(enrollApiBase, {
        method: "POST",
        body: JSON.stringify({
          classId,
          userIds,
          role,
        }),
      });
      toast({
        title: "افزودن به کلاس انجام شد",
        description: `${result.newlyEnrolled} کاربر جدید اضافه شد${
          result.roleUpdated
            ? `، ${result.roleUpdated} نقش به‌روزرسانی شد`
            : ""
        }${
          result.alreadyEnrolled
            ? `، ${result.alreadyEnrolled} از قبل عضو بود`
            : ""
        }`,
      });
      // Invalidate the parent's user list + the user-detail cache so the
      // membership count column refreshes.
      for (const key of invalidateKeys ?? []) {
        qc.invalidateQueries({ queryKey: key });
      }
      onSuccess?.(result);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "خطا در افزودن به کلاس",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <UserPlus className="size-5 text-emerald-500" />
            افزودن به کلاس
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {count > 1
              ? `${count} کاربر انتخاب شده‌اند. کلاس و نقش مورد نظر را انتخاب کنید.`
              : `یک کاربر انتخاب شده است. کلاس و نقش مورد نظر را انتخاب کنید.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="addToClass-classId" className="text-foreground">
              کلاس
            </Label>
            <Select
              value={classId}
              onValueChange={(v) => setClassId(v)}
              disabled={classesLoading || submitting}
            >
              <SelectTrigger
                id="addToClass-classId"
                className="border-border bg-background text-foreground focus:ring-emerald-500/40"
              >
                <SelectValue
                  placeholder={
                    classesLoading ? "در حال بارگذاری..." : "انتخاب کلاس"
                  }
                />
              </SelectTrigger>
              <SelectContent className="border-border bg-card text-foreground max-h-72">
                {classes.length === 0 && !classesLoading ? (
                  <SelectItem value="__none" disabled>
                    کلاسی یافت نشد
                  </SelectItem>
                ) : (
                  classes.map((c) => {
                    const label = [c.gradeLevel, c.section, c.name]
                      .filter(Boolean)
                      .join(" - ");
                    const schoolName = c.school?.name;
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        {label}
                        {schoolName ? ` (${schoolName})` : ""}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="addToClass-role" className="text-foreground">
              نقش در کلاس
            </Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as EnrollRole)}
              disabled={submitting}
            >
              <SelectTrigger
                id="addToClass-role"
                className="border-border bg-background text-foreground focus:ring-emerald-500/40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-card text-foreground">
                <SelectItem value="STUDENT">دانش‌آموز</SelectItem>
                <SelectItem value="TEACHER">معلم</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground"
            >
              انصراف
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-emerald-600 text-white hover:bg-emerald-500 gap-2"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "در حال افزودن..." : "افزودن"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
