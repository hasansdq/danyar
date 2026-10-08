import { ServerCog } from "lucide-react";
import { AiProviderConfig } from "@/components/superadmin/ai-provider-config";

export const dynamic = "force-dynamic";

/**
 * /superadmin/ai-provider
 *
 * SUPERADMIN-only dedicated page for the AI provider config (Phase 34).
 * Hosts the `AiProviderConfig` component which lets the superadmin:
 *   - pick the provider (default z-ai-web-dev-sdk / OpenAI-compatible /
 *     Anthropic),
 *   - enter the API key,
 *   - set the base URL + model name,
 *   - test the connection.
 *
 * The saved config is then used as the AI provider for the ENTIRE system
 * (specifically the principal's AI assistant — see src/lib/ai-provider.ts).
 *
 * This is a separate page from `/superadmin/ai-settings` so the section
 * is discoverable from the sidebar (the "ارائه‌دهنده هوش مصنوعی" entry).
 * The same `AiProviderConfig` component is ALSO mounted on
 * `/superadmin/ai-settings` so users who go to "تنظیمات دستیار" still
 * see it at the top of that page.
 */
export default function SuperAdminAiProviderPage() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 animate-fade-in-up">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          ارائه‌دهنده هوش مصنوعی
        </h1>
        <p className="text-sm text-muted-foreground">
          کلید API، قالب API (OpenAI یا Anthropic) و Base URL را وارد کنید.
          این تنظیمات به‌عنوان ارائه‌دهنده هوش مصنوعی در کل سیستم (به‌ویژه
          دستیار مدیر مدرسه) استفاده می‌شود.
        </p>
      </header>

      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300/80">
        <ServerCog className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        <p className="leading-relaxed">
          این تنظیمات بلافاصله پس از ذخیره برای همه مدیران مدارس فعال
          می‌شود. اگر ارائه‌دهنده را روی «پیش‌فرض» بگذارید یا کلید API را
          خالی بگذارید، سیستم از موتور داخلی زد-ای-آی استفاده می‌کند.
        </p>
      </div>

      <AiProviderConfig />
    </div>
  );
}
