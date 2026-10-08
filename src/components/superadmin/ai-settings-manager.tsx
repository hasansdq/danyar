"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  fetchExtendedSettings,
  patchSettingValue,
} from "@/lib/superadmin-api";
import type { SiteSettings } from "@/lib/site-settings";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { cn } from "@/lib/utils";
import { AiConversationsViewer } from "@/components/superadmin/ai-conversations-viewer";
// Phase 34 — AI provider config (custom API key + base URL + model).
import { AiProviderConfig } from "@/components/superadmin/ai-provider-config";

/**
 * SUPERADMIN-only AI-assistant settings manager.
 *
 * Three sections:
 *  1. Welcome message — a Textarea bound to `ai_welcome_message`.
 *  2. Suggested prompts — a dynamic list of text inputs bound to
 *     `ai_suggested_prompts` (an actual `string[]`, NOT a
 *     JSON-stringified array).
 *  3. AI data access — three switches bound to `ai_access_stats` /
 *     `ai_access_student_info` / `ai_access_password_change`.
 *
 * Loads current values from `GET /api/settings` (the phase-13 extended
 * payload — `aiWelcomeMessage`, `aiSuggestedPrompts`,
 * `aiAccessStats`, `aiAccessStudentInfo`, `aiAccessPasswordChange`)
 * and saves them with `PATCH /api/superadmin/settings { key, value }`.
 * The backend validator rejects values whose TypeScript type doesn't
 * match the key's declared `valueType` (boolean → boolean, string →
 * string, string[] → array of strings) so we ship the value as-is.
 *
 * Each save shows a spinner on its button + a toast on success. The
 * state-keyed TanStack cache (`["site-settings"]`) is invalidated
 * after every save so the public `useSiteSettings()` consumers +
 * `LazySkeleton`/`NavigationProgress` re-render with the new value on
 * their very next read. The AI assistant panel uses a separate cache
 * key (`["ai-assistant-config"]`) backed by `/api/ai-assistant/config`
 * — we also invalidate that so the principal's panel re-fetches the
 * welcome message + prompts on its next open.
 */
export function AiSettingsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<SiteSettings>({
    queryKey: ["ai-settings"],
    queryFn: fetchExtendedSettings,
    staleTime: 60 * 1000,
  });

  // ---- Local editable state -------------------------------------------
  // Welcome message.
  const [welcome, setWelcome] = React.useState<string>("");
  // Suggested prompts — array of strings.
  const [prompts, setPrompts] = React.useState<string[]>([]);
  // Access switches (local optimistic snapshot).
  type AccessKey =
    | "stats" | "studentInfo" | "passwordChange"
    | "deleteUsers" | "createGroups" | "deleteGroups"
    | "addMembers" | "groupContent" | "closeGroups"
    | "announcements" | "sampleQuestions" | "assignments";

  const [access, setAccess] = React.useState<Record<AccessKey, boolean>>({
    stats: true, studentInfo: true, passwordChange: true,
    deleteUsers: false, createGroups: true, deleteGroups: false,
    addMembers: true, groupContent: true, closeGroups: true,
    announcements: true, sampleQuestions: true, assignments: true,
  });

  // Track whether local state has been hydrated from the server snapshot.
  const [hydrated, setHydrated] = React.useState(false);

  // Track per-section in-flight saves.
  const [savingWelcome, setSavingWelcome] = React.useState(false);
  const [savingPrompts, setSavingPrompts] = React.useState(false);
  // Per-access-switch in-flight toggles.
  const [pendingAccess, setPendingAccess] = React.useState<
    Record<AccessKey, boolean>
  >({
    stats: false, studentInfo: false, passwordChange: false,
    deleteUsers: false, createGroups: false, deleteGroups: false,
    addMembers: false, groupContent: false, closeGroups: false,
    announcements: false, sampleQuestions: false, assignments: false,
  });

  // Hydrate local state once the first server snapshot resolves.
  // Re-hydrates if the server snapshot changes from elsewhere (e.g.
  // another tab edited the same value) — but only when the local editor
  // is not in the middle of a save.
  React.useEffect(() => {
    if (!data) return;
    setWelcome(String(data.aiWelcomeMessage ?? ""));
    const rawPrompts = data.aiSuggestedPrompts;
    setPrompts(
      Array.isArray(rawPrompts)
        ? rawPrompts.filter(
            (p): p is string => typeof p === "string" && p.trim().length > 0,
          )
        : [],
    );
    setAccess({
      stats: data.aiAccessStats ?? true,
      studentInfo: data.aiAccessStudentInfo ?? true,
      passwordChange: data.aiAccessPasswordChange ?? true,
      deleteUsers: data.aiAccessDeleteUsers ?? false,
      createGroups: data.aiAccessCreateGroups ?? true,
      deleteGroups: data.aiAccessDeleteGroups ?? false,
      addMembers: data.aiAccessAddMembers ?? true,
      groupContent: data.aiAccessGroupContent ?? true,
      closeGroups: data.aiAccessCloseGroups ?? true,
      announcements: data.aiAccessAnnouncements ?? true,
      sampleQuestions: data.aiAccessSampleQuestions ?? true,
      assignments: data.aiAccessAssignments ?? true,
    });
    setHydrated(true);
  }, [data]);

  // ---- Save handlers --------------------------------------------------

  async function saveWelcome() {
    if (savingWelcome) return;
    setSavingWelcome(true);
    try {
      await patchSettingValue("ai_welcome_message", welcome);
      toast({
        title: "پیام خوش‌آمدگویی ذخیره شد",
        description: "متن پیام با موفقیت به‌روزرسانی شد.",
      });
      invalidateAfterSave();
    } catch (err) {
      toast({
        title: "خطا در ذخیره پیام خوش‌آمدگویی",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSavingWelcome(false);
    }
  }

  async function savePrompts() {
    if (savingPrompts) return;
    setSavingPrompts(true);
    try {
      const cleaned = prompts
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      await patchSettingValue("ai_suggested_prompts", cleaned);
      setPrompts(cleaned);
      toast({
        title: "پرامپت‌های پیشنهادی ذخیره شد",
        description:
          cleaned.length > 0
            ? `${toPersian(cleaned.length)} مورد ذخیره شد.`
            : "فهرست خالی ذخیره شد.",
      });
      invalidateAfterSave();
    } catch (err) {
      toast({
        title: "خطا در ذخیره پرامپت‌ها",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSavingPrompts(false);
    }
  }

  async function toggleAccess(
    key: AccessKey,
    next: boolean,
  ) {
    if (pendingAccess[key]) return;
    const prev = access[key];
    if (next === prev) return;
    // Optimistic update.
    setAccess((cur) => ({ ...cur, [key]: next }));
    setPendingAccess((cur) => ({ ...cur, [key]: true }));
    const settingKeyMap: Record<AccessKey, string> = {
      stats: "ai_access_stats",
      studentInfo: "ai_access_student_info",
      passwordChange: "ai_access_password_change",
      deleteUsers: "ai_access_delete_users",
      createGroups: "ai_access_create_groups",
      deleteGroups: "ai_access_delete_groups",
      addMembers: "ai_access_add_members",
      groupContent: "ai_access_group_content",
      closeGroups: "ai_access_close_groups",
      announcements: "ai_access_announcements",
      sampleQuestions: "ai_access_sample_questions",
      assignments: "ai_access_assignments",
    };
    try {
      await patchSettingValue(settingKeyMap[key], next);
      toast({
        title: "دسترسی به‌روزرسانی شد",
        description: `«${ACCESS_LABELS[key]}» ${next ? "فعال" : "غیرفعال"} شد.`,
      });
      invalidateAfterSave();
    } catch (err) {
      // Roll back.
      setAccess((cur) => ({ ...cur, [key]: prev }));
      toast({
        title: "خطا در به‌روزرسانی دسترسی",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setPendingAccess((cur) => ({ ...cur, [key]: false }));
    }
  }

  function invalidateAfterSave() {
    // Public site-settings cache (legacy + extended fields).
    qc.invalidateQueries({ queryKey: ["site-settings"] });
    qc.invalidateQueries({ queryKey: ["ai-settings"] });
    // AI-assistant panel's own config cache so it re-fetches the new
    // welcome message + prompts on the next open.
    qc.invalidateQueries({ queryKey: ["ai-assistant-config"] });
  }

  // ---- Prompts editor helpers ----------------------------------------

  function updatePrompt(index: number, value: string) {
    setPrompts((prev) => prev.map((p, i) => (i === index ? value : p)));
  }
  function removePrompt(index: number) {
    setPrompts((prev) => prev.filter((_, i) => i !== index));
  }
  function addPrompt() {
    setPrompts((prev) => [...prev, ""]);
  }

  // ---- Render ---------------------------------------------------------

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6 text-center text-sm text-destructive">
            خطا در بارگذاری تنظیمات: {(error as Error)?.message || "نامشخص"}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !data || !hydrated) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in-up">
        <Header />
        <div className="flex flex-col gap-4">
          <LazySkeleton className="h-64 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-48 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-40 w-full border border-border bg-card/60" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in-up">
      <Header />

      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300/80">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        <p className="leading-relaxed">
          این تنظیمات روی گفتگوی دستیار هوش مصنوعی مدیر اعمال می‌شود.
          تغییرات بلافاصله پس از ذخیره برای همه مدیران مدارس فعال می‌شود.
        </p>
      </div>

      {/* 0. AI provider config (Phase 34) ------------------------------ */}
      <AiProviderConfig />

      {/* 1. Welcome message ------------------------------------------ */}
      <Card className="border border-border bg-card">
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
              <Bot className="size-5" />
            </div>
            <div className="flex flex-1 flex-col">
              <CardTitle className="text-base text-foreground">
                پیام خوش‌آمدگویی
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                متنی که هنگام باز کردن پنل دستیار به‌عنوان اولین پیام نمایش
                داده می‌شود.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4">
          <Textarea
            value={welcome}
            onChange={(e) => setWelcome(e.target.value)}
            placeholder="مثال: سلام! من دستیار هوش مصنوعی شما هستم..."
            rows={5}
            maxLength={1000}
            className="resize-y"
            aria-label="پیام خوش‌آمدگویی دستیار"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {toPersian(welcome.length)} / ۱۰۰۰ کاراکتر
            </span>
            <Button
              type="button"
              onClick={() => void saveWelcome()}
              disabled={savingWelcome}
              className="gap-2"
            >
              {savingWelcome ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              ذخیره پیام
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2. Suggested prompts ---------------------------------------- */}
      <Card className="border border-border bg-card">
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
              <Sparkles className="size-5" />
            </div>
            <div className="flex flex-1 flex-col">
              <CardTitle className="text-base text-foreground">
                پرامپت‌های پیشنهادی
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                دکمه‌های سریع که هنگام باز کردن پنل دستیار به کاربر نمایش
                داده می‌شوند.
              </p>
            </div>
            <Badge variant="outline" className="ml-auto">
              {toPersian(prompts.length)} مورد
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4">
          {prompts.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              هنوز پرامپتی اضافه نشده. روی «افزودن پرامپت» بزنید.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {prompts.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-xs text-muted-foreground">
                    {toPersian(i + 1)}.
                  </span>
                  <Input
                    value={p}
                    onChange={(e) => updatePrompt(i, e.target.value)}
                    placeholder="مثال: آمار مدرسه را بده"
                    maxLength={200}
                    className="flex-1"
                    aria-label={`پرامپت ${toPersian(i + 1)}`}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removePrompt(i)}
                    disabled={savingPrompts}
                    aria-label="حذف پرامپت"
                    title="حذف"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={addPrompt}
              disabled={savingPrompts}
              className="gap-2"
            >
              <Plus className="size-4" />
              افزودن پرامپت
            </Button>
            <Button
              type="button"
              onClick={() => void savePrompts()}
              disabled={savingPrompts}
              className="gap-2"
            >
              {savingPrompts ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              ذخیره پرامپت‌ها
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 3. AI data access ------------------------------------------- */}
      <Card className="border border-border bg-card">
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
              <Bot className="size-5" />
            </div>
            <div className="flex flex-1 flex-col">
              <CardTitle className="text-base text-foreground">
                دسترسی هوش مصنوعی به اطلاعات
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                تعیین کنید دستیار به کدام داده‌های مدرسه دسترسی داشته باشد
                و چه کارهایی می‌تواند انجام دهد.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 p-4">
          {(
            [
              { key: "stats", label: ACCESS_LABELS.stats, desc: ACCESS_DESCS.stats },
              { key: "studentInfo", label: ACCESS_LABELS.studentInfo, desc: ACCESS_DESCS.studentInfo },
              { key: "passwordChange", label: ACCESS_LABELS.passwordChange, desc: ACCESS_DESCS.passwordChange },
              { key: "deleteUsers", label: ACCESS_LABELS.deleteUsers, desc: ACCESS_DESCS.deleteUsers },
              { key: "createGroups", label: ACCESS_LABELS.createGroups, desc: ACCESS_DESCS.createGroups },
              { key: "deleteGroups", label: ACCESS_LABELS.deleteGroups, desc: ACCESS_DESCS.deleteGroups },
              { key: "addMembers", label: ACCESS_LABELS.addMembers, desc: ACCESS_DESCS.addMembers },
              { key: "groupContent", label: ACCESS_LABELS.groupContent, desc: ACCESS_DESCS.groupContent },
              { key: "closeGroups", label: ACCESS_LABELS.closeGroups, desc: ACCESS_DESCS.closeGroups },
              { key: "announcements", label: ACCESS_LABELS.announcements, desc: ACCESS_DESCS.announcements },
              { key: "sampleQuestions", label: ACCESS_LABELS.sampleQuestions, desc: ACCESS_DESCS.sampleQuestions },
              { key: "assignments", label: ACCESS_LABELS.assignments, desc: ACCESS_DESCS.assignments },
            ] as const
          ).map(({ key, label, desc }) => {
            const enabled = access[key];
            const pending = pendingAccess[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2.5"
              >
                <div className="flex flex-col gap-0.5">
                  <Label
                    htmlFor={`access-${key}`}
                    className="cursor-pointer text-sm font-medium text-foreground"
                  >
                    {label}
                  </Label>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </div>
                <div className="flex items-center gap-2">
                  {pending ? (
                    <Loader2 className="size-3.5 animate-spin text-emerald-500" />
                  ) : null}
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-border bg-muted/40",
                      enabled
                        ? "text-emerald-500"
                        : "text-muted-foreground",
                    )}
                  >
                    {enabled ? "فعال" : "غیرفعال"}
                  </Badge>
                  <Switch
                    id={`access-${key}`}
                    checked={enabled}
                    disabled={pending}
                    onCheckedChange={(next) => void toggleAccess(key, next)}
                    aria-label={label}
                    className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-muted-foreground/30"
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* 4. Principal AI chat history (phase 21) --------------------- */}
      <AiConversationsViewer />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const ACCESS_LABELS = {
  stats: "دسترسی به آمار مدرسه",
  studentInfo: "دسترسی به اطلاعات دانش‌آموزان",
  passwordChange: "اجازه تغییر رمز عبور کاربران",
  deleteUsers: "حذف کاربران",
  createGroups: "ایجاد گروه‌ها",
  deleteGroups: "حذف گروه‌ها",
  addMembers: "افزودن کاربر به گروه‌ها",
  groupContent: "خلاصه محتوای گروه‌ها",
  closeGroups: "بستن گروه‌ها برای دانش‌آموزان",
  announcements: "ارسال اطلاعیه‌ها و محتوای اطلاعیه‌ها",
  sampleQuestions: "محتوای نمونه سوالات",
  assignments: "محتوای تکالیف",
} as const;

const ACCESS_DESCS = {
  stats: "دستیار می‌تواند آمار کلی مدرسه را ببیند (تعداد دانش‌آموز/معلم/کلاس).",
  studentInfo:
    "دستیار می‌تواند اطلاعات تک‌تک دانش‌آموزان را جست‌وجو و پیگیری کند.",
  passwordChange:
    "دستیار می‌تواند رمز عبور کاربران را با تأیید مدیر تغییر دهد.",
  deleteUsers:
    "دستیار می‌تواند کاربران (دانش‌آموز/معلم) را حذف کند.",
  createGroups:
    "دستیار می‌تواند گروه‌های گفتگوی جدید ایجاد کند.",
  deleteGroups:
    "دستیار می‌تواند گروه‌های گفتگو را حذف کند.",
  addMembers:
    "دستیار می‌تواند کاربران را به گروه‌های گفتگو اضافه کند.",
  groupContent:
    "دستیار می‌تواند محتوای پیام‌های گروه‌ها را بخواند و خلاصه کند.",
  closeGroups:
    "دستیار می‌تواند گفتگوی گروه‌ها را برای دانش‌آموزان ببندد.",
  announcements:
    "دستیار می‌تواند اطلاعیه‌ها را ارسال کند و محتوای آن‌ها را ببیند.",
  sampleQuestions:
    "دستیار می‌تواند نمونه سوالات کلاس‌ها را بخواند.",
  assignments:
    "دستیار می‌تواند تکالیف کلاس‌ها را بخواند.",
} as const;

/** Convert ASCII digits in a number/string to Persian digits. */
function toPersian(input: number | string): string {
  const s = String(input);
  return s.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

function Header() {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <Bot className="size-6 text-emerald-500" />
          تنظیمات دستیار
        </h2>
        <p className="text-sm text-muted-foreground">
          مدیریت پیام خوش‌آمدگویی، پرامپت‌های پیشنهادی و دسترسی هوش مصنوعی
          به اطلاعات مدرسه.
        </p>
      </div>
    </header>
  );
}
