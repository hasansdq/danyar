"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  School,
  Users,
  Trash2,
  Lock,
  Unlock,
  LogIn,
  Loader2,
  Megaphone,
  Settings2,
  Paperclip,
  X,
  Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { apiFetch } from "@/lib/api-fetch";
import { toPersianDigits } from "@/components/messenger/persian";
import { formatFileSize } from "@/components/messenger/file-helpers";
import type { ClassItem } from "@/components/messenger/types";

// ─── Types ───────────────────────────────────────────────────────────

interface DmSettings {
  dmTeacherStudent: boolean;
  dmStudentStudent: boolean;
  dmPrincipalStudent: boolean;
}

interface AdminClassItem extends ClassItem {
  teacherCount?: number;
}

// ─── Component ───────────────────────────────────────────────────────

export function BulkChatManager({ user }: { user: { id: string; role: string; schoolId?: string | null } }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [batchDeleteTarget, setBatchDeleteTarget] = React.useState(false);
  const [singleDeleteTarget, setSingleDeleteTarget] = React.useState<AdminClassItem | null>(null);
  const [dmDialogOpen, setDmDialogOpen] = React.useState(false);

  // Fetch the principal's school classes
  const { data: classes, isLoading, isError, refetch, isFetching } = useQuery<AdminClassItem[]>({
    queryKey: ["admin-classes-bulk-chat", user.id],
    queryFn: () => apiFetch<AdminClassItem[]>("/api/classes"),
  });

  // Fetch DM settings
  const { data: dmSettings, isLoading: dmLoading } = useQuery<DmSettings>({
    queryKey: ["admin-dm-settings", user.schoolId],
    queryFn: () => apiFetch<DmSettings>(`/api/teacher/dm-settings`),
    enabled: !!user.schoolId,
  });

  // ─── Selection helpers ──────────────────────────────────────────────

  function toggleSelectAll() {
    if (!classes || classes.length === 0) return;
    if (selectedIds.size === classes.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(classes.map((c) => c.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ─── DM settings ────────────────────────────────────────────────────

  async function toggleDmSetting(key: keyof DmSettings) {
    if (!dmSettings) return;
    const newVal = !dmSettings[key];
    qc.setQueryData<DmSettings>(["admin-dm-settings", user.schoolId], (prev) =>
      prev ? { ...prev, [key]: newVal } : prev,
    );
    try {
      await apiFetch("/api/teacher/dm-settings", {
        method: "PATCH",
        body: JSON.stringify({ [key]: newVal }),
      });
      toast({ title: "تنظیمات ذخیره شد" });
    } catch (err) {
      qc.setQueryData<DmSettings>(["admin-dm-settings", user.schoolId], (prev) =>
        prev ? { ...prev, [key]: !newVal } : prev,
      );
      toast({
        title: "خطا در ذخیره",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  // ─── Chat close/open ────────────────────────────────────────────────

  async function toggleChatClosed(cls: AdminClassItem) {
    const endpoint = cls.chatClosed ? "/api/teacher/open-chat" : "/api/teacher/close-chat";
    try {
      await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ classId: cls.id }),
      });
      toast({
        title: cls.chatClosed ? "گفتگو باز شد" : "گفتگو بسته شد",
        description: cls.name,
      });
      qc.invalidateQueries({ queryKey: ["admin-classes-bulk-chat", user.id] });
    } catch (err) {
      toast({
        title: "خطا",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  async function deleteClass(id: string) {
    try {
      await apiFetch(`/api/admin/classes/${id}`, { method: "DELETE" });
      toast({ title: "کلاس حذف شد" });
      qc.invalidateQueries({ queryKey: ["admin-classes-bulk-chat", user.id] });
      qc.invalidateQueries({ queryKey: ["admin-classes"] });
    } catch (err) {
      toast({
        title: "خطا در حذف",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  async function batchDelete() {
    const ids = [...selectedIds];
    let ok = 0;
    for (const id of ids) {
      try {
        await apiFetch(`/api/admin/classes/${id}`, { method: "DELETE" });
        ok++;
      } catch { /* continue */ }
    }
    toast({
      title: "حذف گروهی",
      description: `${toPersianDigits(ok)} از ${toPersianDigits(ids.length)} کلاس حذف شد`,
    });
    setSelectedIds(new Set());
    setBatchDeleteTarget(false);
    qc.invalidateQueries({ queryKey: ["admin-classes-bulk-chat", user.id] });
    qc.invalidateQueries({ queryKey: ["admin-classes"] });
  }

  async function batchCloseChats() {
    const ids = [...selectedIds];
    let ok = 0;
    for (const id of ids) {
      try {
        await apiFetch("/api/teacher/close-chat", {
          method: "POST",
          body: JSON.stringify({ classId: id }),
        });
        ok++;
      } catch { /* continue */ }
    }
    toast({
      title: "بستن گروهی گفتگوها",
      description: `${toPersianDigits(ok)} گفتگو بسته شد`,
    });
    setSelectedIds(new Set());
    qc.invalidateQueries({ queryKey: ["admin-classes-bulk-chat", user.id] });
  }

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            مدیریت گفتگوهای مدرسه
          </h2>
          <p className="text-muted-foreground text-sm">
            مدیریت کلاس‌ها و گفتگوهای گروهی
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setDmDialogOpen(true)}
          >
            <Settings2 className="size-4" />
            تنظیمات چت خصوصی
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} />
            به‌روزرسانی
          </Button>
        </div>
      </div>

      {/* ─── Class list with full management ─── */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <School className="size-5 text-primary" />
            لیست کلاس‌ها و گفتگوها
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Batch action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 border-b bg-emerald-500/5 px-4 py-2.5">
              <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                {toPersianDigits(selectedIds.size)} کلاس انتخاب شده
              </Badge>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={batchCloseChats}>
                <Lock className="size-3.5" />
                بستن گفتگوی انتخابی‌ها
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => setBatchDeleteTarget(true)}
              >
                <Trash2 className="size-3.5" />
                حذف گروهی
              </Button>
              <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setSelectedIds(new Set())}>
                لغو انتخاب
              </Button>
            </div>
          )}

          {isError ? (
            <div className="p-6 text-center text-destructive text-sm">
              بارگذاری کلاس‌ها ناموفق بود.
              <Button variant="outline" size="sm" className="ms-2" onClick={() => void refetch()}>
                تلاش مجدد
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !classes || classes.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              هیچ کلاسی ثبت نشده است.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.size === classes.length && classes.length > 0}
                        onCheckedChange={toggleSelectAll}
                        aria-label="انتخاب همه"
                      />
                    </TableHead>
                    <TableHead>نام کلاس</TableHead>
                    <TableHead className="text-center">دانش‌آموزان</TableHead>
                    <TableHead className="text-center">معلمان</TableHead>
                    <TableHead className="text-center">وضعیت گفتگو</TableHead>
                    <TableHead className="text-center">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classes.map((c) => (
                    <TableRow key={c.id} data-state={selectedIds.has(c.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(c.id)}
                          onCheckedChange={() => toggleOne(c.id)}
                          aria-label={`انتخاب ${c.name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/admin/classes/${c.id}`} className="text-primary hover:underline">
                          {c.name}
                        </Link>
                        {c.section ? (
                          <span className="text-muted-foreground text-xs"> · شعبه {c.section}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className="gap-1">
                          <Users className="size-3" />
                          {toPersianDigits(Math.max(0, (c.memberCount ?? 0) - (c.teacherCount ?? 0)))}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="gap-1">
                          <School className="size-3" />
                          {toPersianDigits(c.teacherCount ?? 0)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {c.chatClosed ? (
                          <Badge className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            <Lock className="size-3" /> بسته
                          </Badge>
                        ) : (
                          <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                            <Unlock className="size-3" /> باز
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button asChild variant="ghost" size="icon" className="size-8 text-primary" title="ورود به گفتگو">
                            <Link href={`/?classId=${c.id}`}>
                              <LogIn className="size-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => void toggleChatClosed(c)}
                            title={c.chatClosed ? "باز کردن گفتگو" : "بستن گفتگو"}
                          >
                            {c.chatClosed ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => setSingleDeleteTarget(c)}
                            title="حذف کلاس"
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
        </CardContent>
      </Card>

      {/* ─── DM Settings Dialog ─── */}
      <Dialog open={dmDialogOpen} onOpenChange={setDmDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="size-5 text-primary" />
              تنظیمات چت خصوصی
            </DialogTitle>
            <DialogDescription>
              کنترل کنید کدام نقش‌ها بتوانند با هم چت خصوصی کنند. مدیر↔معلم همیشه فعال است.
            </DialogDescription>
          </DialogHeader>
          {dmLoading ? (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : dmSettings ? (
            <div className="flex flex-col gap-2 py-2">
              <DmToggleRow
                label="معلم ↔ دانش‌آموز"
                description="اجازه چت خصوصی بین معلمان و دانش‌آموزان"
                checked={dmSettings.dmTeacherStudent}
                onChange={() => void toggleDmSetting("dmTeacherStudent")}
              />
              <DmToggleRow
                label="دانش‌آموز ↔ دانش‌آموز"
                description="اجازه چت خصوصی بین دانش‌آموزان"
                checked={dmSettings.dmStudentStudent}
                onChange={() => void toggleDmSetting("dmStudentStudent")}
              />
              <DmToggleRow
                label="مدیر ↔ دانش‌آموز"
                description="اجازه چت خصوصی بین مدیر و دانش‌آموزان"
                checked={dmSettings.dmPrincipalStudent}
                onChange={() => void toggleDmSetting("dmPrincipalStudent")}
              />
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                <Switch checked={true} disabled id="dm-principal-teacher" />
                <div className="flex-1">
                  <Label htmlFor="dm-principal-teacher" className="text-sm font-medium cursor-pointer">
                    مدیر ↔ معلم
                  </Label>
                  <p className="text-muted-foreground text-xs">همیشه فعال (غیرقابل تغییر)</p>
                </div>
                <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  همیشه فعال
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm py-2">تنظیمات در دسترس نیست.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Confirm dialogs ─── */}
      <ConfirmDialog
        open={batchDeleteTarget}
        onOpenChange={setBatchDeleteTarget}
        title="حذف گروهی کلاس‌ها"
        description={`آیا از حذف ${toPersianDigits(selectedIds.size)} کلاس انتخاب‌شده مطمئن هستید؟`}
        confirmText="حذف گروهی"
        onConfirm={batchDelete}
      />
      <ConfirmDialog
        open={!!singleDeleteTarget}
        onOpenChange={(v) => { if (!v) setSingleDeleteTarget(null); }}
        title="حذف کلاس"
        description={`آیا از حذف کلاس «${singleDeleteTarget?.name ?? ""}» مطمئن هستید؟`}
        confirmText="حذف"
        onConfirm={() => {
          if (singleDeleteTarget) void deleteClass(singleDeleteTarget.id);
        }}
      />
    </div>
  );
}

// ─── Sub-component: DM toggle row ────────────────────────────────────

function DmToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <Switch checked={checked} onCheckedChange={onChange} id={`dm-${label}`} />
      <div className="flex-1">
        <Label htmlFor={`dm-${label}`} className="text-sm font-medium cursor-pointer">
          {label}
        </Label>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
    </div>
  );
}
