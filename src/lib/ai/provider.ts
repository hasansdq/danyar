/**
 * لایه ارتباط با سرویس هوش مصنوعی — فقط سمت سرور.
 * دو ارائه‌دهنده: openai (سازگار با endpoints متوافق) و anthropic.
 * همه درخواست‌ها از سرور برنامه ارسال می‌شوند؛ کلید API هرگز در پاسخ‌ها،
 * لاگ‌ها یا خطاهای برگشتی نمایش داده نمی‌شود (ماسک خودکار).
 */

import { describeNetworkError } from '@/lib/net-errors'

export type ProviderName = 'openai' | 'anthropic'

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCallOut {
  id: string
  name: string
  argsJson: string
}

export type UAMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; text: string | null; toolCalls: ToolCallOut[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface ProviderUsage {
  inputTokens: number | null
  outputTokens: number | null
}

export interface ProviderTurn {
  text: string | null
  toolCalls: ToolCallOut[]
  usage: ProviderUsage
}

export interface AiServiceConfig {
  provider: ProviderName
  baseUrl: string
  model: string
  apiKey: string
}

function timeoutMs(): number {
  const v = Number(process.env.AI_TIMEOUT_MS ?? '')
  return Number.isFinite(v) && v > 3000 ? v : 120000
}

/** پاک‌سازی هر الگوی شبیه کلید API از متن خطا قبل از نمایش/ثبت */
export function sanitizeErrorText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***')
}

/** پیام خطای قابل‌فهم فارسی + جزئیات واقعی سرویس‌دهنده */
export function describeProviderError(status: number, bodyText: string): string {
  let detail = ''
  try {
    const body = JSON.parse(bodyText)
    detail = String(body?.error?.message ?? body?.error?.detail ?? body?.message ?? '').slice(0, 300)
  } catch {
    detail = bodyText.slice(0, 200).replace(/\s+/g, ' ')
  }
  detail = sanitizeErrorText(detail)
  let base: string
  if (status === 401 || status === 403) {
    base = 'کلید API نامعتبر است یا سرویس‌دهنده دسترسی را نپذیرفت'
  } else if (status === 404) {
    base = 'آدرس اتصال یا مدل در سرویس‌دهنده یافت نشد'
  } else if (status === 429) {
    base = 'محدودیت نرخ یا سهمیه سرویس‌دهنده فعال شد'
  } else if (status >= 500) {
    base = `خطای سمت سرویس‌دهنده (کد ${status})`
  } else {
    base = `درخواست با کد ${status} رد شد`
  }
  return detail ? `${base}: ${detail}` : base
}

export class ProviderError extends Error {
  code: string
  constructor(message: string, code = 'PROVIDER_ERROR') {
    super(message)
    this.code = code
  }
}

const AI_SUBJECT = 'سرویس هوش مصنوعی'

/** تبدیل خطای خام fetch به ProviderError فارسی — AbortError کاربر دست‌نخورده عبور می‌کند */
function wrapFetchError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  if (e instanceof Error && e.name === 'AbortError') return e as unknown as ProviderError
  const msg =
    describeNetworkError(e, AI_SUBJECT) ??
    sanitizeErrorText((e as Error).message || 'خطای شبکه در اتصال به سرویس')
  return new ProviderError(msg, 'PROVIDER_UNREACHABLE')
}

/** ترکیب سیگنال فراخوان با مهلت زمانی */
function combinedSignal(signal: AbortSignal, timeout: number): AbortSignal {
  const t = AbortSignal.timeout(timeout)
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, t])
  // پشتیبان برای محیط‌های بدون AbortSignal.any
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort(signal.reason)
  if (signal.aborted) ctrl.abort(signal.reason)
  else signal.addEventListener('abort', onAbort, { once: true })
  t.addEventListener('abort', () => ctrl.abort(t.reason), { once: true })
  return ctrl.signal
}

function joinUrl(base: string, suffix: string): string {
  const b = base.replace(/\/+$/, '')
  return b.endsWith(suffix) ? b : b + suffix
}

function openAiEndpoint(baseUrl: string): string {
  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  return joinUrl(base, '/chat/completions')
}

function anthropicEndpoint(baseUrl: string): string {
  const base = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
  if (base.endsWith('/v1/messages')) return base
  if (base.endsWith('/v1')) return base + '/messages'
  return base + '/v1/messages'
}

// ─── تبدیل پیام‌های یکسان‌شده به قالب هر ارائه‌دهنده ───

type OpenAiWire = Record<string, unknown>

function toOpenAiMessages(messages: UAMessage[]): OpenAiWire[] {
  return messages.map((m) => {
    if (m.role === 'system') return { role: 'system', content: m.content }
    if (m.role === 'user') return { role: 'user', content: m.content }
    if (m.role === 'tool')
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    return {
      role: 'assistant',
      content: m.text ?? null,
      ...(m.toolCalls.length
        ? {
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.argsJson || '{}' },
            })),
          }
        : {}),
    }
  })
}

interface AnthroBlock {
  type: string
  [k: string]: unknown
}

function toAnthropicBody(messages: UAMessage[], tools: ToolDef[]): Record<string, unknown> {
  const systemParts: string[] = []
  const out: { role: 'user' | 'assistant'; content: string | AnthroBlock[] }[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content)
      continue
    }
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const blocks: AnthroBlock[] = []
      if (m.text) blocks.push({ type: 'text', text: m.text })
      for (const tc of m.toolCalls) {
        let input: unknown = {}
        try {
          input = tc.argsJson ? JSON.parse(tc.argsJson) : {}
        } catch {
          input = {}
        }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
      }
      out.push({ role: 'assistant', content: blocks })
      continue
    }
    // tool → tool_result داخل پیام user
    const block: AnthroBlock = {
      type: 'tool_result',
      tool_use_id: m.toolCallId,
      content: m.content,
    }
    const last = out[out.length - 1]
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      last.content.push(block)
    } else {
      out.push({ role: 'user', content: [block] })
    }
  }
  return {
    max_tokens: 2048,
    ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
    messages: out,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }
      : {}),
    stream: true,
  }
}

// ─── خواندن SSE ───

async function* sseLines(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const line of parts) {
        const l = line.trim()
        if (l.startsWith('data:')) yield l.slice(5).trim()
      }
    }
    if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trim()
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* بی‌اهمیت */
    }
  }
}

async function throwHttpError(res: Response): Promise<never> {
  let bodyText = ''
  try {
    bodyText = await res.text()
  } catch {
    /* خالی */
  }
  throw new ProviderError(describeProviderError(res.status, bodyText))
}

// ─── OpenAI (سازگار) ───

async function streamOpenAi(
  cfg: AiServiceConfig,
  messages: UAMessage[],
  tools: ToolDef[],
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<ProviderTurn> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: toOpenAiMessages(messages),
    stream: true,
    max_tokens: 2048,
  }
  if (tools.length) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
    body.stream_options = { include_usage: true }
  }

  let res: Response
  try {
    res = await fetch(openAiEndpoint(cfg.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: combinedSignal(signal, timeoutMs()),
    })
  } catch (e) {
    throw wrapFetchError(e)
  }
  if (!res.ok || !res.body) {
    // برخی سرویس‌های سازگار stream_options را نمی‌پذیرند — یک بار بدون آن تلاش می‌کنیم
    if (res.status === 400 && tools.length) {
      let retry: Response
      try {
        retry = await fetch(openAiEndpoint(cfg.baseUrl), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...body, stream_options: undefined }),
          signal: combinedSignal(signal, timeoutMs()),
        })
      } catch (e) {
        throw wrapFetchError(e)
      }
      if (!retry.ok || !retry.body) await throwHttpError(retry)
      return consumeOpenAi(retry, signal, onText)
    }
    await throwHttpError(res)
  }
  return consumeOpenAi(res, signal, onText)
}

async function consumeOpenAi(
  res: Response,
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<ProviderTurn> {
  let text = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()
  let usage: ProviderUsage = { inputTokens: null, outputTokens: null }
  try {
    for await (const data of sseLines(res, signal)) {
      if (data === '[DONE]') break
      let chunk: Record<string, unknown>
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.error) {
        const msg = sanitizeErrorText(
          String((chunk.error as Record<string, unknown>)?.message ?? 'خطای سرویس‌دهنده'),
        )
        throw new ProviderError(msg)
      }
      const usage0 = chunk.usage as Record<string, number> | undefined
      if (usage0) {
        usage = {
          inputTokens: usage0.prompt_tokens ?? usage.inputTokens,
          outputTokens: usage0.completion_tokens ?? usage.outputTokens,
        }
      }
      const choices = chunk.choices as Record<string, unknown>[] | undefined
      const c0 = choices?.[0]
      if (!c0) continue
      const delta = c0.delta as Record<string, unknown> | undefined
      if (delta) {
        const content = delta.content
        if (typeof content === 'string' && content) {
          text += content
          onText(content)
        }
        const tcs = delta.tool_calls as Record<string, unknown>[] | undefined
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const idx = Number(tc.index ?? 0)
            const cur = calls.get(idx) ?? { id: '', name: '', args: '' }
            if (typeof tc.id === 'string' && tc.id) cur.id = tc.id
            const fn = tc.function as Record<string, unknown> | undefined
            if (fn) {
              if (typeof fn.name === 'string' && fn.name) cur.name += fn.name
              if (typeof fn.arguments === 'string') cur.args += fn.arguments
            }
            calls.set(idx, cur)
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    throw wrapFetchError(e)
  }
  const toolCalls: ToolCallOut[] = [...calls.values()]
    .filter((c) => c.name)
    .map((c, i) => ({
      id: c.id || `call_${Date.now()}_${i}`,
      name: c.name,
      argsJson: c.args || '{}',
    }))
  return { text: text || null, toolCalls, usage }
}

// ─── Anthropic ───

async function streamAnthropic(
  cfg: AiServiceConfig,
  messages: UAMessage[],
  tools: ToolDef[],
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<ProviderTurn> {
  const body = toAnthropicBody(messages, tools)
  body.model = cfg.model
  let res: Response
  try {
    res = await fetch(anthropicEndpoint(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: combinedSignal(signal, timeoutMs()),
    })
  } catch (e) {
    throw wrapFetchError(e)
  }
  if (!res.ok || !res.body) await throwHttpError(res)

  let text = ''
  let usage: ProviderUsage = { inputTokens: null, outputTokens: null }
  const calls: ToolCallOut[] = []
  let current: { id: string; name: string; args: string } | null = null
  try {
    for await (const data of sseLines(res, signal)) {
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(data)
      } catch {
        continue
      }
      const type = ev.type as string
      if (type === 'message_start') {
        const u = (ev.message as Record<string, unknown>)?.usage as Record<string, number> | undefined
        if (u) usage = { inputTokens: u.input_tokens ?? null, outputTokens: null }
      } else if (type === 'content_block_start') {
        const cb = ev.content_block as Record<string, unknown>
        if (cb?.type === 'tool_use') {
          current = {
            id: String(cb.id ?? `toolu_${Date.now()}_${calls.length}`),
            name: String(cb.name ?? ''),
            args: '',
          }
        }
      } else if (type === 'content_block_delta') {
        const d = ev.delta as Record<string, unknown>
        if (d?.type === 'text_delta' && typeof d.text === 'string' && d.text) {
          text += d.text
          onText(d.text)
        } else if (d?.type === 'input_json_delta' && typeof d.partial_json === 'string') {
          if (current) current.args += d.partial_json
        }
      } else if (type === 'content_block_stop') {
        if (current && current.name) {
          calls.push({
            id: current.id,
            name: current.name,
            argsJson: current.args || '{}',
          })
        }
        current = null
      } else if (type === 'message_delta') {
        const u = ev.usage as Record<string, number> | undefined
        if (u) usage = { ...usage, outputTokens: u.output_tokens ?? usage.outputTokens }
      } else if (type === 'error') {
        const err = ev.error as Record<string, unknown> | undefined
        throw new ProviderError(
          sanitizeErrorText(String(err?.message ?? 'خطای سرویس‌دهنده')),
        )
      }
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    throw wrapFetchError(e)
  }
  return { text: text || null, toolCalls: calls, usage }
}

/** یک نوبت کامل گفتگو با سرویس هوش مصنوعی — با پشتیبانی streaming و ابزارها */
export async function streamProviderTurn(opts: {
  cfg: AiServiceConfig
  messages: UAMessage[]
  tools: ToolDef[]
  signal: AbortSignal
  onText?: (delta: string) => void
}): Promise<ProviderTurn> {
  const { cfg, messages, tools, signal } = opts
  const onText = opts.onText ?? (() => {})
  if (!cfg.model || !cfg.apiKey) {
    throw new ProviderError('سرویس هوش مصنوعی پیکربندی نشده است', 'CONFIG_MISSING')
  }
  if (cfg.provider === 'anthropic') {
    return streamAnthropic(cfg, messages, tools, signal, onText)
  }
  return streamOpenAi(cfg, messages, tools, signal, onText)
}

/** آزمایش واقعی اتصال — یک درخواست کوتاه واقعی به سرویس تنظیم‌شده */
export async function testConnection(cfg: AiServiceConfig): Promise<{
  ok: boolean
  latencyMs?: number
  reply?: string
  error?: string
}> {
  const t0 = Date.now()
  try {
    const turn = await streamProviderTurn({
      cfg,
      messages: [
        { role: 'system', content: 'فقط عبارت خواسته‌شده را بازگردان.' },
        { role: 'user', content: 'فقط بنویس: اتصال برقرار است' },
      ],
      tools: [],
      signal: AbortSignal.timeout(45000),
    })
    return {
      ok: true,
      latencyMs: Date.now() - t0,
      reply: (turn.text ?? '').trim().slice(0, 300) || '(پاسخ خالی)',
    }
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') {
      return { ok: false, latencyMs: Date.now() - t0, error: 'تلاش برای آزمایش اتصال لغو شد' }
    }
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: sanitizeErrorText(describeNetworkError(e, AI_SUBJECT) ?? err.message ?? 'خطای نامشخص'),
    }
  }
}
