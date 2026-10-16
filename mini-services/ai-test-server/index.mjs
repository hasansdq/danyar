/**
 * سرور آزمون دستیار — سازگار با پروتکل OpenAI و Anthropic (پورت 3055)
 *
 * این سرور «زیرساخت آزمون» است، نه بخشی از محصول:
 * - تصمیم فراخوانی ابزار به‌صورت قطعی (تست خط لوله ابزار)
 * - متن نهایی پاسخ‌ها با مدل زبانی واقعی محیط (z-ai-web-dev-sdk) تولید می‌شود
 * - هر دو قالب streaming OpenAI SSE و Anthropic SSE پیاده‌سازی شده تا
 *   لایه ارائه‌دهنده برنامه واقعاً از هر دو مسیر آزموده شود
 */

import ZAI from 'z-ai-web-dev-sdk'

const PORT = 3055

function log(...a) {
  console.log(`[ai-test-server ${new Date().toISOString().slice(11, 19)}]`, ...a)
}

let zaiPromise = null
async function getZai() {
  if (!zaiPromise) zaiPromise = ZAI.create()
  return zaiPromise
}

async function llmText(system, user) {
  const zai = await getZai()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: system },
      { role: 'user', content: user },
    ],
    thinking: { type: 'disabled' },
  })
  return completion?.choices?.[0]?.message?.content ?? ''
}

// ─── استخراج ساختار مشترک از هر دو پروتکل ───

function extract(messages, tools) {
  let system = ''
  let lastUser = ''
  const toolResults = []
  const toolNames = new Set()
  let hasAssistantToolCall = false

  for (const m of messages) {
    const role = m.role
    if (role === 'system') {
      system += (system ? '\n\n' : '') + String(m.content ?? '')
    } else if (role === 'user') {
      const content = typeof m.content === 'string' ? m.content : Array.isArray(m.content)
        ? m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        : ''
      if (content) lastUser = content
      // tool_result های Anthropic داخل پیام user
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === 'tool_result') {
            toolResults.push({ name: b.name ?? 'unknown', content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) })
          }
        }
      }
    } else if (role === 'assistant') {
      if (Array.isArray(m.content)) {
        for (const b of m.content) if (b.type === 'tool_use') { hasAssistantToolCall = true; toolNames.add(b.name) }
        const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        if (text) lastUser = lastUser // حفظ آخرین user
      } else if (Array.isArray(m.tool_calls)) {
        hasAssistantToolCall = true
        for (const tc of m.tool_calls) toolNames.add(tc.function?.name ?? '')
      }
    } else if (role === 'tool') {
      toolResults.push({ name: m.name ?? 'unknown', content: String(m.content ?? '') })
    }
  }

  return { system, lastUser, toolResults, tools: tools ?? [], hasAssistantToolCall }
}

function pickTool(lastUser) {
  const t = lastUser || ''
  const has = (...words) => words.some((w) => t.includes(w))
  // ابزارهای جدیدتر — پیش از قواعد عمومی
  if (has('پیش‌نویس', 'پیشنویس') && has('اطلاعیه')) return 'draft_announcement'
  if (has('نمونه‌سؤال', 'نمونه سؤال', 'نمونه‌سوال', 'نمونه سوال')) return 'list_sample_questions'
  if (has('معلم')) {
    if (has('اطلاعات', 'جزئیات', 'پروفایل')) return 'teacher_detail'
    return 'list_teachers'
  }
  if (has('دانش‌آموز', 'دانش آموز')) {
    if (has('اطلاعات', 'وضعیت', 'جزئیات', 'پروفایل')) return 'student_detail'
    return 'list_students'
  }
  if (has('تکلیف', 'تکالیف', 'بازخورد', 'نمره')) return 'assignment_status'
  if (has('کلاس', 'گروه درسی')) return 'list_classes'
  if (has('گزارش', 'خلاصه', 'نمای کلی', 'وضعیت مدرسه', 'مدیریتی', 'اطلاعیه')) return 'school_overview'
  return 'school_overview'
}

function approxTokens(s) {
  return Math.max(1, Math.ceil((s || '').length / 4))
}

// ─── نتیجه نوبت: یا tool_call یا متن نهایی ───

async function resolveTurn({ system, lastUser, toolResults, tools }) {
  // مرحله ۱: ابزار خواسته شده و هنوز نتیجه‌ای نیامده → فراخوانی ابزار
  if (tools.length > 0 && toolResults.length === 0) {
    const name = pickTool(lastUser)
    // آرگومان‌ها: student_detail به studentId نیاز دارد — در آزمون به list_students برگرد
    let args = {}
    if (name === 'draft_announcement') {
      args = {
        topic: (lastUser || 'اطلاعیه مدرسه').slice(0, 120),
        keyPoints: [],
        tone: 'رسمی',
      }
    }
    return { kind: 'tool_calls', name, args, preamble: '' }
  }

  // مرحله ۲: نتیجه ابزار هست → پاسخ نهایی واقعی با مدل
  const toolText = toolResults
    .map((r) => `«${r.name}»:\n${r.content}`)
    .join('\n\n')
  const sys = (system || 'دستیار آموزشی فارسی هستی.') +
    '\nفقط بر اساس داده‌های واقعی برنامه پاسخ بده؛ از ساخت داده غیرواقعی خودداری کن. نام تکالیف/کلاس‌ها/بازخوردهای استفاده‌شده را صریح ذکر کن. پاسخ منظم فارسی با فهرست بده.'
  const user = `درخواست مدیر مدرسه: ${lastUser || '(بدون متن)'}\n\nداده‌های واقعی به‌دست‌آمده از ابزارهای برنامه:\n${toolText}`
  const text = await llmText(sys, user)
  return { kind: 'text', text: text.trim() || 'پاسخی تولید نشد.' }
}

// ─── SSE کمکی ───

function sseW(writer, chunk) {
  writer.write(`data: ${JSON.stringify(chunk)}\n\n`)
}

// ─── مسیرها ───

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'daniar-ai-test-server' })
    }

    // ── OpenAI-compatible ──
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = await req.json().catch(() => null)
      if (!body) return Response.json({ error: { message: 'invalid body' } }, { status: 400 })
      const model = String(body.model ?? 'daniar-test-model')
      const id = `chatcmpl-test-${Date.now()}`
      const ex = extract(body.messages ?? [], body.tools)
      log(`openai: tools=${ex.tools.length} toolResults=${ex.toolResults.length} q="${(ex.lastUser || '').slice(0, 50)}"`)

      const turn = await resolveTurn(ex).catch((e) => ({ kind: 'error', error: String(e?.message ?? e) }))
      if (turn.kind === 'error') {
        return Response.json({ error: { message: turn.error } }, { status: 500 })
      }

      if (body.stream) {
        return new Response(
          new ReadableStream({
            async start(controller) {
              const writer = { write: (s) => controller.enqueue(new TextEncoder().encode(s)) }
              await emitOpenAi(writer, id, model, turn)
              controller.close()
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' } },
        )
      }

      if (turn.kind === 'tool_calls') {
        return Response.json({
          id,
          object: 'chat.completion',
          model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: null, tool_calls: [{ id: `call_${Date.now()}`, type: 'function', function: { name: turn.name, arguments: JSON.stringify(turn.args) } }] },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 50, completion_tokens: 20 },
        })
      }
      return Response.json({
        id,
        object: 'chat.completion',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: turn.text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: approxTokens(turn.text) + 50, completion_tokens: approxTokens(turn.text) },
      })
    }

    // ── Anthropic-compatible ──
    if (url.pathname === '/v1/messages' && req.method === 'POST') {
      const body = await req.json().catch(() => null)
      if (!body) return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'invalid body' } }, { status: 400 })
      const model = String(body.model ?? 'daniar-test-model')
      const id = `msg-test-${Date.now()}`
      const messages = (body.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        // نگاشت نام ابزار برای tool_result های anthropic
      }))
      // نام ابزار هر tool_result را از tool_use قبلی پیدا می‌کنیم
      const toolUseNames = new Map()
      for (const m of messages) {
        if (Array.isArray(m.content)) {
          for (const b of m.content) if (b.type === 'tool_use') toolUseNames.set(b.id, b.name)
        }
      }
      for (const m of messages) {
        if (Array.isArray(m.content)) {
          for (const b of m.content) if (b.type === 'tool_result') b.name = toolUseNames.get(b.tool_use_id) ?? 'unknown'
        }
      }
      const ex = extract(messages, body.tools)
      ex.system = String(body.system ?? '') + (ex.system ? '\n\n' + ex.system : '')
      log(`anthropic: tools=${ex.tools.length} toolResults=${ex.toolResults.length} q="${(ex.lastUser || '').slice(0, 50)}"`)

      const turn = await resolveTurn(ex).catch((e) => ({ kind: 'error', error: String(e?.message ?? e) }))
      if (turn.kind === 'error') {
        return Response.json({ type: 'error', error: { type: 'api_error', message: turn.error } }, { status: 500 })
      }

      if (body.stream) {
        return new Response(
          new ReadableStream({
            async start(controller) {
              const writer = { write: (s) => controller.enqueue(new TextEncoder().encode(s)) }
              await emitAnthropic(writer, id, model, turn)
              controller.close()
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' } },
        )
      }

      if (turn.kind === 'tool_calls') {
        return Response.json({
          id,
          type: 'message',
          model,
          content: [{ type: 'tool_use', id: `toolu_${Date.now()}`, name: turn.name, input: turn.args }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 40, output_tokens: 20 },
        })
      }
      return Response.json({
        id,
        type: 'message',
        model,
        content: [{ type: 'text', text: turn.text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: approxTokens(turn.text) + 40, output_tokens: approxTokens(turn.text) },
      })
    }

    return Response.json({ error: 'not found' }, { status: 404 })
  },
})

async function emitOpenAi(writer, id, model, turn) {
  if (turn.kind === 'tool_calls') {
    streamToolCallWriter(writer, true, id, model, `call_${Date.now()}`, turn.name, JSON.stringify(turn.args), turn.preamble ?? '')
  } else {
    await streamTextChunksWriter(writer, true, id, model, turn.text)
  }
}

async function emitAnthropic(writer, id, model, turn) {
  if (turn.kind === 'tool_calls') {
    streamToolCallWriter(writer, false, id, model, `toolu_${Date.now()}`, turn.name, JSON.stringify(turn.args), '')
  } else {
    await streamTextChunksWriter(writer, false, id, model, turn.text)
  }
}

function sseW(writer, chunk) {
  writer.write(`data: ${JSON.stringify(chunk)}\n\n`)
}

async function streamTextChunksWriter(writer, openaiStyle, id, model, text) {
  const pieces = text.match(/[\s\S]{1,60}/g) ?? []
  if (openaiStyle) {
    writer.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] })}\n\n`)
    for (const p of pieces) {
      sseW(writer, { id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: p } }] })
      await new Promise((r) => setTimeout(r, 12))
    }
    writer.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: approxTokens(text) + 50, completion_tokens: approxTokens(text) } })}\n\n`)
    writer.write('data: [DONE]\n\n')
  } else {
    writer.write(`data: ${JSON.stringify({ type: 'message_start', message: { id, model, usage: { input_tokens: approxTokens(text) + 40 } } })}\n\n`)
    writer.write(`data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`)
    for (const p of pieces) {
      writer.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })}\n\n`)
      await new Promise((r) => setTimeout(r, 12))
    }
    writer.write(`data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`)
    writer.write(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: approxTokens(text) } })}\n\n`)
    writer.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
  }
}

function streamToolCallWriter(writer, openaiStyle, id, model, callId, name, argsJson, preamble) {
  if (openaiStyle) {
    if (preamble) writer.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: preamble } }] })}\n\n`)
    writer.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name, arguments: argsJson } }] } }] })}\n\n`)
    writer.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`)
    writer.write('data: [DONE]\n\n')
  } else {
    writer.write(`data: ${JSON.stringify({ type: 'message_start', message: { id, model, usage: { input_tokens: 40 } } })}\n\n`)
    writer.write(`data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: callId, name } })}\n\n`)
    writer.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: argsJson } })}\n\n`)
    writer.write(`data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`)
    writer.write(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } })}\n\n`)
    writer.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
  }
}

log(`آماده روی http://127.0.0.1:${PORT} (OpenAI: /v1/chat/completions — Anthropic: /v1/messages)`)
