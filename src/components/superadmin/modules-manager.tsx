"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Bot,
  Boxes,
  CalendarCheck,
  ClipboardList,
  Filter,
  FileQuestion,
  GraduationCap,
  Loader2,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Moon,
  Paperclip,
  User,
  UserCircle,
} from "lucide-react";
import {
  fetchExtendedSettings,
  patchSettingValue,
} from "@/lib/superadmin-api";
import type { SiteSettings } from "@/lib/site-settings";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { cn } from "@/lib/utils";

/** Shape of the nested `modules` object on the public SiteSettings payload. */
type ModulesMap = SiteSettings["modules"];

/**
 * Catalog of platform modules. Each entry maps a `ModulesMap` field to
 * its Persian label + icon + description + the SiteSetting key the
 * backend uses (`module_<snake_case>`).
 */
interface ModuleDef {
  /** Field on `SiteSettings["modules"]`. */
  key: keyof ModulesMap;
  /** SiteSetting key the backend stores (snake_case). */
  settingKey: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const MODULES: ModuleDef[] = [
  {
    key: "classChat",
    settingKey: "module_class_chat",
    label: "گفتگوی کلاسی",
    description: "چت گروهی کلاس‌ها",
    icon: MessageSquare,
  },
  {
    key: "directChat",
    settingKey: "module_direct_chat",
    label: "گفتگوی خصوصی",
    description: "چت ۱:۱ بین کاربران",
    icon: User,
  },
  {
    key: "assignments",
    settingKey: "module_assignments",
    label: "تکالیف",
    description: "ایجاد و مدیریت تکالیف",
    icon: ClipboardList,
  },
  {
    key: "sampleQuestions",
    settingKey: "module_sample_questions",
    label: "نمونه سوالات",
    description: "بارگذاری نمونه سوال",
    icon: FileQuestion,
  },
  {
    key: "grades",
    settingKey: "module_grades",
    label: "نمرات",
    description: "ثبت و مشاهده نمرات",
    icon: GraduationCap,
  },
  {
    key: "polls",
    settingKey: "module_polls",
    label: "نظرسنجی",
    description: "ایجاد نظرسنجی در چت",
    icon: BarChart3,
  },
  {
    key: "fileUpload",
    settingKey: "module_file_upload",
    label: "ارسال فایل",
    description: "آپلود فایل در گفتگو",
    icon: Paperclip,
  },
  {
    key: "bulkChat",
    settingKey: "module_bulk_chat",
    label: "مدیریت دسته‌ای گفتگو",
    description: "بستن همه گفتگوها",
    icon: Megaphone,
  },
  {
    key: "aiAssistant",
    settingKey: "module_ai_assistant",
    label: "دستیار هوش مصنوعی",
    description: "دستیار AI مدیر مدرسه",
    icon: Bot,
  },
  {
    key: "profileAvatar",
    settingKey: "module_profile_avatar",
    label: "تصویر پروفایل",
    description: "آپلود/تغییر عکس پروفایل",
    icon: UserCircle,
  },
  {
    key: "darkMode",
    settingKey: "module_dark_mode",
    label: "حالت تیره/روشن",
    description: "تغییر تم سایت",
    icon: Moon,
  },
  {
    key: "teacherOnlyMessages",
    settingKey: "module_teacher_only_messages",
    label: "فقط مدیر و معلم",
    description:
      "قابلیت فیلتر پیام در چت — پیام‌های دانش‌آموزان مخفی + فقط پیام‌های معلم/مدیر",
    icon: Filter,
  },
  {
    key: "attendance",
    settingKey: "module_attendance",
    label: "حضور و غیاب",
    description:
      "ثبت حضور و غیاب روزانه دانش‌آموزان به تفکیک زنگ + گزارش شخصی",
    icon: CalendarCheck,
  },
];

/**
 * SUPERADMIN-only platform-modules manager.
 *
 * Renders each module as a card with: icon + name + description +
 * a Switch. Toggling a module PATCHes
 * `/api/superadmin/settings { key: "module_<snake_case>", value: true|false }`
 * (the backend validator requires a BOOLEAN for boolean-typed settings)
 * with an optimistic local snapshot + a toast.
 *
 * Loads current values from `GET /api/settings` (the phase-13 payload
 * nests the modules map under `data.modules`). Disabling a module
 * cuts off access for ALL roles — a warning is rendered at the top.
 * The backend's `assertModule` helper enforces this gate across every
 * role-scoped API endpoint (SUPERADMIN bypasses).
 */
export function ModulesManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<SiteSettings>({
    queryKey: ["ai-settings"],
    queryFn: fetchExtendedSettings,
    staleTime: 60 * 1000,
  });

  // Local optimistic snapshot of the modules map.
  const [optimistic, setOptimistic] = React.useState<ModulesMap | null>(null);
  React.useEffect(() => {
    if (data) {
      setOptimistic(extractModules(data));
    }
  }, [data]);

  // Track per-module in-flight toggles so the Switch shows a spinner.
  const [pendingKeys, setPendingKeys] = React.useState<Set<string>>(
    new Set(),
  );

  function currentValue(def: ModuleDef): boolean {
    const v =
      (optimistic ?? extractModules(data ?? ({} as SiteSettings)))[
        def.key
      ];
    return v ?? true;
  }

  async function handleToggle(def: ModuleDef, next: boolean) {
    const prev = currentValue(def);
    if (next === prev) return;

    // Optimistic update.
    setOptimistic((cur) => {
      const base =
        cur ??
        extractModules(data ?? ({} as SiteSettings));
      return { ...base, [def.key]: next };
    });
    setPendingKeys((prev) => {
      const nextSet = new Set(prev);
      nextSet.add(def.key);
      return nextSet;
    });

    try {
      const refreshed = await patchSettingValue(def.settingKey, next);
      setOptimistic(extractModules(refreshed));
      toast({
        title: "ماژول به‌روزرسانی شد",
        description: `«${def.label}» ${next ? "فعال" : "غیرفعال"} شد.`,
      });
      // Invalidate the shared site-settings + ai-settings caches so
      // every consumer re-reads the new module state.
      qc.invalidateQueries({ queryKey: ["site-settings"] });
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
    } catch (err) {
      // Roll back.
      setOptimistic((cur) => {
        const base =
          cur ??
          extractModules(data ?? ({} as SiteSettings));
        return { ...base, [def.key]: prev };
      });
      toast({
        title: "خطا در به‌روزرسانی ماژول",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setPendingKeys((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(def.key);
        return nextSet;
      });
    }
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6 text-center text-sm text-destructive">
            خطا در بارگذاری ماژول‌ها: {(error as Error)?.message || "نامشخص"}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in-up">
        <Header />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((def) => (
            <LazySkeleton
              key={def.key}
              className="h-40 w-full border border-border bg-card/60"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in-up">
      <Header />

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300/80">
        <Boxes className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className="leading-relaxed">
          غیرفعال‌کردن یک ماژول، دسترسی همه نقش‌ها به آن را قطع می‌کند.
          کاربران در طول یک دقیقه پس از تغییر، نتیجه را مشاهده خواهند کرد.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((def) => {
          const enabled = currentValue(def);
          const pending = pendingKeys.has(def.key);
          const Icon = def.icon;
          return (
            <Card
              key={def.key}
              className={cn(
                "flex flex-col border border-border bg-card transition-shadow hover:shadow-md",
              )}
            >
              <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors",
                    enabled
                      ? "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20"
                      : "bg-muted/40 text-muted-foreground ring-border",
                  )}
                >
                  <Icon className="size-5" />
                </div>
                <div className="flex flex-1 flex-col">
                  <CardTitle className="text-base text-foreground">
                    {def.label}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    <code>{def.settingKey}</code>
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "ml-auto border-border bg-muted/40",
                    enabled
                      ? "text-emerald-500"
                      : "text-muted-foreground",
                  )}
                >
                  {enabled ? "فعال" : "غیرفعال"}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {def.description}
                </p>
                <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2.5">
                  <Label
                    htmlFor={`module-${def.key}`}
                    className="cursor-pointer text-xs font-medium text-foreground"
                  >
                    {enabled ? "روشن" : "خاموش"}
                  </Label>
                  <div className="flex items-center gap-2">
                    {pending ? (
                      <Loader2 className="size-3 animate-spin text-emerald-500" />
                    ) : null}
                    <Switch
                      id={`module-${def.key}`}
                      checked={enabled}
                      disabled={pending}
                      onCheckedChange={(next) => void handleToggle(def, next)}
                      aria-label={def.label}
                      className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-muted-foreground/30"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Default-on modules baseline (matches the backend's catalog defaults). */
const DEFAULT_MODULES: ModulesMap = {
  classChat: true,
  directChat: true,
  assignments: true,
  sampleQuestions: true,
  grades: true,
  polls: true,
  fileUpload: true,
  bulkChat: true,
  aiAssistant: true,
  profileAvatar: true,
  darkMode: true,
  pushNotifications: true,
  teacherOnlyMessages: true,
  attendance: true,
};

/**
 * Extract the nested `modules` map from a possibly-incomplete server
 * snapshot. Defaults every module to `true` (the platform's
 * "everything on" baseline) when the field is missing.
 */
function extractModules(
  data: Partial<SiteSettings> | undefined | null,
): ModulesMap {
  if (!data) return { ...DEFAULT_MODULES };
  const src = data.modules ?? undefined;
  if (!src) return { ...DEFAULT_MODULES };
  return {
    classChat: readBool(src.classChat, true),
    directChat: readBool(src.directChat, true),
    assignments: readBool(src.assignments, true),
    sampleQuestions: readBool(src.sampleQuestions, true),
    grades: readBool(src.grades, true),
    polls: readBool(src.polls, true),
    fileUpload: readBool(src.fileUpload, true),
    bulkChat: readBool(src.bulkChat, true),
    aiAssistant: readBool(src.aiAssistant, true),
    profileAvatar: readBool(src.profileAvatar, true),
    darkMode: readBool(src.darkMode, true),
    pushNotifications: readBool(src.pushNotifications, true),
    teacherOnlyMessages: readBool(src.teacherOnlyMessages, true),
    attendance: readBool(src.attendance, true),
  };
}

function readBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  return fallback;
}

function Header() {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <Boxes className="size-6 text-emerald-500" />
          ماژول‌های پلتفرم
        </h2>
        <p className="text-sm text-muted-foreground">
          تمام امکانات پلتفرم را به‌صورت ماژول فعال/غیرفعال کنید. وقتی یک
          ماژول غیرفعال باشد، هیچ کاربری نمی‌تواند از آن استفاده کند.
        </p>
      </div>
    </header>
  );
}
