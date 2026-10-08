"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  LogIn,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";
import {
  KNOWN_SETTINGS,
  getSettingValueByDef,
  setPathClone,
  type KnownSettingDef,
  type SiteSettings,
} from "@/lib/site-settings";
import {
  fetchSiteSettings,
  patchSiteSetting,
} from "@/lib/superadmin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LazySkeleton } from "@/components/ui/lazy-skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * SUPERADMIN-only site settings manager.
 *
 * Renders one card per known site setting (currently lazy-loading +
 * navigation-progress) with a Switch. Toggling fires a PATCH that upserts
 * the SiteSetting row; optimistic local state mirrors the click, then syncs
 * from the server snapshot when the response resolves.
 *
 * The TanStack Query cache key `["site-settings"]` is shared with the public
 * useSiteSettings() hook (used by <LazySkeleton> + <NavigationProgress>),
 * so invalidating here propagates the change to every page in real time —
 * users see the new value on their very next render without a reload.
 */
export function SiteSettingsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<SiteSettings>({
    queryKey: ["site-settings"],
    queryFn: fetchSiteSettings,
    staleTime: 60 * 1000,
  });

  // Local optimistic snapshot.
  const [optimistic, setOptimistic] = React.useState<SiteSettings | null>(
    null,
  );
  React.useEffect(() => {
    if (data) setOptimistic(data);
  }, [data]);

  // Track per-key in-flight toggles so the Switch shows a spinner/disabled.
  const [pendingKeys, setPendingKeys] = React.useState<Set<string>>(new Set());

  function currentValue(def: KnownSettingDef): boolean {
    const v = getSettingValueByDef(optimistic ?? data, def);
    return typeof v === "boolean" ? v : !!def.defaultValue;
  }

  async function handleToggle(def: KnownSettingDef, next: boolean) {
    const prev = currentValue(def);
    if (next === prev) return;

    // Optimistic update — boolean settings write into the dotted responseKey
    // path (e.g. "modules.classChat") so the rest of the React tree that
    // reads via `useSiteSettings()` sees the new value immediately.
    setOptimistic((cur) => {
      const base = (cur ?? data ?? {}) as Record<string, unknown>;
      return setPathClone(base, def.responseKey, next) as unknown as SiteSettings;
    });
    setPendingKeys((prev) => {
      const nextSet = new Set(prev);
      nextSet.add(def.key);
      return nextSet;
    });

    try {
      const serverSnapshot = await patchSiteSetting(def.key, next);
      setOptimistic(serverSnapshot);
      toast({
        title: next ? "تنظیمات به‌روزرسانی شد" : "تنظیمات به‌روزرسانی شد",
        description: `«${def.label}» ${next ? "فعال" : "غیرفعال"} شد.`,
      });
      // Propagate to every mounted useSiteSettings() consumer (LazySkeleton,
      // NavigationProgress) so they re-render with the new value instantly.
      qc.invalidateQueries({ queryKey: ["site-settings"] });
    } catch (err) {
      // Roll back
      setOptimistic((cur) => {
        const base = (cur ?? data ?? {}) as Record<string, unknown>;
        return setPathClone(base, def.responseKey, prev) as unknown as SiteSettings;
      });
      toast({
        title: "خطا در به‌روزرسانی تنظیمات",
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

  async function handleResetAll() {
    // Re-enable every BOOLEAN setting (string / string[] settings like
    // the AI welcome message are managed on the dedicated AI settings
    // page — Task 3).
    const booleanDefs = KNOWN_SETTINGS.filter(
      (d) => d.valueType === "boolean",
    );
    setPendingKeys((prev) => {
      const nextSet = new Set(prev);
      for (const def of booleanDefs) nextSet.add(def.key);
      return nextSet;
    });
    try {
      // Patch them sequentially (the API accepts one key per call).
      let snapshot: SiteSettings | undefined;
      for (const def of booleanDefs) {
        snapshot = await patchSiteSetting(def.key, Boolean(def.defaultValue));
      }
      if (snapshot) setOptimistic(snapshot);
      toast({
        title: "تنظیمات بازنشانی شد",
        description: "همه تنظیمات به حالت پیش‌فرض (فعال) بازگشتند.",
      });
      qc.invalidateQueries({ queryKey: ["site-settings"] });
    } catch (err) {
      toast({
        title: "خطا در بازنشانی",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setPendingKeys(new Set());
    }
  }

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

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in-up">
        <Header />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {KNOWN_SETTINGS.map((def) => (
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
      <Header>
        <Button
          variant="outline"
          onClick={() => void handleResetAll()}
          className="gap-2"
          disabled={pendingKeys.size > 0}
        >
          <RotateCcw className="size-4" />
          بازنشانی همه
        </Button>
      </Header>

      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200/80">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
        <p className="leading-relaxed">
          تغییر هر کلید بلافاصله روی تمام کاربران اعمال می‌شود. وقتی
          «بارگذاری تنبل» را خاموش می‌کنید، جایگاه‌های چشمک‌زن در صفحات دیگر
          نمایش داده نمی‌شوند و محتوا مستقیماً بارگذاری می‌شود.
        </p>
      </div>

      {/* Login-method toggles moved to the dedicated «مدیریت ورود کاربر» page. */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <LogIn className="mt-0.5 size-4 shrink-0" />
        <p className="leading-relaxed">
          فعال/غیرفعال‌سازی روش‌های ورود (رمز عبور / پیامکی)، نمایش کد ورود
          تستی و شماره موبایل پیامکی مدیر کل در بخش{" "}
          <Link
            href="/superadmin/login-settings"
            className="font-medium text-emerald-500 hover:underline"
          >
            مدیریت ورود کاربر
          </Link>{" "}
          مدیریت می‌شود.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {KNOWN_SETTINGS.filter((d) => d.valueType === "boolean").map((def) => {
          const enabled = currentValue(def);
          const pending = pendingKeys.has(def.key);
          return (
            <Card
              key={def.key}
              className="flex flex-col border border-border bg-card"
            >
              <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
                  <SettingsIcon className="size-5" />
                </div>
                <div className="flex flex-1 flex-col">
                  <CardTitle className="text-base text-foreground">
                    {def.label}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    کلید:{" "}
                    <code dir="ltr" className="text-emerald-500">
                      {def.key}
                    </code>
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
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        enabled ? "text-emerald-500" : "text-muted-foreground",
                      )}
                    >
                      {enabled ? "روشن" : "خاموش"}
                    </span>
                    {pending ? (
                      <Loader2 className="size-3 animate-spin text-emerald-500" />
                    ) : null}
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={pending}
                    onCheckedChange={(next) => void handleToggle(def, next)}
                    aria-label={def.label}
                    className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-muted-foreground/30"
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <SettingsIcon className="size-6 text-emerald-500" />
          تنظیمات سایت
        </h2>
        <p className="text-sm text-muted-foreground">
          کنترل نمایش جایگاه بارگذاری و نوار پیشرفت ناوبری در سراسر سایت.
        </p>
      </div>
      {children}
    </header>
  );
}
