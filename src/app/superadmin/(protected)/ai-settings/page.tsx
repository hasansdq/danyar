import { AiSettingsManager } from "@/components/superadmin/ai-settings-manager";

export const dynamic = "force-dynamic";

/**
 * /superadmin/ai-settings
 *
 * SUPERADMIN-only page that manages the principal's AI-assistant:
 *   1. The welcome message shown when the chat panel first opens.
 *   2. The suggested-prompts quick-reply chips.
 *   3. The AI's data-access toggles (school stats, student info, password
 *      change) — these gate which tools the AI assistant can invoke.
 *
 * The page itself is a thin server component that just mounts the client
 * manager; all the TanStack Query + form state lives in
 * {@link AiSettingsManager} so we can keep this route force-dynamic and
 * SSR-safe.
 */
export default function SuperAdminAiSettingsPage() {
  return <AiSettingsManager />;
}
