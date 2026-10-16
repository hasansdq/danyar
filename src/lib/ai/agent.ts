/**
 * عامل دستیار — ساخت پرامپت، حلقه ابزار با مجوز سمت سرور، جریان رویداد SSE
 * و ثبت منابع داده واقعی استفاده‌شده در پاسخ (refs).
 */

import { streamProviderTurn, ProviderError, type UAMessage, type ProviderUsage } from './provider'
import { AI_TOOLS, executeAiTool, TOOL_STATUS_LABEL, type AiRef } from './tools'
import type { AiSettings } from './access'

export type AgentEvent =
  | { t: 'status'; text: string }
  | { t: 'tool'; label: string }
  | { t: 'delta'; text: string }
  | { t: 'done'; refs: AiRef[]; stopped: boolean; text: string }
  | { t: 'error'; code: string; message: string }

export interface AgentOutcome {
  text: string
  refs: AiRef[]
  stopped: boolean
  usage: ProviderUsage
  toolCalls: number
  error: { code: string; message: string } | null
}

function faToday(): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function buildSystemPrompt(cfg: AiSettings, schoolName: string): string {
  const parts: string[] = [
    `تو «دستیار دانیار» هستی؛ دستیار هوش مصنوعی پیام‌رسان آموزشی دانیار و کمک‌کار مدیر مدرسه. نام مدرسه این مدیر «${schoolName}» است و امروز ${faToday()} است.`,
    '',
    'کاربردهای تو: پیگیری امور آموزشی مدرسه، خلاصه‌سازی وضعیت ارسال تکالیف و بازخوردها، مدیریت کامل تقویم آموزشی (ثبت، ویرایش و حذف رویدادها و ارائه آمار تقویم)، دسترسی به اطلاعات کاربران مدرسه (دانش‌آموزان و معلمان)، اطلاع از نمونه‌سؤال‌های منتشرشده، تهیه پیش‌نویس اطلاعیه و گزارش مدیریتی، و اطلاع‌رسانی درباره دانش‌آموزان مدرسه.',
    '',
    'قواعد الزامی:',
    '۱) برای هر اطلاعات واقعی مدرسه (تکالیف، کلاس‌ها، گروه‌ها، دانش‌آموزان، معلمان، نمونه‌سؤال‌ها، رویدادهای تقویم، آمار ارسال و بازخورد) حتماً از ابزارهای در اختیار استفاده کن و هرگز چنین داده‌ای را از حافظه خود نساز.',
    '۲) اطلاعات ناموجود را حدس نزن. اگر ابزار داده‌ای برنگرداند یا خطا داد، صریح بگو که اطلاعات در دسترس نیست.',
    '۳) هر جا از داده برنامه استفاده می‌کنی، در پاسخ صریح ذکر کن بر اساس کدام تکلیف، کلاس، گروه، رویداد یا بازخورد است (نام آن‌ها را بیاور).',
    '۴) پاسخ همیشه فارسی، روان و منظم بنویس؛ برای فهرست‌ها از لیست مارک‌دار و برای گزارش‌ها از سرفصل استفاده کن. پاسخ طولانی و کامل اشکالی ندارد.',
    '۵) فقط به امور مدرسه و امور مدیریتی آموزشی کمک کن؛ درخواست‌های نامرتبط را مؤدبانه رد کن.',
    '۶) اطلاعات محرمانه (نمره و بازخورد دانش‌آموزان) را فقط برای مدیر مدرسه همان مدرسه — یعنی همین کاربر — خلاصه کن و در پیش‌نویس‌هایی که برای انتشار عمومی آماده می‌کنی نمرات و جزئیات خصوصی دانش‌آموزان را نیاور.',
    '۷) تاریخچه این گفتگو خصوصی همین کاربر است؛ درباره کاربران یا مدارس دیگر اطلاعاتی نداری و نباید ادعا کنی.',
    '۸) در مدیریت تقویم آموزشی: همه تاریخ‌ها شمسی (جلالی) است. پیش از ثبت رویداد، نوع، تاریخ دقیق جلالی و کلاس مقصد را روشن کن؛ اگر کاربر تاریخ مبهمی گفت (مثل «هفته بعد») اول تاریخ دقیق را بپرس. انواع رویداد: تعطیل، امتحان، تکلیف، جشن، ورزشی، علمی، اردو، سفارشی. رویداد «تعطیل» و رویداد «کل مدرسه» در اختیار مدیر مدرسه است؛ رویداد نوع «تکلیف» که ثبت می‌کنی فقط رویداد ساده تقویم است و تکلیف درسی واقعی (با مهلت و پاسخ) را معلمان از درون تقویم ثبت می‌کنند — این نکته را در پاسخ روشن کن. پس از هر ثبت/ویرایش/حذف، نتیجه را با نام رویداد، نوع و تاریخ جلالی صریح اعلام کن. برای آمار تقویم (تعداد رویدادها به تفکیک نوع و کلاس و رویدادهای پیش‌رو) از ابزار آمار استفاده کن و اعداد را دقیق گزارش بده.',
    '۹) در تهیه پیش‌نویس اطلاعیه: با ابزار draft_announcement ساختار پایه (نام مدرسه، تاریخ جلالی، مخاطب، نکات) را بساز و در پاسخ، پیش‌نویس آمادهٔ کپی را در بلوک نقل‌قول یا متن مرتب ارائه کن. اگر مدیر اطلاعات کافی داد (موضوع، مخاطب، نکات) و برای غنی‌ترشدن متن به داده واقعی مدرسه نیاز داری (مثل رویدادهای پیش‌رو)، اول ابزار مربوط را صدا بزن. همیشه صریح بگو که این فقط پیش‌نویس است و ارسال نهایی از صفحه «اطلاعیه‌ها» در پنل مدیریت انجام می‌شود؛ هرگز ادعا نکن که اطلاعیه‌ای را ارسال کرده‌ای. در پیش‌نویس‌ها نمره و اطلاعات خصوصی دانش‌آموزان نیاور.',
  ]
  if (cfg.generalInstruction.trim()) {
    parts.push('', 'دستورالعمل عمومی مدیر کل پلتفرم:', cfg.generalInstruction.trim())
  }
  if (cfg.managerInstruction.trim()) {
    parts.push('', 'دستورالعمل مخصوص نقش مدیر مدرسه:', cfg.managerInstruction.trim())
  }
  return parts.join('\n')
}

function dedupeRefs(refs: AiRef[]): AiRef[] {
  const map = new Map<string, AiRef>()
  for (const r of refs) map.set(`${r.kind}:${r.id}`, r)
  return [...map.values()]
}

export interface RunAgentOptions {
  schoolId: string
  schoolName: string
  /** کاربر در حال گفتگو (مدیر مدرسه) — برای ثبت createdById رویدادهای تقویم */
  userId: string
  cfg: AiSettings
  history: { role: 'USER' | 'ASSISTANT'; content: string }[]
  userText: string
  signal: AbortSignal
  emit: (e: AgentEvent) => void
}

/**
 * اجرای کامل یک نوبت: ممکن است چند بار ابزار صدا بزند و در پایان متن نهایی
 * را جریان‌شده تحویل دهد. توقف (abort) و خطا هر دو به‌صورت ساخت‌یافته برمی‌گردند.
 */
export async function runAssistantAgent(opts: RunAgentOptions): Promise<AgentOutcome> {
  const { schoolId, schoolName, userId, cfg, history, userText, signal, emit } = opts

  const messages: UAMessage[] = [
    { role: 'system', content: buildSystemPrompt(cfg, schoolName) },
    ...history.slice(-20).map((m): UAMessage =>
      m.role === 'USER'
        ? { role: 'user', content: m.content }
        : { role: 'assistant', text: m.content, toolCalls: [] },
    ),
    { role: 'user', content: userText },
  ]

  const refs: AiRef[] = []
  const usage: ProviderUsage = { inputTokens: null, outputTokens: null }
  let fullText = ''
  let toolCallsCount = 0
  let stopped = false
  let error: { code: string; message: string } | null = null

  const maxRounds = Math.max(cfg.maxToolCalls, 0)

  try {
    let round = 0
    while (true) {
      const withTools = round < maxRounds
      emit({ t: 'status', text: 'در حال تولید پاسخ…' })
      const turn = await streamProviderTurn({
        cfg,
        messages,
        tools: withTools ? AI_TOOLS : [],
        signal,
        onText: (d) => {
          fullText += d
          emit({ t: 'delta', text: d })
        },
      })
      usage.inputTokens = turn.usage.inputTokens ?? usage.inputTokens
      usage.outputTokens = turn.usage.outputTokens ?? usage.outputTokens

      // بدون فراخوانی ابزار → پاسخ نهایی
      if (turn.toolCalls.length === 0) break
      // به سقف دورها رسیده‌ایم؛ دور بعد بدون ابزار برای بستن پاسخ
      if (!withTools) break

      // اجرای ابزارها با مجوز سمت سرور
      messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls })
      for (const call of turn.toolCalls) {
        toolCallsCount++
        emit({ t: 'tool', label: TOOL_STATUS_LABEL[call.name] ?? 'در حال بررسی اطلاعات…' })
        const exec = await executeAiTool(call.name, call.argsJson, { schoolId, userId })
        refs.push(...exec.refs)
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: exec.result })
      }
      round++
    }
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError' || signal.aborted) {
      stopped = true
    } else {
      const code = e instanceof ProviderError ? e.code : 'PROVIDER_ERROR'
      error = { code, message: err.message || 'خطای غیرمنتظره در سرویس هوش مصنوعی' }
    }
  }

  if (stopped) {
    emit({ t: 'done', refs: dedupeRefs(refs), stopped: true, text: fullText })
  } else if (error) {
    emit({ t: 'error', code: error.code, message: error.message })
  } else {
    emit({ t: 'done', refs: dedupeRefs(refs), stopped: false, text: fullText })
  }

  return {
    text: fullText,
    refs: dedupeRefs(refs),
    stopped,
    usage,
    toolCalls: toolCallsCount,
    error,
  }
}
