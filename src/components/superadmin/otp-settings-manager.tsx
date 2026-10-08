"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquareDot,
  KeyRound,
  Cable,
  SendHorizontal,
  History,
  Loader2,
  Save,
  ShieldCheck,
  ShieldAlert,
  FlaskConical,
  ExternalLink,
  Eraser,
  CircleCheck,
  CircleX,
  Clock,
  ServerCog,
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
 * «مدیریت OTP» — the superadmin's provider-based SMS OTP console (Phase 37).
 *
 * Backed by /api/superadmin/otp-settings:
 *  1. Engine settings — TTL (default 120s) + per-phone/IP/device rate caps.
 *  2. Provider adapters — OTPy / Melipayamak / Faraz / SMS.ir, each with an
 *     enable switch, write-only credentials (secrets NEVER displayed — only
 *     a "set via panel/env" badge) and a «تست اتصال» button.
 *  3. Active provider selection — only enabled + fully configured providers
 *     are selectable.
 *  4. «ارسال OTP آزمایشی» — a real end-to-end OTP through the active provider.
 *  5. Status + delivery log — last send time, last error, recent attempts.
 */

// ---------------------------------------------------------------------------
// API types (mirror /api/superadmin/otp-settings GET)
// ---------------------------------------------------------------------------

interface ProviderFieldInfo {
  key: string;
  label: string;
  description: string | null;
  secret: boolean;
  required: boolean;
  envVar: string;
  placeholder: string | null;
  isSet: boolean;
  source: "db" | "env" | "unset";
  value?: string; // NON-SECRET only
}

interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  docsUrl: string;
  managed: boolean;
  plainSms: boolean;
  enabled: boolean;
  configured: boolean;
  fields: ProviderFieldInfo[];
}

interface DeliveryLogRow {
  id: string;
  provider: string;
  phoneMasked: string;
  status: string;
  messageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  purpose: string;
  createdAt: string;
}

interface OtpSettingsData {
  activeProvider: string;
  testCodeDisplay: boolean;
  superadminPhone: string;
  engine: {
    ttlSeconds: number;
    ratePhonePerHour: number;
    rateIpPerHour: number;
    rateDevicePerHour: number;
  };
  providers: ProviderInfo[];
  status: {
    lastSendAt: string | null;
    lastError: { provider: string; errorCode: string | null; errorMessage: string | null; at: string } | null;
    recentLogs: DeliveryLogRow[];
  };
}

interface TestConnectionResult {
  ok: boolean;
  provider: string;
  detail: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number;
}

interface SendTestResult {
  ok: boolean;
  provider?: string;
  managed?: boolean;
  ttlSeconds?: number;
  messageId?: string | null;
  detail?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

const PURPOSE_LABELS: Record<string, string> = {
  otp: "کد ورود",
  "otp-test": "آزمایشی",
  announcement: "اطلاعیه",
  "test-connection": "تست اتصال",
};

const PROVIDER_LABELS: Record<string, string> = {
  otpy: "OTPy",
  melipayamak: "ملی پیامک",
  faraz: "فراز اس‌ام‌اس",
  smsir: "SMS.ir",
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OtpSettingsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<OtpSettingsData>({
    queryKey: ["otp-settings"],
    queryFn: () => apiFetch<OtpSettingsData>("/api/superadmin/otp-settings"),
    staleTime: 30 * 1000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["otp-settings"] });

  // ---- Engine draft -------------------------------------------------------
  const [engineDraft, setEngineDraft] = React.useState<OtpSettingsData["engine"] | null>(null);
  React.useEffect(() => {
    if (data && !engineDraft) setEngineDraft(data.engine);
  }, [data, engineDraft]);

  const [savingEngine, setSavingEngine] = React.useState(false);

  async function saveEngine() {
    if (!engineDraft || !data) return;
    setSavingEngine(true);
    try {
      await apiFetch("/api/superadmin/otp-settings", {
        method: "PATCH",
        body: JSON.stringify({
          ttlSeconds: engineDraft.ttlSeconds,
          rateLimits: {
            phonePerHour: engineDraft.ratePhonePerHour,
            ipPerHour: engineDraft.rateIpPerHour,
            devicePerHour: engineDraft.rateDevicePerHour,
          },
        }),
      });
      toast({ title: "تنظیمات موتور OTP ذخیره شد" });
      await refresh();
    } catch (err) {
      toast({ title: "خطا در ذخیره", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingEngine(false);
    }
  }

  // ---- Provider credential drafts ---------------------------------------
  // NON-SECRET fields keep a full draft synced from the server (editable
  // inputs showing current values). SECRET fields are WRITE-ONLY: the input
  // is always empty; a typed value upserts and «پاک کردن» queues a clear.
  const [credDrafts, setCredDrafts] = React.useState<Record<string, Record<string, string>>>({});
  const [secretDrafts, setSecretDrafts] = React.useState<Record<string, Record<string, string>>>({});
  const [clearingSecrets, setClearingSecrets] = React.useState<Record<string, string[]>>({});
  const [dirtyProviders, setDirtyProviders] = React.useState<Set<string>>(new Set());
  const [savingCreds, setSavingCreds] = React.useState<Set<string>>(new Set());

  // Sync non-secret drafts from the server snapshot (preserve dirty edits).
  React.useEffect(() => {
    if (!data) return;
    setCredDrafts((prev) => {
      const next = { ...prev };
      for (const p of data.providers) {
        if (dirtyProviders.has(p.id)) continue;
        next[p.id] = Object.fromEntries(
          p.fields.filter((f) => !f.secret).map((f) => [f.key, f.value ?? ""]),
        );
      }
      return next;
    });
  }, [data, dirtyProviders]);

  function setFieldDraft(p: ProviderInfo, key: string, value: string) {
    setCredDrafts((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] ?? {}), [key]: value } }));
    setDirtyProviders((prev) => new Set(prev).add(p.id));
  }

  function setSecretDraft(p: ProviderInfo, key: string, value: string) {
    setSecretDrafts((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] ?? {}), [key]: value } }));
    if (value.trim()) {
      setClearingSecrets((prev) => ({ ...prev, [p.id]: (prev[p.id] ?? []).filter((k) => k !== key) }));
    }
    setDirtyProviders((prev) => new Set(prev).add(p.id));
  }

  function markSecretClear(p: ProviderInfo, key: string) {
    setClearingSecrets((prev) => ({ ...prev, [p.id]: [...new Set([...(prev[p.id] ?? []), key])] }));
    setSecretDrafts((prev) => {
      const forProvider = { ...(prev[p.id] ?? {}) };
      delete forProvider[key];
      return { ...prev, [p.id]: forProvider };
    });
    setDirtyProviders((prev) => new Set(prev).add(p.id));
  }

  function unmarkSecretClear(p: ProviderInfo, key: string) {
    setClearingSecrets((prev) => ({ ...prev, [p.id]: (prev[p.id] ?? []).filter((k) => k !== key) }));
  }

  function providerDraftDirty(p: ProviderInfo): boolean {
    const fieldDraft = credDrafts[p.id] ?? {};
    const fieldChanged = p.fields
      .filter((f) => !f.secret)
      .some((f) => (fieldDraft[f.key] ?? "") !== (f.value ?? ""));
    const secretTyped = Object.values(secretDrafts[p.id] ?? {}).some((v) => v.trim().length > 0);
    const clearing = (clearingSecrets[p.id] ?? []).length > 0;
    return fieldChanged || secretTyped || clearing;
  }

  async function saveCredentials(p: ProviderInfo) {
    const fieldDraft = credDrafts[p.id] ?? {};
    const secretDraft = secretDrafts[p.id] ?? {};
    const clearing = clearingSecrets[p.id] ?? [];
    const values: Record<string, string> = {};

    // Non-secret fields: send every CHANGED value (empty string clears).
    for (const f of p.fields) {
      if (f.secret) continue;
      const dv = (fieldDraft[f.key] ?? "").trim();
      if (dv !== (f.value ?? "").trim()) values[f.key] = dv;
    }
    // Secrets: typed values upsert; queued keys clear.
    for (const [k, v] of Object.entries(secretDraft)) {
      if (v.trim()) values[k] = v.trim();
    }
    for (const k of clearing) values[k] = "__clear__";

    if (Object.keys(values).length === 0) {
      toast({ title: "تغییری برای ذخیره وجود ندارد" });
      return;
    }
    setSavingCreds((prev) => new Set(prev).add(p.id));
    try {
      await apiFetch("/api/superadmin/otp-settings", {
        method: "PATCH",
        body: JSON.stringify({ credentials: { provider: p.id, values } }),
      });
      // Reset the provider's draft state (server snapshot re-syncs via effect).
      setSecretDrafts((prev) => ({ ...prev, [p.id]: {} }));
      setClearingSecrets((prev) => ({ ...prev, [p.id]: [] }));
      setDirtyProviders((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      toast({
        title: "اعتبارنامه‌ها ذخیره شد",
        description: `اطلاعات اتصال ${p.label} ذخیره شد. برای اطمینان، «تست اتصال» را اجرا کنید.`,
      });
      await refresh();
    } catch (err) {
      toast({ title: "خطا در ذخیره اعتبارنامه‌ها", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingCreds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  }

  // ---- Provider enable toggle ---------------------------------------------
  const [togglingProvider, setTogglingProvider] = React.useState<Set<string>>(new Set());

  async function toggleProvider(p: ProviderInfo, next: boolean) {
    setTogglingProvider((prev) => new Set(prev).add(p.id));
    try {
      await apiFetch("/api/superadmin/otp-settings", {
        method: "PATCH",
        body: JSON.stringify({ providerEnabled: { id: p.id, enabled: next } }),
      });
      toast({
        title: "وضعیت سرویس تغییر کرد",
        description: `${p.label} ${next ? "فعال" : "غیرفعال"} شد.`,
      });
      await refresh();
    } catch (err) {
      toast({ title: "خطا در تغییر وضعیت", description: (err as Error).message, variant: "destructive" });
    } finally {
      setTogglingProvider((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(p.id);
        return nextSet;
      });
    }
  }

  // ---- Active provider -----------------------------------------------------
  const [settingActive, setActiveBusy] = React.useState<string | null>(null);

  async function setActiveProvider(value: string) {
    if (!data || value === data.activeProvider) return;
    setActiveBusy(value);
    try {
      await apiFetch("/api/superadmin/otp-settings", {
        method: "PATCH",
        body: JSON.stringify({ activeProvider: value }),
      });
      toast({
        title: "سرویس فعال تغییر کرد",
        description: value === "off" ? "ارسال پیامک واقعی خاموش شد." : `سرویس فعال: ${PROVIDER_LABELS[value] ?? value}`,
      });
      await refresh();
    } catch (err) {
      toast({ title: "خطا در انتخاب سرویس", description: (err as Error).message, variant: "destructive" });
    } finally {
      setActiveBusy(null);
    }
  }

  // ---- Test connection -----------------------------------------------------
  const [testResults, setTestResults] = React.useState<Record<string, TestConnectionResult>>({});
  const [testingConn, setTestingConn] = React.useState<Set<string>>(new Set());

  async function runTestConnection(p: ProviderInfo) {
    setTestingConn((prev) => new Set(prev).add(p.id));
    try {
      const result = await apiFetch<TestConnectionResult>("/api/superadmin/otp-settings/test-connection", {
        method: "POST",
        body: JSON.stringify({ provider: p.id }),
      });
      setTestResults((prev) => ({ ...prev, [p.id]: result }));
      toast({
        title: result.ok ? `اتصال ${p.label} موفق بود` : `اتصال ${p.label} ناموفق بود`,
        description: result.ok ? (result.detail ?? undefined) : (result.errorMessage ?? undefined),
        variant: result.ok ? "default" : "destructive",
      });
      await refresh();
    } catch (err) {
      const message = (err as Error).message;
      setTestResults((prev) => ({
        ...prev,
        [p.id]: { ok: false, provider: p.id, detail: null, errorCode: "error", errorMessage: message, latencyMs: 0 },
      }));
      toast({ title: `اتصال ${p.label} ناموفق بود`, description: message, variant: "destructive" });
    } finally {
      setTestingConn((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  }

  // ---- Test OTP send ---------------------------------------------------------
  const [testPhone, setTestPhone] = React.useState<string>("");
  const [sendingTest, setSendingTest] = React.useState(false);
  const [sendResult, setSendResult] = React.useState<SendTestResult | null>(null);

  async function sendTestOtp() {
    if (sendingTest) return;
    setSendingTest(true);
    setSendResult(null);
    try {
      const result = await apiFetch<SendTestResult>("/api/superadmin/otp-settings/send-test", {
        method: "POST",
        body: JSON.stringify(testPhone.trim() ? { phone: testPhone.trim() } : {}),
      });
      setSendResult(result);
      toast({
        title: "OTP آزمایشی ارسال شد",
        description: result.detail ?? undefined,
      });
      await refresh();
    } catch (err) {
      const message = (err as Error).message;
      setSendResult({ ok: false, errorMessage: message, errorCode: "error" });
      toast({ title: "ارسال OTP آزمایشی ناموفق بود", description: message, variant: "destructive" });
    } finally {
      setSendingTest(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6 text-center text-sm text-destructive">
            خطا در بارگذاری تنظیمات OTP: {(error as Error)?.message || "نامشخص"}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !data || !engineDraft) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in-up">
        <Header />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LazySkeleton className="h-40 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-40 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-72 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-72 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-56 w-full border border-border bg-card/60" />
          <LazySkeleton className="h-56 w-full border border-border bg-card/60" />
        </div>
      </div>
    );
  }

  const activeProviderDef = data.providers.find((p) => p.id === data.activeProvider);
  const engineDirty =
    engineDraft.ttlSeconds !== data.engine.ttlSeconds ||
    engineDraft.ratePhonePerHour !== data.engine.ratePhonePerHour ||
    engineDraft.rateIpPerHour !== data.engine.rateIpPerHour ||
    engineDraft.rateDevicePerHour !== data.engine.rateDevicePerHour;

  return (
    <div className="flex flex-col gap-6 animate-fade-in-up">
      <Header />

      {/* ── Status strip ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard
          icon={ServerCog}
          label="سرویس فعال"
          value={data.activeProvider === "off" ? "خاموش (بدون ارسال واقعی)" : (activeProviderDef?.label ?? data.activeProvider)}
          tone={data.activeProvider === "off" ? "muted" : "ok"}
        />
        <StatusCard icon={Clock} label="آخرین ارسال موفق" value={formatTime(data.status.lastSendAt)} tone="muted" />
        <StatusCard
          icon={data.status.lastError ? ShieldAlert : ShieldCheck}
          label="آخرین خطای ارسال"
          value={
            data.status.lastError
              ? `${PROVIDER_LABELS[data.status.lastError.provider] ?? data.status.lastError.provider}: ${data.status.lastError.errorMessage ?? data.status.lastError.errorCode ?? "نامشخص"}`
              : "بدون خطا"
          }
          tone={data.status.lastError ? "err" : "ok"}
        />
        <StatusCard
          icon={FlaskConical}
          label="نمایش کد تستی در ورود"
          value={data.testCodeDisplay ? "فعال (حالت تستی)" : "غیرفعال (حالت واقعی)"}
          tone={data.testCodeDisplay ? "warn" : "muted"}
        />
      </div>

      {/* Test-mode warning */}
      {data.testCodeDisplay && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300/80">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p className="leading-relaxed">
            «نمایش کد ورود تستی» در بخش{" "}
            <a href="/superadmin/login-settings" className="font-medium underline underline-offset-2">
              مدیریت ورود کاربر
            </a>{" "}
            روشن است: کد تایید روی صفحه ورود نمایش داده می‌شود و برای ورود واقعی به سرویس پیامک نیازی نیست.
            برای محیط عملیاتی این گزینه را خاموش کنید.
          </p>
        </div>
      )}

      {/* ── Engine settings ──────────────────────────────────────────────── */}
      <Card className="border border-border bg-card">
        <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
            <KeyRound className="size-5" />
          </div>
          <div className="flex flex-1 flex-col">
            <CardTitle className="text-base text-foreground">تنظیمات موتور OTP</CardTitle>
            <p className="text-xs text-muted-foreground">
              مدت اعتبار کد و سقف درخواست‌ها — مستقل از سرویس پیامک و بدون نیاز به تغییر کد.
            </p>
          </div>
          {engineDirty && (
            <Badge variant="outline" className="ml-auto border-amber-500/40 text-amber-500">
              تغییرات ذخیره نشده
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              id="otp-ttl"
              label="مدت اعتبار کد (ثانیه)"
              hint="پیش‌فرض: ۱۲۰ — بازه مجاز: ۳۰ تا ۹۰۰"
              value={engineDraft.ttlSeconds}
              min={30}
              max={900}
              onChange={(n) => setEngineDraft({ ...engineDraft, ttlSeconds: n })}
            />
            <NumberField
              id="otp-rate-phone"
              label="سقف درخواست هر شماره (در ساعت)"
              hint="حالت واقعی — بازه: ۱ تا ۶۰"
              value={engineDraft.ratePhonePerHour}
              min={1}
              max={60}
              onChange={(n) => setEngineDraft({ ...engineDraft, ratePhonePerHour: n })}
            />
            <NumberField
              id="otp-rate-ip"
              label="سقف درخواست هر IP (در ساعت)"
              hint="حالت واقعی — بازه: ۱ تا ۲۴۰"
              value={engineDraft.rateIpPerHour}
              min={1}
              max={240}
              onChange={(n) => setEngineDraft({ ...engineDraft, rateIpPerHour: n })}
            />
            <NumberField
              id="otp-rate-device"
              label="سقف درخواست هر دستگاه (در ساعت)"
              hint="بر اساس شناسه امن کوکی دستگاه — بازه: ۱ تا ۲۴۰"
              value={engineDraft.rateDevicePerHour}
              min={1}
              max={240}
              onChange={(n) => setEngineDraft({ ...engineDraft, rateDevicePerHour: n })}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              onClick={() => void saveEngine()}
              disabled={savingEngine || !engineDirty}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {savingEngine ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  در حال ذخیره…
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  ذخیره تنظیمات موتور
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Active provider selection ────────────────────────────────────── */}
      <Card className="border border-border bg-card">
        <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
            <MessageSquareDot className="size-5" />
          </div>
          <div className="flex flex-1 flex-col">
            <CardTitle className="text-base text-foreground">سرویس فعال</CardTitle>
            <p className="text-xs text-muted-foreground">
              سرویسی که کدهای تایید و پیامک‌های اطلاع‌رسانی از طریق آن ارسال می‌شود. جابه‌جایی بدون تغییر در منطق احراز هویت است.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectableProviderCard
              label="خاموش"
              description="بدون ارسال پیامک واقعی — فقط حالت تستی (نمایش کد روی صفحه ورود) کار می‌کند."
              selected={data.activeProvider === "off"}
              busy={settingActive === "off"}
              onClick={() => void setActiveProvider("off")}
              tone="muted"
            />
            {data.providers.map((p) => {
              const selectable = p.enabled && p.configured;
              return (
                <SelectableProviderCard
                  key={p.id}
                  label={p.label}
                  description={
                    selectable
                      ? p.managed
                        ? "کد توسط خود سرویس تولید و تایید می‌شود (مدیریت‌شده)."
                        : "کد توسط سامانه تولید و از طریق این سرویس ارسال می‌شود."
                      : !p.enabled
                        ? "ابتدا این سرویس را فعال کنید."
                        : "اطلاعات اتصال کامل نیست — فیلدهای الزامی را ذخیره کنید."
                  }
                  selected={data.activeProvider === p.id}
                  busy={settingActive === p.id}
                  selectable={selectable}
                  onClick={() => void setActiveProvider(p.id)}
                  tone={p.managed ? "warn" : "ok"}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Provider configuration cards ─────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {data.providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            fieldDraft={credDrafts[p.id] ?? {}}
            secretDraft={secretDrafts[p.id] ?? {}}
            clearing={clearingSecrets[p.id] ?? []}
            dirty={providerDraftDirty(p)}
            onFieldDraft={(key, value) => setFieldDraft(p, key, value)}
            onSecretDraft={(key, value) => setSecretDraft(p, key, value)}
            onClearSecret={(key) => markSecretClear(p, key)}
            onUnclearSecret={(key) => unmarkSecretClear(p, key)}
            onSave={() => void saveCredentials(p)}
            saving={savingCreds.has(p.id)}
            onToggle={(next) => void toggleProvider(p, next)}
            toggling={togglingProvider.has(p.id)}
            onTest={() => void runTestConnection(p)}
            testing={testingConn.has(p.id)}
            testResult={testResults[p.id]}
          />
        ))}
      </div>

      {/* ── Test OTP send ────────────────────────────────────────────────── */}
      <Card className="border border-border bg-card">
        <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
            <SendHorizontal className="size-5" />
          </div>
          <div className="flex flex-1 flex-col">
            <CardTitle className="text-base text-foreground">ارسال OTP آزمایشی</CardTitle>
            <p className="text-xs text-muted-foreground">
              یک کد تایید واقعی از سرویس فعال به شماره دلخواه ارسال می‌شود تا کل زنجیره (تولید ← ارسال ← ذخیره هش‌شده ← لاگ) آزمایش شود.
            </p>
          </div>
          {data.activeProvider === "off" && (
            <Badge variant="outline" className="ml-auto border-destructive/40 text-destructive">
              سرویسی فعال نیست
            </Badge>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="tel"
              dir="ltr"
              inputMode="numeric"
              placeholder={data.superadminPhone ? `پیش‌فرض: ${data.superadminPhone}` : "09123456789"}
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              disabled={sendingTest}
              className="text-left focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60"
              aria-label="شماره موبایل مقصد OTP آزمایشی"
            />
            <Button
              type="button"
              onClick={() => void sendTestOtp()}
              disabled={sendingTest || data.activeProvider === "off"}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500 sm:w-auto"
            >
              {sendingTest ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  در حال ارسال…
                </>
              ) : (
                <>
                  <SendHorizontal className="size-4" />
                  ارسال کد آزمایشی
                </>
              )}
            </Button>
          </div>
          {sendResult && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed",
                sendResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300/90"
                  : "border-destructive/30 bg-destructive/5 text-destructive",
              )}
            >
              {sendResult.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0" />
              ) : (
                <CircleX className="mt-0.5 size-4 shrink-0" />
              )}
              <div className="flex flex-col gap-1">
                {sendResult.ok ? (
                  <span>
                    کد تایید با موفقیت از طریق «{PROVIDER_LABELS[sendResult.provider ?? ""] ?? sendResult.provider}» ارسال شد و تا{" "}
                    <strong>{sendResult.ttlSeconds} ثانیه</strong> معتبر است.
                    {sendResult.managed ? " (کد توسط خود سرویس تولید و تایید می‌شود.)" : " (کد در دیتابیس فقط به‌صورت هش‌شده ذخیره شد.)"}
                    {sendResult.detail ? ` ${sendResult.detail}` : ""}
                  </span>
                ) : (
                  <span>{sendResult.errorMessage ?? "ارسال ناموفق بود."}</span>
                )}
              </div>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            حداکثر ۵ ارسال آزمایشی در هر ۱۰ دقیقه. کد آزمایشی در پاسخ نمایش داده نمی‌شود — گیرنده آن را از پیامک می‌خواند.
          </p>
        </CardContent>
      </Card>

      {/* ── Delivery log ─────────────────────────────────────────────────── */}
      <Card className="border border-border bg-card">
        <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
            <History className="size-5" />
          </div>
          <div className="flex flex-1 flex-col">
            <CardTitle className="text-base text-foreground">گزارش ارسال پیامک</CardTitle>
            <p className="text-xs text-muted-foreground">
              ۲۰ رویداد آخر — بدون ذخیره کد تایید یا اطلاعات حساس؛ شماره‌ها به‌صورت ناقص (۰۹۱۲***۴۵۶۷) ثبت می‌شوند.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            className="ml-auto gap-2"
            aria-label="به‌روزرسانی گزارش"
          >
            به‌روزرسانی
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-muted-foreground">
                  <th className="px-3 py-2 font-medium">زمان</th>
                  <th className="px-3 py-2 font-medium">سرویس</th>
                  <th className="px-3 py-2 font-medium">شماره</th>
                  <th className="px-3 py-2 font-medium">نوع</th>
                  <th className="px-3 py-2 font-medium">وضعیت</th>
                  <th className="px-3 py-2 font-medium">جزئیات</th>
                </tr>
              </thead>
              <tbody>
                {data.status.recentLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      هنوز ارسالی ثبت نشده است.
                    </td>
                  </tr>
                )}
                {data.status.recentLogs.map((row) => (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground" dir="ltr">
                      {formatTime(row.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{PROVIDER_LABELS[row.provider] ?? row.provider}</td>
                    <td className="whitespace-nowrap px-3 py-2" dir="ltr">
                      {row.phoneMasked}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {PURPOSE_LABELS[row.purpose] ?? row.purpose}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {row.status === "sent" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CircleCheck className="size-3" /> ارسال شد
                          {typeof row.latencyMs === "number" ? ` (${row.latencyMs}ms)` : ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <CircleX className="size-3" /> ناموفق
                        </span>
                      )}
                    </td>
                    <td className="max-w-[22rem] truncate px-3 py-2 text-muted-foreground" title={row.errorMessage ?? row.errorCode ?? ""}>
                      {row.errorMessage ?? row.errorCode ?? (row.messageId ? `شناسه: ${row.messageId}` : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header() {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <MessageSquareDot className="size-6 text-emerald-500" />
          مدیریت OTP
        </h2>
        <p className="text-sm text-muted-foreground">
          سامانه کد تایید پیامکی چند-سرویسی — انتخاب سرویس فعال، اعتبارنامه‌ها، تنظیمات موتور و گزارش ارسال.
        </p>
      </div>
    </header>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "ok" | "err" | "warn" | "muted";
}) {
  const toneClasses = {
    ok: "text-emerald-600 dark:text-emerald-400",
    err: "text-destructive",
    warn: "text-amber-600 dark:text-amber-400",
    muted: "text-foreground",
  } as const;
  return (
    <Card className="border border-border bg-card/60">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] text-muted-foreground">{label}</span>
          <span className={cn("truncate text-sm font-medium", toneClasses[tone])} title={value}>
            {value}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        dir="ltr"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="text-left focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60"
      />
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SelectableProviderCard({
  label,
  description,
  selected,
  busy,
  selectable = true,
  onClick,
  tone,
}: {
  label: string;
  description: string;
  selected: boolean;
  busy: boolean;
  selectable?: boolean;
  onClick: () => void;
  tone: "ok" | "warn" | "muted";
}) {
  const ringClasses = {
    ok: "border-emerald-500/60 bg-emerald-500/5",
    warn: "border-amber-500/60 bg-amber-500/5",
    muted: "border-border",
  } as const;
  return (
    <button
      type="button"
      onClick={selectable ? onClick : undefined}
      disabled={!selectable || busy}
      aria-pressed={selected}
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border p-3 text-right transition-colors",
        selected ? ringClasses[tone] : "border-border bg-card hover:bg-muted/40",
        !selectable && "cursor-not-allowed opacity-50 hover:bg-card",
        selectable && !selected && "cursor-pointer",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
            selected ? "border-emerald-500" : "border-muted-foreground/40",
          )}
          aria-hidden
        >
          {selected && <span className="size-2 rounded-full bg-emerald-500" />}
        </span>
        <span className="text-sm font-medium text-foreground">{label}</span>
        {busy && <Loader2 className="ml-auto size-3 animate-spin text-emerald-500" />}
        {selected && !busy && (
          <Badge variant="outline" className="ml-auto border-emerald-500/40 text-emerald-500">
            فعال
          </Badge>
        )}
      </span>
      <span className="text-[11px] leading-relaxed text-muted-foreground">{description}</span>
    </button>
  );
}

function ProviderCard({
  provider,
  fieldDraft,
  secretDraft,
  clearing,
  dirty,
  onFieldDraft,
  onSecretDraft,
  onClearSecret,
  onUnclearSecret,
  onSave,
  saving,
  onToggle,
  toggling,
  onTest,
  testing,
  testResult,
}: {
  provider: ProviderInfo;
  fieldDraft: Record<string, string>;
  secretDraft: Record<string, string>;
  clearing: string[];
  dirty: boolean;
  onFieldDraft: (key: string, value: string) => void;
  onSecretDraft: (key: string, value: string) => void;
  onClearSecret: (key: string) => void;
  onUnclearSecret: (key: string) => void;
  onSave: () => void;
  saving: boolean;
  onToggle: (next: boolean) => void;
  toggling: boolean;
  onTest: () => void;
  testing: boolean;
  testResult?: TestConnectionResult;
}) {
  return (
    <Card className="flex flex-col border border-border bg-card transition-shadow hover:shadow-md">
      <CardHeader className="flex-row items-center gap-3 border-b border-border pb-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors",
            provider.enabled
              ? provider.managed
                ? "bg-amber-500/10 text-amber-500 ring-amber-500/20"
                : "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20"
              : "bg-muted/40 text-muted-foreground ring-border",
          )}
        >
          <MessageSquareDot className="size-5" />
        </div>
        <div className="flex flex-1 flex-col">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base text-foreground">
            {provider.label}
            {provider.managed && (
              <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-500">
                OTP مدیریت‌شده
              </Badge>
            )}
            {provider.plainSms ? (
              <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
                پیامک متنی
              </Badge>
            ) : (
              <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
                فقط کد تایید
              </Badge>
            )}
          </CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{provider.description}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {provider.configured ? (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
              پیکربندی شده
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500/40 text-amber-500">
              ناقص
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-4">
        {/* Enable + docs row */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Label
              htmlFor={`provider-enabled-${provider.id}`}
              className="cursor-pointer text-xs font-medium text-foreground"
            >
              {provider.enabled ? "فعال" : "غیرفعال"}
            </Label>
            {toggling && <Loader2 className="size-3 animate-spin text-emerald-500" />}
          </div>
          <Switch
            id={`provider-enabled-${provider.id}`}
            checked={provider.enabled}
            disabled={toggling}
            onCheckedChange={(next) => onToggle(next)}
            aria-label={`فعال/غیرفعال‌سازی ${provider.label}`}
            className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-muted-foreground/30"
          />
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-emerald-600 hover:underline dark:text-emerald-400"
          >
            مستندات رسمی
            <ExternalLink className="size-3" />
          </a>
        </div>

        {/* Credential fields */}
        <div className="flex flex-col gap-3">
          {provider.fields.map((f) => {
            const isClearing = clearing.includes(f.key);
            const sourceBadge =
              f.source === "db" ? (
                <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-500">
                  ذخیره‌شده در پنل
                </Badge>
              ) : f.source === "env" ? (
                <Badge variant="outline" className="border-sky-500/40 text-[10px] text-sky-600 dark:text-sky-400">
                  از متغیر محیطی
                </Badge>
              ) : (
                <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
                  تنظیم نشده
                </Badge>
              );
            return (
              <div key={f.key} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={`cred-${provider.id}-${f.key}`} className="text-xs font-medium text-foreground">
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </Label>
                  {f.secret ? sourceBadge : null}
                  {f.secret && f.isSet && isClearing && (
                    <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
                      در انتظار پاک‌سازی
                    </Badge>
                  )}
                  {f.secret && f.isSet && !isClearing && (
                    <button
                      type="button"
                      onClick={() => onClearSecret(f.key)}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive"
                    >
                      <Eraser className="size-3" />
                      پاک کردن
                    </button>
                  )}
                  {f.secret && f.isSet && isClearing && (
                    <button
                      type="button"
                      onClick={() => onUnclearSecret(f.key)}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      لغو
                    </button>
                  )}
                </div>
                <Input
                  id={`cred-${provider.id}-${f.key}`}
                  type={f.secret ? "password" : "text"}
                  dir="ltr"
                  autoComplete="off"
                  placeholder={
                    f.secret
                      ? f.isSet
                        ? "•••••••• (تنظیم شده — برای تغییر، مقدار جدید وارد کنید)"
                        : (f.placeholder ?? "—")
                      : (f.placeholder ?? "—")
                  }
                  value={f.secret ? (secretDraft[f.key] ?? "") : (fieldDraft[f.key] ?? "")}
                  onChange={(e) => {
                    if (f.secret) onSecretDraft(f.key, e.target.value);
                    else onFieldDraft(f.key, e.target.value);
                  }}
                  disabled={saving}
                  className="text-left focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60"
                />
                {f.description && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{f.description}</p>
                )}
                {!f.secret && f.envVar && (
                  <p className="text-[10px] text-muted-foreground/70" dir="ltr">
                    env: {f.envVar}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={saving || !dirty}
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            ذخیره اعتبارنامه‌ها
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onTest}
            disabled={testing || !provider.configured}
            className="gap-2"
          >
            {testing ? <Loader2 className="size-4 animate-spin text-emerald-500" /> : <Cable className="size-4" />}
            تست اتصال
          </Button>
          {!provider.configured && (
            <span className="text-[11px] text-muted-foreground">
              برای تست اتصال ابتدا فیلدهای الزامی را ذخیره کنید.
            </span>
          )}
        </div>

        {/* Test connection result */}
        {testResult && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed",
              testResult.ok
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300/90"
                : "border-destructive/30 bg-destructive/5 text-destructive",
            )}
          >
            {testResult.ok ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0" />
            )}
            <div className="flex flex-col gap-0.5">
              <span>
                {testResult.ok ? "اتصال موفق بود." : "اتصال ناموفق بود."}
                {testResult.detail ? ` ${testResult.detail}` : ""}
                {testResult.errorMessage && !testResult.ok ? ` (${testResult.errorMessage})` : ""}
                {typeof testResult.latencyMs === "number" && testResult.latencyMs > 0
                  ? ` — ${testResult.latencyMs}ms`
                  : ""}
              </span>
              {testResult.errorCode && !testResult.ok && (
                <code className="text-[10px] opacity-70" dir="ltr">
                  {testResult.errorCode}
                </code>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
