"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Smartphone,
  FlaskConical,
  Phone,
  Loader2,
  Save,
  ShieldAlert,
  LogIn,
  type LucideIcon,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { cn } from "@/lib/utils";

/**
 * «مدیریت ورود کاربر» — the superadmin's login-management section.
 *
 * Controls (backed by /api/superadmin/login-settings):
 *  1. ورود با رمز عبور   — username + password login platform-wide.
 *  2. ورود پیامکی        — SMS OTP login platform-wide.
 *  3. نمایش کد ورود تستی — TEST MODE: the OTP code is displayed on the
 *                          login page (default ON).
 *  4. شماره موبایل پیامکی مدیر کل — the phone the SUPERADMIN signs in
 *                          with on /superadmin/login (default 0913652461).
 *
 * Guard rails (mirrored server-side):
 *  - Disabling BOTH login methods is blocked (total lockout).
 *  - The superadmin phone must be unique to the superadmin account.
 */

interface LoginSettings {
  passwordEnabled: boolean;
  smsEnabled: boolean;
  showTestCode: boolean;
  superadminPhone: string;
}

const DEFAULT_PHONE = "0913652461";

async function fetchLoginSettings(): Promise<LoginSettings> {
  return apiFetch<LoginSettings>("/api/superadmin/login-settings");
}

async function patchLoginSettings(
  patch: Partial<Pick<LoginSettings, "passwordEnabled" | "smsEnabled" | "showTestCode" | "superadminPhone">>,
): Promise<LoginSettings> {
  return apiFetch<LoginSettings>("/api/superadmin/login-settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Client-side format pre-check (accepts 09xxxxxxxx and 09xxxxxxxxx). */
function isPlausiblePhone(raw: string): boolean {
  const p = raw.replace(/\D/g, "");
  return /^09\d{8,9}$/.test(p);
}

interface ToggleDef {
  field: "passwordEnabled" | "smsEnabled" | "showTestCode";
  label: string;
  description: string;
  icon: LucideIcon;
}

const TOGGLES: ToggleDef[] = [
  {
    field: "passwordEnabled",
    label: "ورود با رمز عبور",
    description:
      "ورود با نام کاربری و رمز عبور برای همه کاربران (به‌جز مدیر کل که از صفحه /superadmin/login وارد می‌شود).",
    icon: KeyRound,
  },
  {
    field: "smsEnabled",
    label: "ورود پیامکی",
    description:
      "ورود با شماره موبایل + کد تایید. در حالت تستی نیازی به سرویس پیامک نیست — کد روی صفحه ورود نمایش داده می‌شود.",
    icon: Smartphone,
  },
  {
    field: "showTestCode",
    label: "نمایش کد ورود تستی",
    description:
      "پیش‌فرض: فعال. وقتی فعال باشد، کد تایید علاوه بر ارسال پیامک، روی صفحه ورود نمایش داده می‌شود تا اعضا بدون سرویس پیامک واقعی بتوانند وارد شوند.",
    icon: FlaskConical,
  },
];

export function LoginSettingsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<LoginSettings>({
    queryKey: ["login-settings"],
    queryFn: fetchLoginSettings,
    staleTime: 30 * 1000,
  });

  // Local optimistic snapshot.
  const [optimistic, setOptimistic] = React.useState<LoginSettings | null>(null);
  React.useEffect(() => {
    if (data) setOptimistic(data);
  }, [data]);

  const [pendingFields, setPendingFields] = React.useState<Set<string>>(new Set());

  // Phone editor state.
  const [phoneDraft, setPhoneDraft] = React.useState<string>("");
  const [savingPhone, setSavingPhone] = React.useState(false);
  React.useEffect(() => {
    if (data && phoneDraft === "") setPhoneDraft(data.superadminPhone);
  }, [data, phoneDraft]);

  const current = optimistic ?? data ?? null;

  function currentValue(def: ToggleDef): boolean {
    if (!current) return true;
    return current[def.field];
  }

  async function handleToggle(def: ToggleDef, next: boolean) {
    if (!current) return;
    const prev = current[def.field];
    if (next === prev) return;

    // Client-side lockout guard (the server enforces the same rule).
    if (!next) {
      if (def.field === "passwordEnabled" && !current.smsEnabled) {
        toast({
          title: "عملیات مجاز نیست",
          description:
            "ورود پیامکی هم‌اکنون غیرفعال است؛ نمی‌توان هر دو روش ورود را همزمان غیرفعال کرد.",
          variant: "destructive",
        });
        return;
      }
      if (def.field === "smsEnabled" && !current.passwordEnabled) {
        toast({
          title: "عملیات مجاز نیست",
          description:
            "ورود با رمز عبور هم‌اکنون غیرفعال است؛ نمی‌توان هر دو روش ورود را همزمان غیرفعال کرد.",
          variant: "destructive",
        });
        return;
      }
    }

    // Optimistic update.
    const snapshot = current;
    setOptimistic({ ...current, [def.field]: next });
    setPendingFields((prev) => new Set(prev).add(def.field));

    try {
      const refreshed = await patchLoginSettings({ [def.field]: next });
      setOptimistic(refreshed);
      toast({
        title: "تنظیمات ورود به‌روزرسانی شد",
        description: `«${def.label}» ${next ? "فعال" : "غیرفعال"} شد.`,
      });
      qc.invalidateQueries({ queryKey: ["login-settings"] });
    } catch (err) {
      // Roll back.
      setOptimistic(snapshot);
      toast({
        title: "خطا در به‌روزرسانی",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setPendingFields((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(def.field);
        return nextSet;
      });
    }
  }

  async function handleSavePhone() {
    if (!current || savingPhone) return;
    const raw = phoneDraft.trim();
    if (!raw) {
      toast({ title: "خطا", description: "شماره موبایل را وارد کنید.", variant: "destructive" });
      return;
    }
    if (!isPlausiblePhone(raw)) {
      toast({
        title: "خطا",
        description: "شماره موبایل نامعتبر است. مثال: 0913652461",
        variant: "destructive",
      });
      return;
    }
    if (raw === current.superadminPhone) return;

    setSavingPhone(true);
    try {
      const refreshed = await patchLoginSettings({ superadminPhone: raw });
      setOptimistic(refreshed);
      setPhoneDraft(refreshed.superadminPhone);
      toast({
        title: "شماره موبایل مدیر کل ذخیره شد",
        description: `شماره ورود پیامکی مدیر کل به ${refreshed.superadminPhone} تغییر یافت.`,
      });
      qc.invalidateQueries({ queryKey: ["login-settings"] });
    } catch (err) {
      toast({
        title: "خطا در ذخیره شماره",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSavingPhone(false);
    }
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6 text-center text-sm text-destructive">
            خطا در بارگذاری تنظیمات ورود: {(error as Error)?.message || "نامشخص"}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !current) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in-up">
        <Header />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <LazySkeleton className="h-44 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-44 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-44 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-48 w-full border border-border bg-card/60 sm:col-span-2" />
        </div>
      </div>
    );
  }

  const phoneChanged = phoneDraft.trim() !== current.superadminPhone;

  return (
    <div className="flex flex-col gap-6 animate-fade-in-up">
      <Header />

      {/* Lockout warning */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300/80">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className="leading-relaxed">
          غیرفعال‌کردن یک روش ورود، همان روش را برای <strong>تمام کاربران</strong>{" "}
          (از جمله مدیر کل) غیرفعال می‌کند — حداقل یکی از دو روش «رمز عبور» یا
          «پیامکی» باید فعال بماند. ورود مدیر کل همیشه فقط از صفحه{" "}
          <code dir="ltr">/superadmin/login</code> انجام می‌شود.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOGGLES.map((def) => {
          const enabled = currentValue(def);
          const pending = pendingFields.has(def.field);
          const Icon = def.icon;
          const isTestToggle = def.field === "showTestCode";
          return (
            <Card
              key={def.field}
              className={cn(
                "flex flex-col border border-border bg-card transition-shadow hover:shadow-md",
                isTestToggle && enabled && "border-amber-500/30",
              )}
            >
              <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors",
                    enabled
                      ? isTestToggle
                        ? "bg-amber-500/10 text-amber-500 ring-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20"
                      : "bg-muted/40 text-muted-foreground ring-border",
                  )}
                >
                  <Icon className="size-5" />
                </div>
                <div className="flex flex-1 flex-col">
                  <CardTitle className="text-base text-foreground">{def.label}</CardTitle>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    <code>
                      {def.field === "passwordEnabled"
                        ? "login_password_enabled"
                        : def.field === "smsEnabled"
                          ? "login_sms_enabled"
                          : "login_sms_show_test_code"}
                    </code>
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "ml-auto border-border bg-muted/40",
                    enabled
                      ? isTestToggle
                        ? "text-amber-500"
                        : "text-emerald-500"
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
                    htmlFor={`login-setting-${def.field}`}
                    className="cursor-pointer text-xs font-medium text-foreground"
                  >
                    {enabled ? "روشن" : "خاموش"}
                  </Label>
                  <div className="flex items-center gap-2">
                    {pending ? <Loader2 className="size-3 animate-spin text-emerald-500" /> : null}
                    <Switch
                      id={`login-setting-${def.field}`}
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

        {/* Superadmin SMS phone card */}
        <Card className="flex flex-col border border-border bg-card transition-shadow hover:shadow-md sm:col-span-2">
          <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
              <Phone className="size-5" />
            </div>
            <div className="flex flex-1 flex-col">
              <CardTitle className="text-base text-foreground">
                شماره موبایل ورود پیامکی مدیر کل
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                شماره‌ای که مدیر کل با آن از طریق «ورود پیامکی» در صفحه{" "}
                <code dir="ltr">/superadmin/login</code> وارد می‌شود.
              </p>
            </div>
            {current.superadminPhone === DEFAULT_PHONE && (
              <Badge variant="outline" className="ml-auto border-border bg-muted/40 text-muted-foreground">
                پیش‌فرض
              </Badge>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="space-y-2">
              <Label htmlFor="superadmin-phone" className="text-xs font-medium text-foreground">
                شماره موبایل
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="superadmin-phone"
                  type="tel"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder={DEFAULT_PHONE}
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  disabled={savingPhone}
                  className="text-left focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60"
                />
                <Button
                  type="button"
                  onClick={() => void handleSavePhone()}
                  disabled={savingPhone || !phoneChanged}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white sm:w-auto"
                >
                  {savingPhone ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      در حال ذخیره…
                    </>
                  ) : (
                    <>
                      <Save className="size-4" />
                      ذخیره شماره
                    </>
                  )}
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                این شماره نباید به هیچ حساب دیگری (غیر از مدیر کل) اختصاص داشته
                باشد. شماره پیش‌فرض: <code dir="ltr">{DEFAULT_PHONE}</code>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <LogIn className="size-6 text-emerald-500" />
          مدیریت ورود کاربر
        </h2>
        <p className="text-sm text-muted-foreground">
          روش‌های ورود به سامانه (رمز عبور / پیامکی)، نمایش کد ورود تستی و
          شماره موبایل پیامکی مدیر کل را مدیریت کنید.
        </p>
      </div>
    </header>
  );
}
