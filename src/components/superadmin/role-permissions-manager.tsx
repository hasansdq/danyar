"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GraduationCap,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
  UserCog,
  Users as UsersIcon,
} from "lucide-react";
import {
  FEATURES_BY_ROLE,
  type FeatureDef,
  type Permissions,
} from "@/lib/permissions";
import {
  getSuperAdminPermissions,
  patchSuperAdminPermission,
  resetSuperAdminPermissions,
} from "@/lib/superadmin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { cn } from "@/lib/utils";

type ManagedRole = "STUDENT" | "TEACHER" | "ADMIN";

interface RoleMeta {
  role: ManagedRole;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClassName: string;
  iconClassName: string;
}

const ROLE_META: RoleMeta[] = [
  {
    role: "STUDENT",
    label: "دانش‌آموز",
    description: "کنترل قابلیت‌های قابل دسترس برای دانش‌آموزان",
    icon: GraduationCap,
    accentClassName: "border-border bg-card/40",
    iconClassName: "bg-muted text-foreground ring-slate-600/40",
  },
  {
    role: "TEACHER",
    label: "معلم",
    description: "کنترل قابلیت‌های قابل دسترس برای معلمان",
    icon: UsersIcon,
    accentClassName: "border-teal-500/30 bg-teal-500/5",
    iconClassName: "bg-teal-500/10 text-teal-500 ring-teal-500/20",
  },
  {
    role: "ADMIN",
    label: "مدیر",
    description: "کنترل قابلیت‌های قابل دسترس برای مدیران (سطح Samane)",
    icon: UserCog,
    accentClassName: "border-amber-500/30 bg-amber-500/5",
    iconClassName: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
  },
];

/**
 * KEY FEATURE: Modular role-permissions manager.
 *
 * Fetches the full { role: { featureKey: bool } } map, renders three sections
 * (دانش‌آموز/معلم/مدیر) each listing the features defined for that role in
 * FEATURES_BY_ROLE. Toggling a switch optimistically flips the local state
 * + fires a PATCH + toast. Reset button wipes all overrides back to the
 * default-everything-enabled snapshot.
 *
 * SUPERADMIN is intentionally NOT listed — they are a superset of every role
 * and always pass permission checks (see permission-check.ts).
 */
export function RolePermissionsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<Permissions>({
    queryKey: ["superadmin-permissions"],
    queryFn: getSuperAdminPermissions,
  });

  // Local optimistic snapshot — mirrors server data while a PATCH is in
  // flight, so the Switch reflects the user's click immediately. After
  // the PATCH resolves we refetch / sync from the server snapshot.
  const [optimistic, setOptimistic] = React.useState<Permissions | null>(
    null,
  );
  React.useEffect(() => {
    if (data) setOptimistic(data);
  }, [data]);

  // Track per-feature in-flight toggles so the Switch shows a spinner /
  // disabled state during the round-trip.
  const [pendingKeys, setPendingKeys] = React.useState<Set<string>>(
    new Set(),
  );
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);

  function key(role: ManagedRole, featureKey: string) {
    return `${role}:${featureKey}`;
  }

  function currentValue(role: ManagedRole, featureKey: string): boolean {
    const source = optimistic ?? data;
    const v = source?.[role]?.[featureKey];
    return v ?? true; // missing => default-true
  }

  async function handleToggle(
    role: ManagedRole,
    f: FeatureDef,
    next: boolean,
  ) {
    const k = key(role, f.key);
    const prev = currentValue(role, f.key);
    if (next === prev) return;

    // Optimistic update
    setOptimistic((cur) => {
      const base: Permissions = cur ?? data ?? {};
      const roleMap = { ...(base[role] ?? {}) };
      roleMap[f.key] = next;
      return { ...base, [role]: roleMap };
    });
    setPendingKeys((prev) => {
      const nextSet = new Set(prev);
      nextSet.add(k);
      return nextSet;
    });

    try {
      const serverSnapshot = await patchSuperAdminPermission({
        role,
        featureKey: f.key,
        enabled: next,
      });
      // Sync server snapshot — replaces optimistic with the truth.
      setOptimistic(serverSnapshot);
      toast({
        title: next ? "قابلیت فعال شد" : "قابلیت غیرفعال شد",
        description: `${f.label} برای نقش «${
          ROLE_META.find((r) => r.role === role)?.label ?? role
        }» ${next ? "فعال" : "غیرفعال"} شد`,
      });
      qc.invalidateQueries({ queryKey: ["superadmin-permissions"] });
    } catch (err) {
      // Roll back
      setOptimistic((cur) => {
        const base: Permissions = cur ?? data ?? {};
        const roleMap = { ...(base[role] ?? {}) };
        roleMap[f.key] = prev;
        return { ...base, [role]: roleMap };
      });
      toast({
        title: "خطا در به‌روزرسانی دسترسی",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setPendingKeys((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(k);
        return nextSet;
      });
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const snap = await resetSuperAdminPermissions();
      setOptimistic(snap);
      toast({
        title: "دسترسی‌ها بازنشانی شد",
        description: "همه قابلیت‌ها به حالت پیش‌فرض (همه فعال) بازگشتند.",
      });
      qc.invalidateQueries({ queryKey: ["superadmin-permissions"] });
      setResetOpen(false);
    } catch (err) {
      toast({
        title: "خطا در بازنشانی",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              دسترسی نقش‌ها
            </h2>
            <p className="text-sm text-muted-foreground">
              کنترل ماژولار قابلیت‌های هر نقش
            </p>
          </div>
        </header>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-6 text-center text-sm text-red-500">
            خطا در بارگذاری دسترسی‌ها:{" "}
            {(error as Error)?.message || "نامشخص"}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in-up">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              دسترسی نقش‌ها
            </h2>
            <p className="text-sm text-muted-foreground">
              کنترل ماژولار قابلیت‌های هر نقش
            </p>
          </div>
        </header>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-64 w-full border border-border bg-card/60"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in-up">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <KeyRound className="size-6 text-emerald-500" />
            دسترسی نقش‌ها
          </h2>
          <p className="text-sm text-muted-foreground">
            با این کنترل‌ها می‌توانید قابلیت‌های هر نقش را به‌صورت ماژولار
            محدود کنید.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setResetOpen(true)}
          className="gap-2 border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="size-4" />
          بازنشانی همه
        </Button>
      </header>

      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200/80">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        <p className="leading-relaxed">
          تغییر هر کلید، بلافاصله روی تمام کاربران آن نقش اعمال می‌شود.
          کاربران با نقش <code dir="ltr" className="text-emerald-500">SUPERADMIN</code>{" "}
          همواره دسترسی کامل دارند و در این لیست قرار نمی‌گیرند.
        </p>
      </div>

      {/* Three sections — one per managed role */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {ROLE_META.map((meta) => {
          const features = FEATURES_BY_ROLE[meta.role];
          const Icon = meta.icon;
          return (
            <Card
              key={meta.role}
              className={cn(
                "flex flex-col border",
                meta.accentClassName,
              )}
            >
              <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg ring-1",
                    meta.iconClassName,
                  )}
                >
                  <Icon className="size-5" />
                </div>
                <div className="flex flex-col">
                  <CardTitle className="text-base text-foreground">
                    {meta.label}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="ml-auto border-border bg-muted/40 text-foreground persian-nums"
                >
                  {features.length} قابلیت
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 p-2">
                {features.map((f) => {
                  const enabled = currentValue(meta.role, f.key);
                  const pending = pendingKeys.has(
                    key(meta.role, f.key),
                  );
                  return (
                    <PermissionRow
                      key={f.key}
                      feature={f}
                      enabled={enabled}
                      pending={pending}
                      onToggle={(next) =>
                        handleToggle(meta.role, f, next)
                      }
                    />
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="بازنشانی همه دسترسی‌ها"
        description="این عملیات همه تنظیمات دسترسی را به حالت پیش‌فرض (همه قابلیت‌ها فعال) بازمی‌گرداند. آیا مطمئن هستید؟"
        confirmText="بازنشانی همه"
        loading={resetting}
        onConfirm={handleReset}
      />
    </div>
  );
}

interface PermissionRowProps {
  feature: FeatureDef;
  enabled: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
}

function PermissionRow({
  feature,
  enabled,
  pending,
  onToggle,
}: PermissionRowProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors",
        "hover:bg-muted/50",
      )}
    >
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {feature.label}
          </span>
          {pending && (
            <Loader2 className="size-3 animate-spin text-emerald-500" />
          )}
        </div>
        <span className="text-xs text-muted-foreground">{feature.description}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-[10px] font-medium",
            enabled ? "text-emerald-500" : "text-muted-foreground",
          )}
        >
          {enabled ? "فعال" : "غیرفعال"}
        </span>
        <Switch
          checked={enabled}
          disabled={pending}
          onCheckedChange={onToggle}
          aria-label={feature.label}
          className={cn(
            "data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-input",
          )}
        />
      </div>
    </div>
  );
}
