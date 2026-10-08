"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  UserCircle,
  UserPlus,
  Loader2,
  School,
  Users as UsersIcon,
  Layers,
  Check,
  X,
  Copy,
  Trash,
  UserCog,
  Download,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import * as XLSX from "xlsx";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTablePagination } from "@/components/admin/data-table-pagination";

type Role = "STUDENT" | "TEACHER" | "ADMIN";

interface UserListItem {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  phone: string | null;
  avatar?: string | null;
  createdAt: string;
  _count: { memberships: number };
  // Phase 25 — class + group info (from GET /api/admin/users).
  primaryClass: { id: string; name: string; role: string } | null;
  classes: Array<{ id: string; name: string; role: string }>;
  groups: Array<{
    id: string;
    name: string;
    parentClassName: string | null;
    role: string;
  }>;
}

interface PaginatedUsers {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface UserFormValues {
  // Phase 31 — for the redesigned create flow we split fullName into
  // firstName + lastName (the backend joins them back). The legacy
  // `username` + `password` + `fullName` fields are still here for
  // the EDIT flow (where the admin manually edits an existing user).
  username: string;
  password: string;
  fullName: string;
  firstName: string;
  lastName: string;
  role: Role;
  phone: string;
  // Phase 31 — `classId` (single, for STUDENT) OR `classIds` (array,
  // for TEACHER multi-class). When `classIds` has entries it takes
  // priority on submit (so a TEACHER can be enrolled in multiple
  // classes at once).
  classId: string;
  classIds: string[];
}

/** Shape of the response from POST /api/admin/users when the backend
 * auto-generates the username/password. */
interface CreatedUserWithCreds {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  phone: string | null;
  generatedUsername: boolean;
  generatedPassword: string | null;
}

/** Shape of a single row in the bulk-create response. */
interface BulkCreatedRow {
  id: string;
  username: string;
  password: string;
  fullName: string;
  phone: string | null;
  className: string | null;
}

/** Shape of a single row in the bulk-add form (Excel-like grid). */
interface BulkRow {
  id: string;
  firstName: string;
  lastName: string;
  classId: string;
  phone: string;
}

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "مدیر",
  TEACHER: "معلم",
  STUDENT: "دانش‌آموز",
};

function roleBadge(role: Role) {
  if (role === "ADMIN")
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/10 text-amber-500"
      >
        {ROLE_LABEL[role]}
      </Badge>
    );
  if (role === "TEACHER")
    return (
      <Badge
        variant="outline"
        className="border-teal-500/40 bg-teal-500/10 text-teal-500"
      >
        {ROLE_LABEL[role]}
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="border-border bg-muted text-foreground"
    >
      {ROLE_LABEL[role]}
    </Badge>
  );
}

export function UsersManager() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const qc = useQueryClient();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [role, setRole] = React.useState<"ALL" | Role>("ALL");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");

  // Debounce search
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
  if (role !== "ALL") params.set("role", role);
  if (search) params.set("search", search);

  const { data, isLoading, isError, error } = useQuery<PaginatedUsers>({
    queryKey: ["admin-users", page, pageSize, role, search],
    queryFn: () => apiFetch<PaginatedUsers>(`/api/admin/users?${params.toString()}`),
  });

  // Create / edit dialog state
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserListItem | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState<UserFormValues>({
    username: "",
    password: "",
    fullName: "",
    firstName: "",
    lastName: "",
    role: "STUDENT",
    phone: "",
    classId: "",
    classIds: [],
  });

  // Phase 31 — bulk-add dialog state. Opened by the "افزودن گروهی کاربر"
  // button. Each row in `bulkRows` is an editable Excel-like entry. The
  // "createdCreds" state holds the result of a successful single-create
  // (so we can show the generated username/password in a dialog).
  //
  // Phase 32 — `bulkClassId` is the class picked for Excel imports (every
  // parsed row gets this classId pre-filled). `excelFileInputRef` is the
  // hidden `<input type="file">` we click programmatically when the user
  // taps the "آپلود فایل اکسل" button.
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkSubmitting, setBulkSubmitting] = React.useState(false);
  const [bulkRows, setBulkRows] = React.useState<BulkRow[]>([]);
  const [bulkClassId, setBulkClassId] = React.useState<string>("");
  const [createdCreds, setCreatedCreds] = React.useState<CreatedUserWithCreds | null>(null);
  const [bulkCreated, setBulkCreated] = React.useState<BulkCreatedRow[] | null>(null);
  const excelFileInputRef = React.useRef<HTMLInputElement>(null);

  // Phase 25 — edit-class/group dialog state
  const [editClassGroupOpen, setEditClassGroupOpen] = React.useState(false);
  const [editClassGroupTarget, setEditClassGroupTarget] =
    React.useState<UserListItem | null>(null);

  // Phase 25 — fetch top-level classes for the STUDENT class selector +
  // the edit-class/group dialog. /api/admin/classes returns the principal's
  // top-level classes (parentClassId=null) each with a `groups` sub-array.
  const { data: classesData } = useQuery<{
    items: Array<{
      id: string;
      name: string;
      section: string | null;
      gradeLevel: string | null;
      groups: Array<{ id: string; name: string }>;
    }>;
  }>({
    queryKey: ["admin-classes-for-users"],
    queryFn: () => apiFetch("/api/admin/classes?pageSize=100"),
  });

  // Delete state
  const [deleteTarget, setDeleteTarget] = React.useState<UserListItem | null>(null);
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
      firstName: "",
      lastName: "",
      role: "STUDENT",
      phone: "",
      classId: "",
      classIds: [],
    });
    setFormOpen(true);
  }

  // Phase 31 — open the bulk-add dialog. Always starts with 3 empty rows
  // so the admin has room to start typing immediately; they can add more
  // or remove some. Each row needs a stable id for React keys + for the
  // remove-row handler.
  //
  // Phase 32 — `bulkClassId` is the picked class for Excel imports. When
  // the user uploads an Excel file, every parsed row gets this classId
  // pre-filled (the user can still change it per-row afterwards if they
  // want). Reset to "" when the dialog opens.
  function openBulkCreate() {
    setBulkRows([
      makeEmptyBulkRow(),
      makeEmptyBulkRow(),
      makeEmptyBulkRow(),
    ]);
    setBulkClassId("");
    setBulkOpen(true);
  }

  function makeEmptyBulkRow(): BulkRow {
    return {
      id: crypto.randomUUID(),
      firstName: "",
      lastName: "",
      classId: "",
      phone: "",
    };
  }

  function addBulkRow() {
    setBulkRows((prev) => [...prev, makeEmptyBulkRow()]);
  }

  function removeBulkRow(id: string) {
    setBulkRows((prev) => prev.filter((r) => r.id !== id));
  }

  function patchBulkRow(id: string, patch: Partial<BulkRow>) {
    setBulkRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  // Phase 32 — generate the sample Excel template (3 columns: نام،
  // نام خانوادگی، شماره تماس) and trigger a browser download. The
  // template includes a single example row so the user can see the
  // expected format; they should delete it before filling in their
  // own students.
  //
  // We use the `xlsx` library (SheetJS) which works fully client-side —
  // no backend round-trip needed. The file is named
  // `الگوی-دانش‌آموزان.xlsx` so it's obvious what it is.
  function handleDownloadSampleExcel() {
    // Header row + one example row so the user sees the format.
    const rows = [
      { "نام": "علی", "نام خانوادگی": "محمدی", "شماره تماس": "09123456789" },
      { "نام": "", "نام خانوادگی": "", "شماره تماس": "" },
      { "نام": "", "نام خانوادگی": "", "شماره تماس": "" },
      { "نام": "", "نام خانوادگی": "", "شماره تماس": "" },
      { "نام": "", "نام خانوادگی": "", "شماره تماس": "" },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["نام", "نام خانوادگی", "شماره تماس"],
    });
    // Set column widths so the headers fit comfortably.
    ws["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "دانش‌آموزان");
    XLSX.writeFile(wb, "الگوی-دانش‌آموزان.xlsx");
    toast({
      title: "فایل نمونه دانلود شد",
      description:
        "ستون‌های «نام»، «نام خانوادگی» و «شماره تماس» را پر کنید و سپس آن را آپلود کنید.",
    });
  }

  // Phase 32 — parse an uploaded Excel file and populate the tabular
  // rows. The file must have the columns: نام، نام خانوادگی، شماره تماس
  // (in any order — we match by header name). Empty rows are skipped.
  //
  // Before calling this, the user must have picked a class in the
  // `bulkClassId` dropdown — that classId is pre-filled for every
  // parsed row. If they haven't picked one, we toast an error + abort.
  async function handleExcelUpload(file: File) {
    if (!file) return;
    // Require a class to be picked first — per the user's spec, "before
    // uploading the Excel file, the platform should ask the user to
    // pick a class so the students get imported into that class".
    if (!bulkClassId) {
      toast({
        title: "ابتدا کلاس را انتخاب کنید",
        description:
          "قبل از آپلود فایل اکسل، کلاسی که دانش‌آموزان باید در آن ایمپورت شوند را انتخاب کنید.",
        variant: "destructive",
      });
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      // Take the first sheet.
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        toast({
          title: "فایل اکسل خالی است",
          variant: "destructive",
        });
        return;
      }
      const ws = wb.Sheets[sheetName];
      // `defval: ""` ensures empty cells become "" rather than skipped
      // (so a row with only firstName still parses lastName as "").
      // `raw: false` formats all values as strings (so phone numbers
      // aren't read as numbers + lose leading zeros).
      const parsed: Record<string, unknown>[] = XLSX.utils.sheet_to_json(
        ws,
        { defval: "", raw: false },
      );
      if (parsed.length === 0) {
        toast({
          title: "هیچ ردیفی در فایل اکسل پیدا نشد",
          variant: "destructive",
        });
        return;
      }
      // Cap the import size (matches the backend's 200-student cap).
      if (parsed.length > 200) {
        toast({
          title: "فایل بیش از حد بزرگ است",
          description: "حداکثر ۲۰۰ دانش‌آموز در هر بار قابل ثبت است.",
          variant: "destructive",
        });
        return;
      }
      // Build rows from the parsed data. We support these header names:
      //   نام / first name / firstname / name
      //   نام خانوادگی / last name / lastname / surname / family
      //   شماره تماس / phone / tel / mobile
      // The header matching is case-insensitive + trims whitespace.
      const findField = (row: Record<string, unknown>, keys: string[]) => {
        for (const k of Object.keys(row)) {
          const normalized = k.trim().toLowerCase();
          if (keys.some((key) => key === normalized)) {
            return (row[k] ?? "").toString().trim();
          }
        }
        return "";
      };
      const newRows: BulkRow[] = [];
      let skipped = 0;
      for (const row of parsed) {
        const firstName = findField(row, [
          "نام",
          "first name",
          "firstname",
          "name",
          "first",
        ]);
        const lastName = findField(row, [
          "نام خانوادگی",
          "last name",
          "lastname",
          "surname",
          "family",
          "last",
        ]);
        const phone = findField(row, [
          "شماره تماس",
          "phone",
          "tel",
          "mobile",
          "تلفن",
        ]);
        // Skip rows where both firstName + lastName are empty (likely
        // a blank row in the middle of the sheet).
        if (!firstName && !lastName) {
          skipped++;
          continue;
        }
        newRows.push({
          id: crypto.randomUUID(),
          firstName,
          lastName,
          classId: bulkClassId,
          phone,
        });
      }
      if (newRows.length === 0) {
        toast({
          title: "هیچ ردیف معتبری در فایل پیدا نشد",
          description:
            "اطمینان حاصل کنید که ستون‌های «نام» و «نام خانوادگی» در سطر اول فایل وجود دارند.",
          variant: "destructive",
        });
        return;
      }
      setBulkRows(newRows);
      toast({
        title: "فایل اکسل خوانده شد",
        description: `${newRows.length} ردیف از فایل استخراج شد${
          skipped > 0 ? ` (${skipped} ردیف خالی نادیده گرفته شد)` : ""
        }. کلاس «${
          classesData?.items.find((c) => c.id === bulkClassId)?.name ?? "—"
        }» برای همه ردیف‌ها تنظیم شد. در صورت نیاز می‌توانید ردیف‌ها را ویرایش کنید.`,
      });
    } catch (err) {
      toast({
        title: "خطا در خواندن فایل اکسل",
        description: err instanceof Error ? err.message : "خطای غیرمنتظره",
        variant: "destructive",
      });
    }
  }

  function openEdit(u: UserListItem) {
    setEditing(u);
    setForm({
      username: u.username,
      password: "",
      fullName: u.fullName,
      firstName: "",
      lastName: "",
      role: u.role,
      phone: u.phone || "",
      // Phase 25 — pre-select the user's current class (if any) so the
      // dropdown reflects their existing enrollment.
      classId: u.primaryClass?.id ?? "",
      classIds: u.classes.map((c) => c.id),
    });
    setFormOpen(true);
  }

  // Phase 25 — open the dedicated "edit class/group" dialog for a user.
  function openEditClassGroup(u: UserListItem) {
    setEditClassGroupTarget(u);
    setEditClassGroupOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editing) {
        // ---- EDIT FLOW (existing user) ----
        // Phase 25 — PATCH endpoint doesn't (yet) handle classId changes;
        // the dedicated EditClassGroupDialog is the place for that. We
        // simply forward the regular profile fields here.
        const payload: Record<string, string> = {
          username: form.username.trim(),
          fullName: form.fullName.trim(),
          role: form.role,
        };
        if (form.phone.trim()) payload.phone = form.phone.trim();
        if (form.password) payload.password = form.password;
        await apiFetch(`/api/admin/users/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast({
          title: "کاربر ویرایش شد",
          description: `اطلاعات ${payload.fullName} به‌روزرسانی شد`,
        });
        setFormOpen(false);
      } else {
        // ---- CREATE FLOW (Phase 31 redesign) ----
        // The admin enters: role, firstName, lastName, phone, class(es).
        // The backend auto-generates the username + password. We surface
        // them in a success dialog so the admin can give them to the
        // user.
        const firstName = form.firstName.trim();
        const lastName = form.lastName.trim();
        if (!firstName || !lastName) {
          throw new Error("نام و نام خانوادگی الزامی است");
        }
        // Validate class requirement based on role.
        //   - STUDENT: single classId required
        //   - TEACHER: at least one class in classIds required
        if (form.role === "STUDENT") {
          if (!form.classId) {
            throw new Error("انتخاب کلاس برای دانش‌آموز الزامی است");
          }
        } else if (form.role === "TEACHER") {
          if (form.classIds.length === 0) {
            throw new Error("انتخاب حداقل یک کلاس برای معلم الزامی است");
          }
        }
        const payload: Record<string, unknown> = {
          firstName,
          lastName,
          role: form.role,
        };
        if (form.phone.trim()) payload.phone = form.phone.trim();
        if (form.role === "STUDENT") {
          payload.classId = form.classId;
        } else if (form.role === "TEACHER") {
          payload.classIds = form.classIds;
        }
        const res = await apiFetch<CreatedUserWithCreds>("/api/admin/users", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        // Show the generated credentials in a success dialog (so the
        // admin can copy them to give to the user).
        setCreatedCreds(res);
        setFormOpen(false);
        toast({
          title: form.role === "STUDENT" ? "دانش‌آموز ایجاد شد" : "معلم ایجاد شد",
          description: `${firstName} ${lastName} با موفقیت ساخته شد.`,
        });
      }
      qc.invalidateQueries({ queryKey: ["admin-users"] });
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

  // Phase 31 — submit the bulk-add form. Validates each row client-side,
  // then calls POST /api/admin/users/bulk. The backend auto-generates
  // username/password per row + auto-enrolls each student in their class +
  // subject groups.
  async function handleBulkSubmit() {
    if (bulkSubmitting) return;
    // Client-side validation: each row must have firstName, lastName, classId.
    const trimmed = bulkRows.map((r) => ({
      ...r,
      firstName: r.firstName.trim(),
      lastName: r.lastName.trim(),
      classId: r.classId.trim(),
      phone: r.phone.trim(),
    }));
    if (trimmed.length === 0) {
      toast({
        title: "حداقل یک ردیف وارد کنید",
        variant: "destructive",
      });
      return;
    }
    for (let i = 0; i < trimmed.length; i++) {
      const r = trimmed[i];
      if (!r.firstName || !r.lastName) {
        toast({
          title: `ردیف ${i + 1}: نام و نام خانوادگی الزامی است`,
          variant: "destructive",
        });
        return;
      }
      if (!r.classId) {
        toast({
          title: `ردیف ${i + 1}: انتخاب کلاس الزامی است`,
          variant: "destructive",
        });
        return;
      }
    }
    setBulkSubmitting(true);
    try {
      const res = await apiFetch<{ created: BulkCreatedRow[]; count: number }>(
        "/api/admin/users/bulk",
        {
          method: "POST",
          body: JSON.stringify({ students: trimmed }),
        },
      );
      setBulkCreated(res.created);
      setBulkOpen(false);
      toast({
        title: "ثبت گروهی انجام شد",
        description: `${res.count} دانش‌آموز با موفقیت ساخته شد.`,
      });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      toast({
        title: "خطا در ثبت گروهی",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBulkSubmitting(false);
    }
  }

  // Phase 31 — toggle a class in the TEACHER multi-select classIds set.
  function toggleTeacherClass(id: string) {
    setForm((prev) => {
      const next = new Set(prev.classIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, classIds: Array.from(next) };
    });
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" });
      toast({
        title: "کاربر حذف شد",
        description: `کاربر ${deleteTarget.fullName} حذف شد`,
      });
      setDeleteTarget(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
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
          await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });
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
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    } finally {
      setBulkDeleting(false);
      setBulkDeleteProgress({ done: 0, total: 0 });
    }
  }

  const currentUser = session?.user;

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">کاربران مدرسه</h2>
          <p className="text-muted-foreground text-sm">
            مدیریت معلمان و دانش‌آموزان مدرسه شما
          </p>
        </div>
        {/* Phase 31 — split the single "افزودن کاربر" button into two:
            single-add (student OR teacher) + bulk-add (students only). */}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={openCreate} variant="default" className="gap-2">
            <UserCog className="size-4" />
            افزودن تکی کاربر
          </Button>
          <Button onClick={openBulkCreate} variant="outline" className="gap-2">
            <UsersIcon className="size-4" />
            افزودن گروهی کاربر
          </Button>
        </div>
      </div>

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

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute right-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                placeholder="جستجو بر اساس نام یا نام کاربری..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pr-10"
              />
            </div>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v as "ALL" | Role);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="فیلتر نقش" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">همه نقش‌ها</SelectItem>
                <SelectItem value="STUDENT">دانش‌آموز</SelectItem>
                <SelectItem value="TEACHER">معلم</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="text-destructive p-6 text-center text-sm">
              خطا در بارگذاری کاربران: {(error as Error)?.message}
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
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="انتخاب همه"
                      checked={
                        !!data?.items?.length &&
                        data.items.every((u) => selected.has(u.id))
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>کاربر</TableHead>
                  <TableHead>نام کاربری</TableHead>
                  <TableHead>نقش</TableHead>
                  <TableHead>کلاس</TableHead>
                  <TableHead>گروه</TableHead>
                  <TableHead>تلفن</TableHead>
                  <TableHead>عضویت‌ها</TableHead>
                  <TableHead>عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-muted-foreground py-8 text-center"
                    >
                      کاربری یافت نشد
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((u) => {
                  const isSelf = currentUser?.id === u.id;
                  const isChecked = selected.has(u.id);
                  return (
                    <TableRow
                      key={u.id}
                      data-state={isChecked ? "selected" : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          aria-label={`انتخاب ${u.fullName}`}
                          checked={isChecked}
                          onCheckedChange={() => toggleUser(u.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{u.fullName}</span>
                          {isSelf && (
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                            >
                              شما
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.username}
                      </TableCell>
                      <TableCell>{roleBadge(u.role)}</TableCell>
                      {/* Phase 25 — کلاس column */}
                      <TableCell>
                        {u.primaryClass ? (
                          <Badge
                            variant="secondary"
                            className="gap-1 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                          >
                            <School className="size-3" />
                            {u.primaryClass.name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {/* Phase 25 — گروه column (shows all subject groups, comma-separated badges) */}
                      <TableCell>
                        {u.groups.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {u.groups.slice(0, 3).map((g) => (
                              <Badge
                                key={g.id}
                                variant="outline"
                                className="text-[10px] gap-1"
                              >
                                <UsersIcon className="size-2.5" />
                                {g.name}
                              </Badge>
                            ))}
                            {u.groups.length > 3 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] persian-nums"
                              >
                                +{u.groups.length - 3}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs persian-nums">
                        {u.phone || "—"}
                      </TableCell>
                      <TableCell className="persian-nums">
                        {u._count?.memberships ?? 0}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
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
                            className="size-8 text-sky-600 hover:bg-sky-500/10 hover:text-sky-600"
                            onClick={() => openEditClassGroup(u)}
                            aria-label="ویرایش کلاس و گروه"
                            title="ویرایش کلاس و گروه"
                          >
                            <Layers className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => openEdit(u)}
                            aria-label="ویرایش"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive size-8"
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

      {/* Empty state when no users */}
      {!isLoading && data && data.items.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-center gap-3 py-12">
          <UserCircle className="size-12 opacity-40" />
          <p>هیچ کاربری یافت نشد. می‌توانید کاربر جدید اضافه کنید.</p>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "ویرایش کاربر" : "افزودن کاربر جدید"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "رمز عبور را خالی بگذارید تا تغییر نکند."
                : "اطلاعات کاربر جدید را وارد کنید."}
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
                  <p className="text-sm font-medium truncate">
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

            {editing ? (
              /* ---- EDIT FLOW (existing user) ----
                 Phase 31 — keep the legacy fullName + username + password
                 fields. Class membership is changed via the dedicated
                 EditClassGroupDialog (the "Layers" icon button on each
                 row). */
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="fullName">نام و نام خانوادگی</Label>
                  <Input
                    id="fullName"
                    value={form.fullName}
                    onChange={(e) =>
                      setForm({ ...form, fullName: e.target.value })
                    }
                    required
                    placeholder="مثال: علی رضایی"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="username">نام کاربری</Label>
                    <Input
                      id="username"
                      value={form.username}
                      onChange={(e) =>
                        setForm({ ...form, username: e.target.value })
                      }
                      required
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="password">رمز عبور</Label>
                    <Input
                      id="password"
                      type="password"
                      value={form.password}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                      placeholder="بدون تغییر"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="role">نقش</Label>
                    <Select
                      value={form.role}
                      onValueChange={(v) =>
                        setForm({ ...form, role: v as Role })
                      }
                    >
                      <SelectTrigger id="role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STUDENT">دانش‌آموز</SelectItem>
                        <SelectItem value="TEACHER">معلم</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="phone-edit">تلفن (اختیاری)</Label>
                    <Input
                      id="phone-edit"
                      value={form.phone}
                      onChange={(e) =>
                        setForm({ ...form, phone: e.target.value })
                      }
                      placeholder="09123456789"
                      inputMode="tel"
                    />
                  </div>
                </div>
              </>
            ) : (
              /* ---- CREATE FLOW (Phase 31 redesign) ----
                 Fields per the user spec: نقش / نام / نام خانوادگی /
                 کلاس / شماره تماس. No username/password — the backend
                 auto-generates them and we surface them in a success
                 dialog after creation. */
              <>
                {/* Role selector — first field. When the user toggles
                    between STUDENT and TEACHER, the class field below
                    switches between single-select (STUDENT) and multi-
                    select chips (TEACHER). We also clear any stale
                    class selection when switching role to avoid
                    accidentally enrolling a STUDENT in multiple classes
                    or a TEACHER in just one. */}
                <div className="flex flex-col gap-2">
                  <Label>نقش</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          role: "STUDENT",
                          classId: "",
                          classIds: [],
                        })
                      }
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        form.role === "STUDENT"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-accent"
                      }`}
                    >
                      <UserCircle className="size-4" />
                      دانش‌آموز
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          role: "TEACHER",
                          classId: "",
                          classIds: [],
                        })
                      }
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        form.role === "TEACHER"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-accent"
                      }`}
                    >
                      <UserPlus className="size-4" />
                      معلم
                    </button>
                  </div>
                </div>

                {/* First name + last name — two separate fields per the
                    user spec. The backend combines them into `fullName`
                    on submit. */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="firstName">
                      نام <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="firstName"
                      value={form.firstName}
                      onChange={(e) =>
                        setForm({ ...form, firstName: e.target.value })
                      }
                      required
                      placeholder="مثال: علی"
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="lastName">
                      نام خانوادگی <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="lastName"
                      value={form.lastName}
                      onChange={(e) =>
                        setForm({ ...form, lastName: e.target.value })
                      }
                      required
                      placeholder="مثال: محمدی"
                    />
                  </div>
                </div>

                {/* Class field — single-select dropdown for STUDENT,
                    multi-select chips for TEACHER. The chips let the
                    admin pick multiple classes for a teacher (so they
                    can teach across classes). */}
                <div className="flex flex-col gap-2">
                  <Label>
                    {form.role === "STUDENT" ? "کلاس دانش‌آموز" : "کلاس‌های معلم"}{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  {form.role === "STUDENT" ? (
                    <Select
                      value={form.classId}
                      onValueChange={(v) => setForm({ ...form, classId: v })}
                    >
                      <SelectTrigger id="classId">
                        <SelectValue placeholder="یک کلاس انتخاب کنید" />
                      </SelectTrigger>
                      <SelectContent>
                        {classesData?.items.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                            {c.section ? ` · شعبه ${c.section}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex max-h-36 flex-wrap gap-1.5 rounded-md border bg-muted/20 p-2">
                      {classesData?.items.length === 0 ? (
                        <p className="px-1 py-1 text-xs text-muted-foreground">
                          کلاسی موجود نیست.
                        </p>
                      ) : (
                        classesData?.items.map((c) => {
                          const selected = form.classIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleTeacherClass(c.id)}
                              aria-pressed={selected}
                              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                              }`}
                            >
                              {selected ? (
                                <Check className="size-3" />
                              ) : null}
                              {c.name}
                              {c.section ? ` · شعبه ${c.section}` : ""}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {form.role === "STUDENT"
                      ? "دانش‌آموز به‌طور خودکار وارد کلاس و تمام گروه‌های درسی آن می‌شود"
                      : "معلم به‌طور خودکار وارد همه کلاس‌های انتخاب‌شده و گروه‌های درسی آن‌ها می‌شود"}
                  </p>
                </div>

                {/* Phone — last field (optional). */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="phone-create">شماره تماس (اختیاری)</Label>
                  <Input
                    id="phone-create"
                    value={form.phone}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                    placeholder="09123456789"
                    inputMode="tel"
                  />
                </div>

                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                  نام کاربری و رمز عبور پس از ثبت، به‌صورت خودکار توسط سامانه
                  ساخته شده و در پنجره‌ای نمایش داده می‌شوند تا در اختیار
                  {form.role === "STUDENT" ? " دانش‌آموز" : " معلم"} قرار دهید.
                </div>
              </>
            )}
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
                    : form.role === "STUDENT"
                      ? "ایجاد دانش‌آموز"
                      : "ایجاد معلم"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm (single) */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف کاربر"
        description={
          deleteTarget ? (
            <>
              آیا از حذف کاربر{" "}
              <strong className="text-foreground">{deleteTarget.fullName}</strong>{" "}
              با نام کاربری{" "}
              <strong className="text-foreground">{deleteTarget.username}</strong>{" "}
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
            کاربر انتخاب‌شده مطمئن هستید؟ حذف‌ها یکی‌یکی انجام می‌شود.
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

      {/* Add to class dialog (shared: batch + single) */}
      <AddToClassDialog
        open={addToClassOpen}
        onOpenChange={(o) => setAddToClassOpen(o)}
        userIds={Array.from(selected)}
        enrollApiBase="/api/admin/enroll"
        classesApiBase="/api/admin/classes"
        invalidateKeys={[["admin-users"], ["admin-stats"]]}
        onSuccess={() => {
          clearSelection();
        }}
      />

      {/* Phase 25 — edit class/group dialog */}
      <EditClassGroupDialog
        user={editClassGroupTarget}
        open={editClassGroupOpen}
        onOpenChange={setEditClassGroupOpen}
      />

      {/* Phase 31 — bulk-add dialog (students only, Excel-like grid).
          Phase 32 — extended with: class picker at the top (required
          before Excel upload), "دانلود فایل نمونه" button (downloads
          an .xlsx with 3 columns: نام، نام خانوادگی، شماره تماس), and
          an Excel file upload input that parses the file + populates
          the tabular rows with the picked class pre-filled per row. */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        {/* Phase 33 — bound the dialog to the viewport so adding many
            rows can't push it off-screen. The dialog is a flex column
            with `max-h-[90vh] overflow-hidden`; the body wrapper is
            `flex-1 min-h-0` so it shrinks to fit; the table container
            is `flex-1 min-h-0 overflow-auto` so the table scrolls
            within the dialog (vertically for many rows, horizontally
            for narrow mobile widths) while the class picker + Excel
            section + add-row button + footer stay visible. */}
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <UsersIcon className="size-5 text-primary" />
              افزودن گروهی دانش‌آموز
            </DialogTitle>
            <DialogDescription>
              می‌توانید ردیف‌ها را به‌صورت دستی وارد کنید یا یک فایل اکسل
              آپلود کنید. نام کاربری و رمز عبور برای هر دانش‌آموز به‌صورت
              خودکار ساخته می‌شود و پس از ثبت نمایش داده خواهد شد.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden">
            {/* ---- Phase 32: class picker (required before Excel upload) ---- */}
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
              <Label
                htmlFor="bulk-class-id"
                className="text-xs text-emerald-700 dark:text-emerald-300"
              >
                کلاس مقصد (الزامی برای ایمپورت از اکسل)
              </Label>
              <Select
                value={bulkClassId}
                onValueChange={setBulkClassId}
                disabled={bulkSubmitting}
              >
                <SelectTrigger id="bulk-class-id" className="mt-1.5 h-9 w-full">
                  <SelectValue placeholder="یک کلاس برای ایمپورت دانش‌آموزان انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  {classesData?.items.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.section ? ` · شعبه ${c.section}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                دانش‌آموزان ایمپورت‌شده از فایل اکسل به‌طور خودکار در این کلاس
                و تمام گروه‌های درسی آن عضو می‌شوند.
              </p>
            </div>

            {/* ---- Phase 32: Excel sample download + file upload ---- */}
            <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadSampleExcel}
                  disabled={bulkSubmitting}
                  className="gap-1.5"
                >
                  <Download className="size-4" />
                  دانلود فایل نمونه
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  فایل اکسل شامل سه ستون: نام، نام خانوادگی، شماره تماس
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={excelFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      void handleExcelUpload(f);
                    }
                    // Reset the input so the same file can be selected
                    // again later (otherwise the change event won't
                    // fire for the same filename).
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => excelFileInputRef.current?.click()}
                  disabled={bulkSubmitting}
                  className="gap-1.5"
                >
                  <FileSpreadsheet className="size-4" />
                  آپلود فایل اکسل
                </Button>
              </div>
            </div>

            {/* ---- Table-like grid — one row per student ----
                Phase 33 — `flex-1 min-h-0 overflow-auto` so the table
                scrolls within the bounded dialog (both vertically for
                many rows AND horizontally for narrow mobile widths).
                The inner `<table>` has `min-w-[640px]` so on phones
                the 6 columns don't get squished — they scroll
                horizontally instead. */}
            <div className="flex-1 min-h-0 overflow-auto rounded-md border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <tr>
                    <th className="px-2 py-2 text-right font-medium text-xs">ردیف</th>
                    <th className="px-2 py-2 text-right font-medium text-xs">نام *</th>
                    <th className="px-2 py-2 text-right font-medium text-xs">نام خانوادگی *</th>
                    <th className="px-2 py-2 text-right font-medium text-xs">کلاس *</th>
                    <th className="px-2 py-2 text-right font-medium text-xs">شماره تماس</th>
                    <th className="w-10 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {bulkRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-muted-foreground py-6 text-center text-xs"
                      >
                        هیچ ردیفی وجود ندارد. می‌توانید روی «افزودن ردیف» بزنید
                        یا یک فایل اکسل آپلود کنید.
                      </td>
                    </tr>
                  ) : (
                    bulkRows.map((row, idx) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-2 py-1.5 align-middle text-xs text-muted-foreground persian-nums">
                          {idx + 1}
                        </td>
                        <td className="px-1.5 py-1.5">
                          <Input
                            value={row.firstName}
                            onChange={(e) =>
                              patchBulkRow(row.id, { firstName: e.target.value })
                            }
                            placeholder="نام"
                            className="h-9"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <Input
                            value={row.lastName}
                            onChange={(e) =>
                              patchBulkRow(row.id, { lastName: e.target.value })
                            }
                            placeholder="نام خانوادگی"
                            className="h-9"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <Select
                            value={row.classId}
                            onValueChange={(v) =>
                              patchBulkRow(row.id, { classId: v })
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="انتخاب کلاس" />
                            </SelectTrigger>
                            <SelectContent>
                              {classesData?.items.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                  {c.section ? ` · شعبه ${c.section}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-1.5 py-1.5">
                          <Input
                            value={row.phone}
                            onChange={(e) =>
                              patchBulkRow(row.id, { phone: e.target.value })
                            }
                            placeholder="0912..."
                            inputMode="tel"
                            className="h-9"
                            dir="ltr"
                          />
                        </td>
                        <td className="px-1.5 py-1.5 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive size-7"
                            onClick={() => removeBulkRow(row.id)}
                            aria-label="حذف ردیف"
                            disabled={bulkSubmitting}
                          >
                            <Trash className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addBulkRow}
                disabled={bulkSubmitting}
                className="gap-1.5"
              >
                <Plus className="size-4" />
                افزودن ردیف
              </Button>
              <span className="text-xs text-muted-foreground persian-nums">
                {bulkRows.length} ردیف
              </span>
            </div>
          </div>

          <DialogFooter className="flex-shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkOpen(false)}
              disabled={bulkSubmitting}
            >
              انصراف
            </Button>
            <Button
              type="button"
              onClick={handleBulkSubmit}
              disabled={bulkSubmitting || bulkRows.length === 0}
              className="gap-1.5"
            >
              {bulkSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UsersIcon className="size-4" />
              )}
              ثبت گروهی ({bulkRows.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 31 — single-create success dialog. Shows the auto-generated
          username + password so the admin can copy them and give them to
          the user. */}
      <Dialog
        open={!!createdCreds}
        onOpenChange={(o) => !o && setCreatedCreds(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <UserPlus className="size-5" />
              {createdCreds?.role === "STUDENT"
                ? "دانش‌آموز ایجاد شد"
                : "معلم ایجاد شد"}
            </DialogTitle>
            <DialogDescription>
              {createdCreds?.fullName} با موفقیت ساخته شد. نام کاربری و رمز
              عبور زیر را به ایشان بدهید.
            </DialogDescription>
          </DialogHeader>
          {createdCreds ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-3">
                <Label className="text-xs text-muted-foreground">نام و نام خانوادگی</Label>
                <p className="text-sm font-medium">{createdCreds.fullName}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-3">
                  <Label className="text-xs text-muted-foreground">نام کاربری</Label>
                  <div className="flex items-center justify-between gap-2">
                    <code dir="ltr" className="text-sm font-mono">
                      {createdCreds.username}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(createdCreds.username);
                        toast({ title: "کپی شد", description: "نام کاربری کپی شد" });
                      }}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="کپی نام کاربری"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-3">
                  <Label className="text-xs text-muted-foreground">رمز عبور</Label>
                  <div className="flex items-center justify-between gap-2">
                    <code dir="ltr" className="text-sm font-mono">
                      {createdCreds.generatedPassword ?? "—"}
                    </code>
                    {createdCreds.generatedPassword ? (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(
                            createdCreds.generatedPassword ?? "",
                          );
                          toast({ title: "کپی شد", description: "رمز عبور کپی شد" });
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="کپی رمز عبور"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {createdCreds.role === "STUDENT"
                  ? "دانش‌آموز به‌طور خودکار در کلاس و تمام گروه‌های درسی آن عضو شد."
                  : "معلم به‌طور خودکار در کلاس‌ها و گروه‌های درسی آن‌ها عضو شد."}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={() => setCreatedCreds(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 31 — bulk-create success dialog. Shows the auto-generated
          username + password for every created student in a table so the
          admin can copy them all at once. */}
      <Dialog
        open={!!bulkCreated}
        onOpenChange={(o) => !o && setBulkCreated(null)}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <UsersIcon className="size-5" />
              ثبت گروهی انجام شد
            </DialogTitle>
            <DialogDescription>
              {bulkCreated?.length ?? 0} دانش‌آموز با موفقیت ساخته شد. نام
              کاربری و رمز عبور هر یک را در اختیار ایشان قرار دهید.
            </DialogDescription>
          </DialogHeader>
          {bulkCreated && bulkCreated.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <tr>
                    <th className="px-2 py-2 text-right text-xs font-medium">ردیف</th>
                    <th className="px-2 py-2 text-right text-xs font-medium">نام</th>
                    <th className="px-2 py-2 text-right text-xs font-medium">کلاس</th>
                    <th className="px-2 py-2 text-right text-xs font-medium">نام کاربری</th>
                    <th className="px-2 py-2 text-right text-xs font-medium">رمز عبور</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkCreated.map((r, idx) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-1.5 text-xs text-muted-foreground persian-nums">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-1.5 text-sm">{r.fullName}</td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {r.className ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <code dir="ltr" className="font-mono text-xs">
                          {r.username}
                        </code>
                      </td>
                      <td className="px-2 py-1.5">
                        <code dir="ltr" className="font-mono text-xs">
                          {r.password}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={() => setBulkCreated(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface EditClassGroupDialogProps {
  user: UserListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Phase 25 — "Edit class/group" dialog.
 *
 * Lets a school principal preview + (eventually) change a user's enrolled
 * class + their subject-group memberships from the /admin/users page. The
 * UI scaffolding is implemented here, but the backend endpoints for
 * changing the class membership post-create are NOT implemented yet — so
 * the "اعمال تغییرات" button shows a friendly Persian toast explaining
 * that the action is still under development, and points the user to the
 * per-class detail page (`/admin/classes/[id]`) where group membership
 * management is already supported.
 */
function EditClassGroupDialog({
  user,
  open,
  onOpenChange,
}: EditClassGroupDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Share the same query key as the UsersManager parent so the network
  // request is deduped (react-query hands us back the cached list).
  const { data: classesData } = useQuery<{
    items: Array<{
      id: string;
      name: string;
      section: string | null;
      gradeLevel: string | null;
      groups: Array<{ id: string; name: string }>;
    }>;
  }>({
    queryKey: ["admin-classes-for-users"],
    queryFn: () => apiFetch("/api/admin/classes?pageSize=100"),
    enabled: open,
  });

  // Local state: the class the user is currently being assigned to, plus
  // the set of subject-group ids within that class that they should be a
  // member of. These mirror what the server has on dialog open and are
  // updated locally as the principal toggles checkboxes — they are NOT
  // synced back to the server (see `handleApplyChanges`).
  const [selectedClassId, setSelectedClassId] = React.useState("");
  const [selectedGroupIds, setSelectedGroupIds] = React.useState<
    Set<string>
  >(new Set());

  // Reset local state from the user whenever the dialog opens or the
  // target user changes. We pre-select the user's existing class + pre-
  // check every subject group they are already a member of (regardless
  // of which class those groups are in, since for STUDENTs the groups
  // normally belong to the user's single primary class anyway).
  React.useEffect(() => {
    if (open && user) {
      setSelectedClassId(user.primaryClass?.id ?? "");
      setSelectedGroupIds(new Set(user.groups.map((g) => g.id)));
    }
  }, [open, user]);

  // The list of subject groups that belong to the currently-selected
  // class. We use this to populate the multi-select section.
  const selectedClass = classesData?.items.find(
    (c) => c.id === selectedClassId,
  );
  const classGroups = selectedClass?.groups ?? [];

  // When the principal changes the class dropdown, we re-seed the group
  // checkboxes to "every subject group in the new class that the user is
  // already a member of" — so the dialog reflects the user's current
  // membership rather than carrying over selections from the previous
  // class.
  function handleClassChange(newClassId: string) {
    setSelectedClassId(newClassId);
    const newClass = classesData?.items.find((c) => c.id === newClassId);
    const groupIdsInNewClass = new Set(
      newClass?.groups.map((g) => g.id) ?? [],
    );
    const userGroupIds = new Set((user?.groups ?? []).map((g) => g.id));
    const intersect = new Set(
      Array.from(userGroupIds).filter((id) => groupIdsInNewClass.has(id)),
    );
    setSelectedGroupIds(intersect);
  }

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Apply button — backend class/group change endpoints are NOT
  // implemented yet, so we explain to the principal where to do this
  // today and toast that the action is under development.
  function handleApplyChanges() {
    if (!user) return;
    const originalClassId = user.primaryClass?.id ?? "";
    const originalGroupIds = new Set(user.groups.map((g) => g.id));
    const classChanged = selectedClassId !== originalClassId;
    const groupsChanged =
      selectedGroupIds.size !== originalGroupIds.size ||
      Array.from(selectedGroupIds).some((id) => !originalGroupIds.has(id)) ||
      Array.from(originalGroupIds).some((id) => !selectedGroupIds.has(id));

    if (classChanged) {
      toast({
        title: "تغییر کلاس",
        description: "تغییر کلاس در حال توسعه است",
      });
      // Refresh the users list so any external changes are reflected.
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      return;
    }
    if (groupsChanged) {
      toast({
        title: "مدیریت عضویت گروه‌ها",
        description:
          "مدیریت عضویت گروه‌ها از صفحه جزئیات کلاس قابل انجام است",
      });
      return;
    }
    toast({
      title: "تغییری اعمال نشد",
      description: "هیچ تغییری برای اعمال وجود ندارد",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ویرایش کلاس و گروه</DialogTitle>
          <DialogDescription>
            {user ? (
              <span>
                {user.fullName} —{" "}
                <span dir="ltr">@{user.username}</span>
              </span>
            ) : (
              ""
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Section 1 — class selector */}
          <div className="flex flex-col gap-2">
            <Label>کلاس</Label>
            <Select
              value={selectedClassId}
              onValueChange={handleClassChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="انتخاب کلاس" />
              </SelectTrigger>
              <SelectContent>
                {classesData?.items.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.section ? ` · شعبه ${c.section}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Section 2 — subject groups within the selected class */}
          <div className="flex flex-col gap-2">
            <Label>گروه‌های درسی</Label>
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {classGroups.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  {selectedClassId
                    ? "این کلاس هنوز گروه درسی ندارد"
                    : "ابتدا یک کلاس انتخاب کنید"}
                </p>
              ) : (
                classGroups.map((g) => {
                  const checked = selectedGroupIds.has(g.id);
                  const wasMember = (user?.groups ?? []).some(
                    (ug) => ug.id === g.id,
                  );
                  return (
                    <label
                      key={g.id}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleGroup(g.id)}
                        aria-label={`انتخاب گروه ${g.name}`}
                      />
                      <span className="flex-1">{g.name}</span>
                      {wasMember && (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                        >
                          عضو فعلی
                        </Badge>
                      )}
                    </label>
                  );
                })
              )}
            </div>
            {selectedClassId && (
              <a
                href={`/admin/classes/${selectedClassId}`}
                className="text-xs text-sky-600 hover:underline self-start"
              >
                مدیریت عضویت گروه‌ها از صفحه جزئیات کلاس ←
              </a>
            )}
          </div>

          {/* Section 3 — apply */}
          <Button
            type="button"
            onClick={handleApplyChanges}
            disabled={!user || !selectedClassId}
            className="gap-2 self-start"
          >
            اعمال تغییرات
          </Button>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            بستن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
