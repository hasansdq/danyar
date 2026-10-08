/**
 * Phase 34 — pluggable AI provider.
 *
 * The SUPERADMIN can configure one of three providers via
 * /superadmin/ai-settings:
 *
 *   - "zai" (default)       → uses the built-in z-ai-web-dev-sdk
 *                             (the original behavior, no config needed).
 *   - "openai"              → uses an OpenAI-compatible HTTP endpoint
 *                             (POST {baseUrl}/chat/completions) with
 *                             Bearer auth. Works with OpenAI, Azure
 *                             OpenAI, OpenRouter, Together, Groq,
 *                             local llama.cpp/Ollama, etc.
 *   - "anthropic"           → uses the Anthropic Messages API
 *                             (POST {baseUrl}/messages) with x-api-key
 *                             + the `anthropic-version` header.
 *
 * The provider config is stored in the SiteSetting table:
 *   - ai_provider_type       ("zai" | "openai" | "anthropic")
 *   - ai_provider_api_key    (the API key — kept secret)
 *   - ai_provider_base_url   (optional — empty = provider's default URL)
 *   - ai_provider_model      (optional — empty = provider's default model)
 *
 * This module exposes two functions:
 *   - `callLLM(messages, systemPrompt)` — the main entry point used by
 *     the AI assistant route. Returns the assistant's text reply.
 *   - `testLLMConnection()` — a quick test call used by the SUPERADMIN
 *     "تست اتصال" button to verify the saved config works.
 *
 * If the provider is "zai" or the API key is missing/empty, we fall back
 * to z-ai-web-dev-sdk (the original behavior). This guarantees the AI
 * assistant never breaks if the SUPERADMIN hasn't configured a custom
 * provider.
 */

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

/** Chat message format used by both the AI assistant route + the test
 * function. Mirrors the OpenAI message shape. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The saved provider config (read directly from the DB). */
export interface AiProviderConfig {
  /** "zai" | "openai" | "anthropic" — defaults to "zai". */
  type: string;
  /** API key — empty string when not set. */
  apiKey: string;
  /** Base URL — empty string when not set (use provider default). */
  baseUrl: string;
  /** Model name — empty string when not set (use provider default). */
  model: string;
}

const DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-20241022",
  },
};

/**
 * Read the saved provider config from the SiteSetting table. Returns
 * the config with all fields filled in (empty string when not set).
 *
 * The lookup is a single batched findMany — we read all 4 keys at
 * once + map them into the AiProviderConfig shape. The values are
 * stored as strings in the DB (the existing SiteSetting schema), so
 * no JSON parsing is needed.
 */
export async function getProviderConfig(): Promise<AiProviderConfig> {
  const rows = await db.siteSetting.findMany({
    where: {
      key: {
        in: [
          "ai_provider_type",
          "ai_provider_api_key",
          "ai_provider_base_url",
          "ai_provider_model",
        ],
      },
    },
    select: { key: true, value: true },
  });
  const lookup = new Map(rows.map((r) => [r.key, r.value]));
  return {
    type: (lookup.get("ai_provider_type") ?? "zai").trim() || "zai",
    apiKey: (lookup.get("ai_provider_api_key") ?? "").trim(),
    baseUrl: (lookup.get("ai_provider_base_url") ?? "").trim(),
    model: (lookup.get("ai_provider_model") ?? "").trim(),
  };
}

/**
 * Resolve the final baseUrl + model for the config (filling in
 * provider defaults when the SUPERADMIN left them empty).
 */
function resolveProviderDefaults(config: AiProviderConfig): {
  baseUrl: string;
  model: string;
} {
  const defaults = DEFAULTS[config.type] ?? { baseUrl: "", model: "" };
  return {
    baseUrl: config.baseUrl || defaults.baseUrl,
    model: config.model || defaults.model,
  };
}

/**
 * Call the LLM with the configured provider. The `messages` array
 * follows the OpenAI shape; for Anthropic we extract the system
 * message + convert the rest to user/assistant turns.
 *
 * @param messages The chat history (system + user + assistant turns).
 * @returns The assistant's text reply.
 * @throws Error if the call fails (the caller should catch + return
 *   a friendly Persian error message).
 */
export async function callLLM(
  messages: ChatMessage[],
): Promise<string> {
  const config = await getProviderConfig();

  // Fall back to the default z-ai-web-dev-sdk when:
  //   - provider type is "zai" (or empty/unknown), OR
  //   - the API key is empty.
  // This guarantees the AI assistant never breaks if the SUPERADMIN
  // hasn't configured a custom provider.
  if (config.type === "zai" || !config.apiKey) {
    return callZai(messages);
  }

  if (config.type === "openai") {
    return callOpenAICompatible(config, messages);
  }
  if (config.type === "anthropic") {
    return callAnthropic(config, messages);
  }

  // Unknown provider type — fall back to z-ai-web-dev-sdk.
  return callZai(messages);
}

/**
 * Fallback: use the built-in z-ai-web-dev-sdk. The SDK creates the
 * ZAI client lazily + the `chat.completions.create` call mirrors the
 * OpenAI shape (so we just pass the messages through). The
 * `thinking: { type: "disabled" }` option disables chain-of-thought
 * leakage (matches the original AI assistant behavior).
 */
async function callZai(messages: ChatMessage[]): Promise<string> {
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    thinking: { type: "disabled" },
  });
  return (
    completion?.choices?.[0]?.message?.content?.toString() ??
    "متأسفم، پاسخی دریافت نشد."
  );
}

/**
 * Call an OpenAI-compatible HTTP endpoint
 * (POST {baseUrl}/chat/completions with Bearer auth).
 *
 * Works with OpenAI, Azure OpenAI, OpenRouter, Together, Groq,
 * local llama.cpp/Ollama (with the OpenAI-compatible server), etc. —
 * any service that implements the OpenAI Chat Completions API.
 *
 * Response shape (OpenAI Chat Completions):
 *   { choices: [{ message: { role, content } }] }
 */
async function callOpenAICompatible(
  config: AiProviderConfig,
  messages: ChatMessage[],
): Promise<string> {
  const { baseUrl, model } = resolveProviderDefaults(config);
  // Strip any trailing slash so `baseUrl + "/chat/completions"` is
  // always a clean URL.
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenAI-compatible API error (${res.status}): ${text.slice(0, 500)}`,
    );
  }
  const data = await res.json();
  const content: string | undefined =
    data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI-compatible API returned no content");
  }
  return content;
}

/**
 * Call the Anthropic Messages API
 * (POST {baseUrl}/messages with x-api-key + anthropic-version header).
 *
 * The Anthropic API uses a separate `system` parameter (NOT a system
 * message in the messages array). We extract the system message (if
 * any) from the messages array + pass it as the `system` parameter.
 *
 * Response shape (Anthropic Messages):
 *   { content: [{ type: "text", text: "..." }] }
 */
async function callAnthropic(
  config: AiProviderConfig,
  messages: ChatMessage[],
): Promise<string> {
  const { baseUrl, model } = resolveProviderDefaults(config);
  const url = `${baseUrl.replace(/\/+$/, "")}/messages`;
  // Extract the system message (Anthropic puts it in a separate
  // top-level `system` param, NOT in the messages array).
  const systemMessages = messages.filter((m) => m.role === "system");
  const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");
  const conversationMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: conversationMessages,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Anthropic API error (${res.status}): ${text.slice(0, 500)}`,
    );
  }
  const data = await res.json();
  // Anthropic returns content as an array of blocks; we concatenate
  // all text blocks.
  const blocks: Array<{ type: string; text?: string }> =
    data?.content ?? [];
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  if (!text) {
    throw new Error("Anthropic API returned no text content");
  }
  return text;
}

/**
 * Test the saved provider config by sending a tiny "Hello" message.
 * Used by the SUPERADMIN "تست اتصال" button to verify the saved config
 * works before the principal relies on it.
 *
 * @returns `{ ok: true, reply: string }` on success,
 *          `{ ok: false, error: string }` on failure (with a Persian
 *          message describing the error).
 */
export async function testLLMConnection(): Promise<
  { ok: true; reply: string } | { ok: false; error: string }
> {
  try {
    const reply = await callLLM([
      { role: "system", content: "You are a test assistant. Reply briefly." },
      { role: "user", content: "Hello, please reply with: OK" },
    ]);
    return { ok: true, reply: reply.slice(0, 200) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "خطای غیرمنتظره";
    return { ok: false, error: msg };
  }
}
