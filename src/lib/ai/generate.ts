/**
 * موتور تولید پاسخ دستیار — مشترک بین ارسال پیام و تلاش مجدد.
 * جریان SSE به کلاینت: status / tool / delta / done / error
 * ذخیره‌سازی: پیام کاربر قبلاً ذخیره شده؛ پاسخ دستیار فقط در موفقیت
 * (یا توقف با متن نیمه‌کاره) ثبت می‌شود — خطا هرگز پیام ساختگی ثبت نمی‌کند.
 */

import { db } from '@/lib/db'
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { runAssistantAgent, type AgentEvent } from './agent'
import { acquireConversationLock, releaseConversationLock, logAiUsage, type AiSettings } from './access'

export interface GenerateArgs {
  req: NextRequest
  conversationId: number
  userId: string
  schoolId: string
  cfg: AiSettings
}

export function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  }
}

export async function generateAssistantResponse(args: GenerateArgs): Promise<Response> {
  const { req, conversationId, userId, schoolId, cfg } = args

  if (!acquireConversationLock(conversationId)) {
    return new Response(
      JSON.stringify({ error: 'پاسخ قبلی این گفتگو هنوز در حال تولید است', code: 'BUSY' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const encoder = new TextEncoder()
  const t0 = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let finished = false
      const emit = (e: AgentEvent | Record<string, unknown>) => {
        if (!finished) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
          } catch {
            /* کلاینت رفته است */
          }
        }
      }

      try {
        const [conversation, school, historyRaw] = await Promise.all([
          db.aiConversation.findUnique({ where: { id: conversationId }, select: { id: true } }),
          db.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
          db.aiMessage.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' },
            select: { role: true, content: true },
            take: 40,
          }),
        ])
        if (!conversation) throw new Error('گفتگو یافت نشد')

        const last = historyRaw[historyRaw.length - 1]
        if (!last || last.role !== 'USER') throw new Error('پیام کاربر برای تولید پاسخ یافت نشد')
        const userText = last.content
        const history = historyRaw.slice(0, -1).map((m) => ({ role: m.role as 'USER' | 'ASSISTANT', content: m.content }))

        // کلاینت با بستن درخواست، تولید را متوقف می‌کند
        const signal = req.signal
        const agent = await runAssistantAgent({
          schoolId,
          schoolName: school?.name ?? 'مدرسه شما',
          userId,
          cfg,
          history,
          userText,
          signal,
          emit: emit as (e: AgentEvent) => void,
        })

        const latencyMs = Date.now() - t0

        if (agent.error) {
          // خطا: هیچ پیام دستیار ثبت نمی‌شود؛ پیام کاربر می‌ماند تا تلاش مجدد
          await logAiUsage({
            userId,
            schoolId,
            ok: false,
            errorType: agent.error.code,
            provider: cfg.provider,
            model: cfg.model,
            latencyMs,
          })
          emit({ t: 'error', code: agent.error.code, message: agent.error.message })
        } else {
          // موفق یا توقف توسط کاربر
          let savedId: number | null = null
          if (agent.text.trim().length > 0) {
            const saved = await db.aiMessage.create({
              data: {
                conversationId,
                role: 'ASSISTANT',
                content: agent.text,
                refs: agent.refs as unknown as Prisma.InputJsonValue,
                stopped: agent.stopped,
              },
              select: { id: true },
            })
            savedId = saved.id
            await db.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
          }
          await logAiUsage({
            userId,
            schoolId,
            ok: true,
            errorType: agent.stopped ? 'ABORTED' : null,
            provider: cfg.provider,
            model: cfg.model,
            inputTokens: agent.usage.inputTokens,
            outputTokens: agent.usage.outputTokens,
            latencyMs,
          })
          emit({
            t: 'done',
            messageId: savedId,
            refs: agent.refs,
            stopped: agent.stopped,
            empty: agent.text.trim().length === 0,
            latencyMs,
          })
        }
      } catch (e) {
        const message = (e as Error).message || 'خطای غیرمنتظره'
        await logAiUsage({
          userId,
          schoolId,
          ok: false,
          errorType: 'PROVIDER_ERROR',
          provider: cfg.provider,
          model: cfg.model,
          latencyMs: Date.now() - t0,
        })
        emit({ t: 'error', code: 'PROVIDER_ERROR', message })
      } finally {
        finished = true
        releaseConversationLock(conversationId)
        try {
          controller.close()
        } catch {
          /* بسته شده */
        }
      }
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}
