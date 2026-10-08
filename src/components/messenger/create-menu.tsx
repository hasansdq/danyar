"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Users,
  GraduationCap,
  UserPlus,
  Loader2,
  ClipboardList,
  FileQuestion,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-fetch";
import { fetchClasses, postAssignment, postSampleQuestion } from "@/lib/messenger-api";
import type { ClassItem, MessengerUser } from "./types";

/**
 * Phase 16 — the principal's "+" create menu.
 *
 * Replaces the AI FAB that used to live in the messenger header. The FAB is
 * now ONLY mounted in the admin panel (admin-topbar). In the messenger, the
 * header gets a `+` button (visible for ADMIN only) that opens a
 * `DropdownMenu` with 4 creation shortcuts:
 *
 *   1. ایجاد گروه (گفتگو)  → CreateGroupDialog  → POST /api/teacher/create-group
 *     (Phase 25 — "ایجاد کلاس" removed from the messenger create-menu;
 *      classes are now created from the admin panel's /admin/classes page,
 *      where the principal can also create subject groups within each
 *      class. The messenger's create-menu now only offers: create group,
 *      create student, create teacher, create assignment/sample-q.)
 *   3. ایجاد دانش‌آموز     → CreateUserDialog (role=STUDENT) → POST /api/admin/users
 *   4. ایجاد معلم          → CreateUserDialog (role=TEACHER) → POST /api/admin/users
 *
 * Phase 19 — TEACHER role now ALSO sees the "+" button, but with a DIFFERENT
 * 3-item menu:
 *
 *   1. ایجاد تکلیف      → CreateTeacherAssignmentDialog → POST /api/teacher/assignments
 *   2. نمونه سوال       → CreateTeacherSampleQuestionDialog → POST /api/teacher/sample-questions
 *   3. ثبت نمره         → calls onOpenGrades() (opens the grades feature Sheet)
 *
 * On a successful class/group creation, the `["classes", user.id]` query is
 * invalidated so the conversation list refreshes. On a successful assignment
 * or sample-question creation, the matching `["assignments", classId]` /
 * `["sample-questions", classId]` query is invalidated so the assignments/
 * sample-questions Sheet refreshes.
 *
 * The component reads `user.role` internally to decide which menu to render.
 * The messenger header renders it for ADMIN and TEACHER roles.
 */

interface CreateMenuProps {
  user: MessengerUser;
  /**
   * Phase 19 — the currently-selected class id (used to pre-select the
   * class in the teacher's create-assignment / create-sample-question
   * dialogs). Null when no class is selected (the user is in the
   * conversation list). The teacher can still pick any class from the
   * dialog's Select dropdown.
   */
  currentClassId?: string | null;
  /**
   * Phase 19 — called when the teacher taps the "ثبت نمره" menu item.
   * The parent (messenger-app) opens the grades feature Sheet via
   * `setOpenFeature("grades")`. Required when `user.role === "TEACHER"`
   * (otherwise the menu item is a dead control).
   */
  onOpenGrades?: () => void;
}

export function CreateMenu({ user, currentClassId, onOpenGrades }: CreateMenuProps) {
  const isTeacher = user.role === "TEACHER";
  const [openDialog, setOpenDialog] = React.useState<
    | "group"
    | "student"
    | "teacher"
    | "assignment"
    | "sampleQuestion"
    | null
  >(null);

  if (isTeacher) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="default"
              size="icon"
              aria-label="ایجاد"
              title="ایجاد مورد جدید"
              className="size-9 shrink-0"
            >
              <Plus className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56"
            collisionPadding={8}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              ایجاد مورد جدید
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setOpenDialog("assignment");
              }}
              className="gap-2 py-2.5"
            >
              <ClipboardList className="size-4 text-primary" />
              <span>ایجاد تکلیف</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setOpenDialog("sampleQuestion");
              }}
              className="gap-2 py-2.5"
            >
              <FileQuestion className="size-4 text-primary" />
              <span>نمونه سوال</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                // No dialog — just open the grades feature Sheet via the
                // parent's callback. The dropdown closes itself.
                onOpenGrades?.();
              }}
              disabled={!onOpenGrades}
              className="gap-2 py-2.5"
            >
              <BarChart3 className="size-4 text-primary" />
              <span>ثبت نمره</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <CreateTeacherAssignmentDialog
          user={user}
          currentClassId={currentClassId ?? null}
          open={openDialog === "assignment"}
          onOpenChange={(o) => setOpenDialog(o ? "assignment" : null)}
        />
        <CreateTeacherSampleQuestionDialog
          user={user}
          currentClassId={currentClassId ?? null}
          open={openDialog === "sampleQuestion"}
          onOpenChange={(o) => setOpenDialog(o ? "sampleQuestion" : null)}
        />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="default"
            size="icon"
            aria-label="ایجاد"
            title="ایجاد مورد جدید"
            className="size-9 shrink-0"
          >
            <Plus className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          collisionPadding={8}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            ایجاد مورد جدید
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setOpenDialog("group");
            }}
            className="gap-2 py-2.5"
          >
            <Users className="size-4 text-primary" />
            <span>ایجاد گروه (گفتگو)</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setOpenDialog("student");
            }}
            className="gap-2 py-2.5"
          >
            <GraduationCap className="size-4 text-primary" />
            <span>ایجاد دانش‌آموز</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setOpenDialog("teacher");
            }}
            className="gap-2 py-2.5"
          >
            <UserPlus className="size-4 text-primary" />
            <span>ایجاد معلم</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Each dialog is mounted once + controlled by `openDialog` so the form
          state resets cleanly when the user closes/reopens it. */}
      <CreateGroupDialog
        user={user}
        open={openDialog === "group"}
        onOpenChange={(o) => setOpenDialog(o ? "group" : null)}
      />
      <CreateUserDialog
        user={user}
        role="STUDENT"
        open={openDialog === "student"}
        onOpenChange={(o) => setOpenDialog(o ? "student" : null)}
      />
      <CreateUserDialog
        user={user}
        role="TEACHER"
        open={openDialog === "teacher"}
        onOpenChange={(o) => setOpenDialog(o ? "teacher" : null)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shared dialog wrapper                                               */
/* ------------------------------------------------------------------ */

interface DialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
}

function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  footer,
}: DialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {icon}
            </span>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">{children}</div>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Create group (chat) — within an existing parent class             */
/* ------------------------------------------------------------------ */

interface CreateGroupDialogProps {
  user: MessengerUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateGroupDialog({
  user,
  open,
  onOpenChange,
}: CreateGroupDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Pre-fetch the principal's classes so the parent-class Select can list
  // them. The query is shared with the conversation-list (same queryKey).
  const { data: classes, isLoading: classesLoading } = useQuery<ClassItem[]>({
    queryKey: ["classes", user.id],
    queryFn: () => fetchClasses(),
    enabled: open,
    staleTime: 30 * 1000,
  });

  // Only classes (parentClassId === null/undefined) are valid parents for a
  // new group. The backend tags groups with parentClassId; we filter them out
  // here so the dropdown shows just real classes. (Older backends that don't
  // yet expose `parentClassId` simply show all classes — still works.)
  const parentClasses = React.useMemo<ClassItem[]>(
    () =>
      (classes ?? []).filter(
        (c) => c.parentClassId === null || c.parentClassId === undefined,
      ),
    [classes],
  );

  const [parentClassId, setParentClassId] = React.useState<string>("");
  const [groupName, setGroupName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Reset form when the dialog closes.
  React.useEffect(() => {
    if (!open) {
      setParentClassId("");
      setGroupName("");
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmedName = groupName.trim();
    if (!parentClassId) {
      toast({
        title: "کلاس والد را انتخاب کنید",
        variant: "destructive",
      });
      return;
    }
    if (!trimmedName) {
      toast({
        title: "نام گروه را وارد کنید",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch<{ id: string; name: string }>("/api/teacher/create-group", {
        method: "POST",
        body: JSON.stringify({ parentClassId, name: trimmedName }),
      });
      await queryClient.invalidateQueries({
        queryKey: ["classes", user.id],
      });
      toast({
        title: "گروه ایجاد شد",
        description: `گروه «${trimmedName}» با موفقیت ساخته شد.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "ایجاد گروه ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="ایجاد گروه (گفتگو)"
      description="یک گروه گفتگوی جدید درون یکی از کلاس‌های خود ایجاد کنید."
      icon={<Users className="size-4" />}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            انصراف
          </Button>
          <Button
            type="submit"
            form="create-group-form"
            disabled={submitting}
            className="gap-1.5"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            ایجاد گروه
          </Button>
        </>
      }
    >
      <form
        id="create-group-form"
        onSubmit={handleSubmit}
        className="grid gap-4"
      >
        <div className="grid gap-2">
          <Label htmlFor="parent-class">کلاس والد</Label>
          <Select
            value={parentClassId}
            onValueChange={setParentClassId}
            disabled={classesLoading || submitting}
          >
            <SelectTrigger id="parent-class" className="w-full">
              <SelectValue placeholder={classesLoading ? "در حال بارگذاری..." : "یک کلاس انتخاب کنید"} />
            </SelectTrigger>
            <SelectContent>
              {parentClasses.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  کلاسی موجود نیست.
                </div>
              ) : (
                parentClasses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.gradeLevel ? ` · ${c.gradeLevel}` : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="group-name">نام گروه</Label>
          <Input
            id="group-name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="مثلاً: گروه ویژه ریاضی"
            disabled={submitting}
            maxLength={80}
            autoFocus
          />
        </div>
      </form>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */
/* 3 + 4. Create student / teacher                                     */
/* ------------------------------------------------------------------ */

interface CreateUserDialogProps {
  user: MessengerUser;
  role: "STUDENT" | "TEACHER";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateUserDialog({
  user,
  role,
  open,
  onOpenChange,
}: CreateUserDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isStudent = role === "STUDENT";
  const title = isStudent ? "ایجاد دانش‌آموز" : "ایجاد معلم";
  const description = isStudent
    ? "یک دانش‌آموز جدید در مدرسه خود ایجاد کنید."
    : "یک معلم جدید در مدرسه خود ایجاد کنید.";
  const icon = isStudent ? (
    <GraduationCap className="size-4" />
  ) : (
    <UserPlus className="size-4" />
  );

  // Phase 30 — fetch the principal's classes so we can render a required
  // class-picker field for BOTH students and teachers. The class is the
  // user's "primary class" — they'll be auto-enrolled in the parent class
  // + every subject group within it (groups whose parentClassId = the
  // picked class). Re-uses the shared ["classes", user.id] query so the
  // dropdown stays in sync with the conversation list.
  const { data: classes, isLoading: classesLoading } = useQuery<ClassItem[]>({
    queryKey: ["classes", user.id],
    queryFn: () => fetchClasses(),
    enabled: open,
    staleTime: 30 * 1000,
  });
  // Only top-level classes (parentClassId === null) are valid primary
  // classes — a user is enrolled in a CLASS, not a subject group directly.
  const parentClasses = React.useMemo<ClassItem[]>(
    () =>
      (classes ?? []).filter(
        (c) => c.parentClassId === null || c.parentClassId === undefined,
      ),
    [classes],
  );

  const [fullName, setFullName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [classId, setClassId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setFullName("");
      setUsername("");
      setPassword("");
      setClassId("");
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmedFull = fullName.trim();
    const trimmedUser = username.trim().toLowerCase();
    if (!trimmedFull) {
      toast({ title: "نام و نام خانوادگی را وارد کنید", variant: "destructive" });
      return;
    }
    if (!trimmedUser) {
      toast({ title: "نام کاربری را وارد کنید", variant: "destructive" });
      return;
    }
    if (password.length < 4) {
      toast({
        title: "رمز عبور باید حداقل ۴ کاراکتر باشد",
        variant: "destructive",
      });
      return;
    }
    // Phase 30 — class is required for BOTH students and teachers. The
    // backend uses it to auto-enroll the user in the parent class + all
    // its subject groups (so they immediately appear in the right chat
    // rooms in the messenger + in the admin panel's class roster).
    if (!classId) {
      toast({
        title: "کلاس را انتخاب کنید",
        description: isStudent
          ? "انتخاب کلاس برای دانش‌آموز الزامی است."
          : "انتخاب کلاس برای معلم الزامی است.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch<{ id: string; username: string }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: trimmedUser,
          password,
          fullName: trimmedFull,
          role,
          classId,
        }),
      });
      // User list queries are keyed under ["users", ...] in the admin pages.
      // Invalidate broadly so any open admin table refreshes.
      await queryClient.invalidateQueries({
        queryKey: ["users"],
        exact: false,
      });
      // Also invalidate classes (the new user appears in class rosters +
      // group member counts shift).
      await queryClient.invalidateQueries({
        queryKey: ["classes"],
        exact: false,
      });
      toast({
        title: isStudent ? "دانش‌آموز ایجاد شد" : "معلم ایجاد شد",
        description: `${trimmedFull} (@${trimmedUser}) با موفقیت ساخته شد و در کلاس و گروه‌های درسی آن عضو شد.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "ایجاد کاربر ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      icon={icon}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            انصراف
          </Button>
          <Button
            type="submit"
            form={`create-user-form-${role}`}
            disabled={submitting}
            className="gap-1.5"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {isStudent ? "ایجاد دانش‌آموز" : "ایجاد معلم"}
          </Button>
        </>
      }
    >
      <form
        id={`create-user-form-${role}`}
        onSubmit={handleSubmit}
        className="grid gap-4"
      >
        <div className="grid gap-2">
          <Label htmlFor={`full-name-${role}`}>نام و نام خانوادگی</Label>
          <Input
            id={`full-name-${role}`}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="مثلاً: علی محمدی"
            disabled={submitting}
            maxLength={80}
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`username-${role}`}>نام کاربری</Label>
          <Input
            id={`username-${role}`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="مثلاً: ali.mohammadi"
            disabled={submitting}
            maxLength={40}
            dir="ltr"
            className="text-left"
            autoComplete="off"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`password-${role}`}>رمز عبور</Label>
          <Input
            id={`password-${role}`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="حداقل ۴ کاراکتر"
            disabled={submitting}
            maxLength={100}
            dir="ltr"
            className="text-left"
            type="text"
            autoComplete="new-password"
          />
        </div>
        {/* Phase 30 — required class picker. Both STUDENT and TEACHER
            roles get auto-enrolled in the parent class + every subject
            group within it (the backend handles this in a transaction).
            Showing the field for both roles matches the user's spec:
            "هنگام ایجاد دانش‌آموز/معلم باید کلاس نیز مشخص شود". */}
        <div className="grid gap-2">
          <Label htmlFor={`class-${role}`}>
            {isStudent ? "کلاس دانش‌آموز" : "کلاس معلم"}{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Select
            value={classId}
            onValueChange={setClassId}
            disabled={classesLoading || submitting}
          >
            <SelectTrigger id={`class-${role}`} className="w-full">
              <SelectValue
                placeholder={
                  classesLoading ? "در حال بارگذاری..." : "یک کلاس انتخاب کنید"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {parentClasses.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  کلاسی موجود نیست.
                </div>
              ) : (
                parentClasses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.gradeLevel ? ` · ${c.gradeLevel}` : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {isStudent
              ? "دانش‌آموز به‌طور خودکار وارد کلاس و تمام گروه‌های درسی آن می‌شود."
              : "معلم به‌طور خودکار وارد کلاس و تمام گروه‌های درسی آن می‌شود."}
          </p>
        </div>
      </form>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 19 — Teacher "+" create dialogs (assignment / sample-question) */
/* ------------------------------------------------------------------ */

/**
 * Shared class-picker field used by both teacher create-* dialogs. Lets the
 * teacher pick which of their classes/groups to create the assignment (or
 * sample question) in. Defaults to `currentClassId` when the parent passed
 * one (e.g. the user is currently in a chat for class A and opens the "+"
 * menu → pre-selects class A). The Select re-uses the shared
 * `["classes", user.id]` query so the dropdown stays in sync with the
 * conversation list.
 */
function TeacherClassPicker({
  user,
  currentClassId,
  targetClassId,
  setTargetClassId,
  disabled,
  open,
}: {
  user: MessengerUser;
  currentClassId: string | null;
  targetClassId: string;
  setTargetClassId: (id: string) => void;
  disabled: boolean;
  open: boolean;
}) {
  const { data: classes, isLoading: classesLoading } = useQuery<ClassItem[]>({
    queryKey: ["classes", user.id],
    queryFn: () => fetchClasses(),
    enabled: open,
    staleTime: 30 * 1000,
  });

  // Pre-select the current class once the classes list loads (or when the
  // parent passes a different currentClassId while the dialog is open).
  React.useEffect(() => {
    if (!open) return;
    if (!targetClassId && currentClassId) {
      setTargetClassId(currentClassId);
    }
  }, [open, targetClassId, currentClassId, setTargetClassId]);

  return (
    <div className="grid gap-2">
      <Label htmlFor="teacher-create-class">کلاس</Label>
      <Select
        value={targetClassId}
        onValueChange={setTargetClassId}
        disabled={classesLoading || disabled}
      >
        <SelectTrigger id="teacher-create-class" className="w-full">
          <SelectValue
            placeholder={
              classesLoading ? "در حال بارگذاری..." : "یک کلاس انتخاب کنید"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {(classes ?? []).length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              کلاسی موجود نیست.
            </div>
          ) : (
            (classes ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.parentClassId ? " (گروه)" : ""}
                {c.gradeLevel ? ` · ${c.gradeLevel}` : ""}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

interface CreateTeacherAssignmentDialogProps {
  user: MessengerUser;
  currentClassId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * CreateTeacherAssignmentDialog — opens when the teacher taps "ایجاد تکلیف"
 * in the "+" menu. Mirrors the assignments-view CreateAssignmentDialog but
 * lives in the create-menu so it's reachable from the messenger header
 * (regardless of whether the assignments Sheet is open). Submits a multipart
 * form to POST /api/teacher/assignments (re-uses the postAssignment helper).
 *
 * On success: invalidates the `["assignments", classId]` query so any open
 * assignments Sheet refreshes + shows a toast.
 */
export function CreateTeacherAssignmentDialog({
  user,
  currentClassId,
  open,
  onOpenChange,
}: CreateTeacherAssignmentDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetClassId, setTargetClassId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset form state when the dialog closes + pre-select the current class
  // when it opens (handled inside TeacherClassPicker's effect).
  React.useEffect(() => {
    if (!open) {
      setTargetClassId("");
      setTitle("");
      setDescription("");
      setDueDate("");
      setFile(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmedTitle = title.trim();
    if (!targetClassId) {
      toast({ title: "کلاس را انتخاب کنید", variant: "destructive" });
      return;
    }
    if (!trimmedTitle) {
      toast({ title: "عنوان تکلیف را وارد کنید", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("classId", targetClassId);
      fd.append("title", trimmedTitle);
      if (description.trim()) fd.append("description", description.trim());
      if (dueDate) {
        // Validate the date is parseable before posting (the backend
        // also validates but this lets us surface a Persian toast).
        const parsed = new Date(dueDate);
        if (Number.isNaN(parsed.getTime())) {
          toast({
            title: "تاریخ نامعتبر است",
            variant: "destructive",
          });
          setSubmitting(false);
          return;
        }
        fd.append("dueDate", parsed.toISOString());
      }
      if (file) fd.append("file", file);
      const created = await postAssignment(fd);
      await queryClient.invalidateQueries({
        queryKey: ["assignments", targetClassId],
      });
      toast({
        title: "تکلیف ایجاد شد",
        // postAssignment returns one Assignment per selected class — the
        // create form always posts a single classId, so read the first row.
        description: `تکلیف «${created[0]?.title ?? trimmedTitle}» با موفقیت ساخته شد.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "ایجاد تکلیف ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="ایجاد تکلیف"
      description="یک تکلیف جدید برای کلاس انتخاب‌شده ایجاد کنید."
      icon={<ClipboardList className="size-4" />}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            انصراف
          </Button>
          <Button
            type="submit"
            form="teacher-create-assignment-form"
            disabled={submitting || !targetClassId || !title.trim()}
            className="gap-1.5"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            ایجاد تکلیف
          </Button>
        </>
      }
    >
      <form
        id="teacher-create-assignment-form"
        onSubmit={handleSubmit}
        className="grid gap-4"
      >
        <TeacherClassPicker
          user={user}
          currentClassId={currentClassId}
          targetClassId={targetClassId}
          setTargetClassId={setTargetClassId}
          disabled={submitting}
          open={open}
        />
        <div className="grid gap-2">
          <Label htmlFor="teacher-assignment-title">عنوان تکلیف</Label>
          <Input
            id="teacher-assignment-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً: تمرین فصل اول"
            disabled={submitting}
            maxLength={120}
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="teacher-assignment-due">مهلت تحویل (اختیاری)</Label>
          <Input
            id="teacher-assignment-due"
            type="datetime-local"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={submitting}
            dir="ltr"
            className="text-left"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="teacher-assignment-file">فایل تکلیف (اختیاری)</Label>
          <Input
            id="teacher-assignment-file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={submitting}
            className="cursor-pointer"
          />
          {file ? (
            <p className="text-xs text-muted-foreground" dir="ltr">
              {file.name} ({Math.round(file.size / 1024)} KB)
            </p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="teacher-assignment-description">
            توضیحات (اختیاری)
          </Label>
          <Textarea
            id="teacher-assignment-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="توضیحات بیشتر در مورد تکلیف…"
            disabled={submitting}
            rows={3}
          />
        </div>
      </form>
    </DialogShell>
  );
}

interface CreateTeacherSampleQuestionDialogProps {
  user: MessengerUser;
  currentClassId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * CreateTeacherSampleQuestionDialog — opens when the teacher taps
 * "نمونه سوال" in the "+" menu. Mirrors CreateTeacherAssignmentDialog but
 * for sample questions (no due date). Submits a multipart form to
 * POST /api/teacher/sample-questions (re-uses the postSampleQuestion helper).
 *
 * On success: invalidates the `["sample-questions", classId]` query so any
 * open sample-questions Sheet refreshes + shows a toast.
 */
export function CreateTeacherSampleQuestionDialog({
  user,
  currentClassId,
  open,
  onOpenChange,
}: CreateTeacherSampleQuestionDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetClassId, setTargetClassId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTargetClassId("");
      setTitle("");
      setDescription("");
      setFile(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmedTitle = title.trim();
    if (!targetClassId) {
      toast({ title: "کلاس را انتخاب کنید", variant: "destructive" });
      return;
    }
    if (!trimmedTitle) {
      toast({ title: "عنوان نمونه سوال را وارد کنید", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("classId", targetClassId);
      fd.append("title", trimmedTitle);
      if (description.trim()) fd.append("description", description.trim());
      if (file) fd.append("file", file);
      const created = await postSampleQuestion(fd);
      await queryClient.invalidateQueries({
        queryKey: ["sample-questions", targetClassId],
      });
      toast({
        title: "نمونه سوال ایجاد شد",
        description: `نمونه سوال «${created.title}» با موفقیت ساخته شد.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      toast({
        title: "ایجاد نمونه سوال ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="ایجاد نمونه سوال"
      description="یک نمونه سوال جدید برای کلاس انتخاب‌شده ایجاد کنید."
      icon={<FileQuestion className="size-4" />}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            انصراف
          </Button>
          <Button
            type="submit"
            form="teacher-create-sample-question-form"
            disabled={submitting || !targetClassId || !title.trim()}
            className="gap-1.5"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            ایجاد نمونه سوال
          </Button>
        </>
      }
    >
      <form
        id="teacher-create-sample-question-form"
        onSubmit={handleSubmit}
        className="grid gap-4"
      >
        <TeacherClassPicker
          user={user}
          currentClassId={currentClassId}
          targetClassId={targetClassId}
          setTargetClassId={setTargetClassId}
          disabled={submitting}
          open={open}
        />
        <div className="grid gap-2">
          <Label htmlFor="teacher-sq-title">عنوان</Label>
          <Input
            id="teacher-sq-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً: نمونه سوال فصل اول"
            disabled={submitting}
            maxLength={120}
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="teacher-sq-description">توضیحات (اختیاری)</Label>
          <Textarea
            id="teacher-sq-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="توضیحات بیشتر…"
            disabled={submitting}
            rows={3}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="teacher-sq-file">فایل پیوست (اختیاری)</Label>
          <Input
            id="teacher-sq-file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={submitting}
            className="cursor-pointer"
          />
          {file ? (
            <p className="text-xs text-muted-foreground" dir="ltr">
              {file.name} ({Math.round(file.size / 1024)} KB)
            </p>
          ) : null}
        </div>
      </form>
    </DialogShell>
  );
}
