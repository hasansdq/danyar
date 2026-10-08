"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Eye,
  EyeOff,
  Loader2,
  Plug,
  Save,
  ServerCog,
  Sparkles,
} from "lucide-react";
import {
  fetchExtendedSettings,
  patchSettingValue,
} from "@/lib/superadmin-api";
import type { SiteSettings } from "@/lib/site-settings";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Phase 34 — AI Provider Config.
 *
 * Lets the SUPERADMIN configure a custom AI provider for the principal's
 * AI assistant. Three options:
 *
 *   1. «پیش‌فرض» (default) — uses the built-in z-ai-web-dev-sdk (the
 *      original behavior, no config needed).
 *   2. «OpenAI (سازگار)» — uses an OpenAI-compatible HTTP endpoint
 *      with Bearer auth. Works with OpenAI, Azure OpenAI, OpenRouter,
 *      Together, Groq, local llama.cpp/Ollama, etc.
 *   3. «Anthropic» — uses the Anthropic Messages API with x-api-key
 *      + the `anthropic-version` header.
 *
 * Fields:
 *   - Provider dropdown (default / openai / anthropic)
 *   - API key input (with show/hide toggle). When a key is already
 *     saved, the masked value is shown as a placeholder + the field
 *     is empty so the superadmin can type a new key. Leaving the
 *     field empty keeps the existing saved key.
 *   - Base URL input (optional — empty = use the provider's default).
 *   - Model name input (optional — empty = use the provider's default).
 *   - Save button → PATCHes the 4 keys.
 *   - Test connection button → POST /api/superadmin/ai-provider/test
 *     → shows a toast with the result.
 *
 * The 4 keys are stored in the SiteSetting table:
 *   ai_provider_type, ai_provider_api_key, ai_provider_base_url,
 *   ai_provider_model. The GET /api/superadmin/settings route returns
 *   the API key MASKED (so the network payload never leaks the full
 *   key); the AI assistant route reads the full key directly from the DB.
 */

type Provider = "zai" | "openai" | "anthropic";

interface TestResult {
  ok: boolean;
  reply?: string;
  error?: string;
}

/** Default base URL + model per provider (used when the field is empty). */
const PROVIDER_DEFAULTS: Record<Provider, { baseUrl: string; model: string; hint: string }> = {
  zai: {
    baseUrl: "",
    model: "",
    hint: "از موتور داخلی زد-ای-آی استفاده می‌شود (نیازی به کلید API نیست).",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    hint: "سازگار با OpenAI، Azure OpenAI، OpenRouter، Together، Groq، Ollama و …",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-20241022",
    hint: "سازگار با Anthropic Messages API (claude-3-5-sonnet و …)",
  },
};

export function AiProviderConfig() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Read the saved settings via the same shared cache as the rest of
  // the AiSettingsManager page so the values stay in sync after saves.
  const { data, isLoading } = useQuery<SiteSettings>({
    queryKey: ["ai-settings"],
    queryFn: fetchExtendedSettings,
    staleTime: 60 * 1000,
  });

  // ---- Local editable state ------------------------------------------
  const [provider, setProvider] = React.useState<Provider>("zai");
  // `apiKeyInput` is the input field. Empty when the user hasn't typed
  // a new key. The placeholder shows the masked saved key (if any) so
  // the user knows a key is already set.
  const [apiKeyInput, setApiKeyInput] = React.useState("");
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [baseUrl, setBaseUrl] = React.useState("");
  const [model, setModel] = React.useState("");
  const [hydrated, setHydrated] = React.useState(false);

  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);

  // Hydrate local state once the server snapshot resolves.
  React.useEffect(() => {
    if (!data) return;
    const type = (data.aiProviderType ?? "zai") as Provider;
    setProvider(type === "openai" || type === "anthropic" ? type : "zai");
    setApiKeyInput(""); // never pre-fill the API key (security)
    setBaseUrl(data.aiProviderBaseUrl ?? "");
    setModel(data.aiProviderModel ?? "");
    setHydrated(true);
    setTestResult(null);
  }, [data]);

  // The masked API key is shown as a placeholder when a key is saved.
  // We trust the masked value returned by the GET endpoint.
  const maskedApiKey = data?.aiProviderApiKey ?? "";
  const apiKeyIsSet = maskedApiKey.length > 0 && maskedApiKey !== "";

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setTestResult(null);
    try {
      // PATCH all 4 keys. We always PATCH type + baseUrl + model so
      // the user can clear them by saving an empty string. The API
      // key is only PATCHed when the user typed a new value —
      // otherwise we leave the existing saved key untouched.
      await patchSettingValue("ai_provider_type", provider);
      await patchSettingValue("ai_provider_base_url", baseUrl.trim());
      await patchSettingValue("ai_provider_model", model.trim());
      if (apiKeyInput.trim()) {
        await patchSettingValue("ai_provider_api_key", apiKeyInput.trim());
      }
      // Invalidate the shared caches so the new values propagate to
      // all open tabs + the principal's AI assistant panel.
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
      qc.invalidateQueries({ queryKey: ["site-settings"] });
      toast({
        title: "تنظیمات ارائه‌دهنده ذخیره شد",
        description: "تغییرات بلافاصله روی دستیار مدیر اعمال می‌شود.",
      });
      setApiKeyInput("");
    } catch (err) {
      toast({
        title: "خطا در ذخیره تنظیمات",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<TestResult>(
        "/api/superadmin/ai-provider/test",
        { method: "POST" },
      );
      setTestResult(res);
      if (res.ok) {
        toast({
          title: "اتصال موفق بود ✓",
          description: `پاسخ مدل: ${res.reply ?? ""}`.slice(0, 200),
        });
      } else {
        toast({
          title: "اتصال ناموفق بود",
          description: res.error ?? "خطای ناشناخته",
          variant: "destructive",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
      setTestResult({ ok: false, error: msg });
      toast({
        title: "اتصال ناموفق بود",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  const defaults = PROVIDER_DEFAULTS[provider];

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
            <ServerCog className="size-5" />
          </div>
          <div className="flex flex-1 flex-col">
            <CardTitle className="text-base text-foreground">
              ارائه‌دهنده هوش مصنوعی
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              مدل و ارائه‌دهنده‌ای که دستیار مدیر از آن استفاده می‌کند. می‌توانید
              از موتور داخلی استفاده کنید یا یک ارائه‌دهنده دلخواه (OpenAI یا
              Anthropic) پیکربندی کنید.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-4">
        {isLoading || !hydrated ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            در حال بارگذاری…
          </div>
        ) : (
          <>
            {/* Provider type */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-provider-type">نوع ارائه‌دهنده</Label>
              <Select
                value={provider}
                onValueChange={(v) => setProvider(v as Provider)}
                disabled={saving}
              >
                <SelectTrigger id="ai-provider-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zai">پیش‌فرض (زد-ای-آی)</SelectItem>
                  <SelectItem value="openai">OpenAI (سازگار)</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{defaults.hint}</p>
            </div>

            {/* API key — only shown when a custom provider is picked. */}
            {provider !== "zai" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="ai-provider-api-key">
                  کلید API{" "}
                  <span className="text-[11px] text-muted-foreground">
                    {apiKeyIsSet
                      ? "(کلید ذخیره شده است — برای تغییر، کلید جدید را وارد کنید)"
                      : "(الزامی)"}
                  </span>
                </Label>
                <div className="relative">
                  <Input
                    id="ai-provider-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={
                      apiKeyIsSet
                        ? `●●●●●●●●${maskedApiKey.slice(-4)}`
                        : "مثال: sk-..."
                    }
                    disabled={saving}
                    dir="ltr"
                    className="pr-10 text-left font-mono"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute inset-y-0 left-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={showApiKey ? "پنهان کردن کلید" : "نمایش کلید"}
                    tabIndex={-1}
                  >
                    {showApiKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  کلید به‌صورت امن در دیتابیس ذخیره می‌شود و در پاسخ‌های API به‌صورت
                  ماسک‌شده نمایش داده می‌شود.
                </p>
              </div>
            )}

            {/* Base URL + Model — only shown when a custom provider is picked. */}
            {provider !== "zai" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ai-provider-base-url">Base URL</Label>
                  <Input
                    id="ai-provider-base-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={defaults.baseUrl}
                    disabled={saving}
                    dir="ltr"
                    className="text-left"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    خالی = پیش‌فرض ارائه‌دهنده.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ai-provider-model">نام مدل</Label>
                  <Input
                    id="ai-provider-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={defaults.model}
                    disabled={saving}
                    dir="ltr"
                    className="text-left"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    خالی = مدل پیش‌فرض ارائه‌دهنده.
                  </p>
                </div>
              </div>
            )}

            {/* Save + Test buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || testing}
                className="gap-1.5"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                ذخیره تنظیمات
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={saving || testing || provider === "zai"}
                className="gap-1.5"
                title={
                  provider === "zai"
                    ? "برای موتور پیش‌فرض نیاز به تست نیست"
                    : "ارسال یک پیام تستی به ارائه‌دهنده"
                }
              >
                {testing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                تست اتصال
              </Button>
              {testResult && (
                <span
                  className={`flex items-center gap-1.5 text-xs ${
                    testResult.ok
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive"
                  }`}
                >
                  <Sparkles className="size-3.5" />
                  {testResult.ok
                    ? `پاسخ دریافت شد: ${testResult.reply ?? ""}`.slice(0, 100)
                    : `خطا: ${testResult.error ?? ""}`.slice(0, 100)}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
