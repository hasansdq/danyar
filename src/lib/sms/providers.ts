import { maskPhone } from '@/lib/phone'
import { describeNetworkError } from '@/lib/net-errors'

/**
 * اتصال واقعی به سرویس‌های پیامکی — هر سرویس مطابق مستندات خودش.
 * - sms.ir: متد «ارسال کد تایید» (send/verify) با هدر x-api-key و قالب TemplateId
 * - ملی پیامک: سرویس OTP پنل پیامک (rest.payamak-panel.com/api/SendOTP/SendOTP)
 * - فراز اس‌ام‌اس: ارسال با قالب (Pattern) از api2.ippanel.com با هدر apikey
 * - OTPy: مستندات رسمی این سرویس در دسترس این پیاده‌سازی نبود؛ به‌جای اتصال ساختگی،
 *   حالت «REST سازگار» ارائه شده است که مدیر کل آدرس، هدر و بدنه را طبق مستندات
 *   خود OTPy وارد می‌کند و درخواست واقعاً به همان آدرس ارسال می‌شود.
 *
 * هیچ خطایی شامل کلید محرمانه نمی‌شود؛ گزارش‌ها شماره کامل یا کد ورود ندارند.
 */

export type SmsCredentials = Record<string, string>

export interface SmsSendResult {
  ok: boolean
  /** خطای قابل نمایش به مدیر کل — بدون کلید و بدون شماره کامل */
  error?: string
}

const TIMEOUT_MS = 12_000

/** حذف مقادیر محرمانه از متن خطا */
function sanitize(text: string, secrets: SmsCredentials): string {
  let out = String(text ?? '')
  for (const v of Object.values(secrets)) {
    if (v && v.length >= 4) {
      out = out.split(v).join('***')
    }
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
  out = out.replace(/[A-Za-z0-9_-]{24,}/g, (m) => (m.includes('***') ? m : '***'))
  return out.slice(0, 300)
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  secrets: SmsCredentials,
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text().catch(() => '')
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    json = null
  }
  return { status: res.status, json, text }
}

function err(prefix: string, detail: string): SmsSendResult {
  return { ok: false, error: `${prefix}: ${detail}` }
}

/** خطای شبکه‌ای سطح پایین را به پیام فارسی روشن ترجمه می‌کند؛ برچسب سرویس حفظ می‌شود */
function netErr(prefix: string, e: unknown, secrets: SmsCredentials): SmsSendResult {
  const mapped = describeNetworkError(e, 'سرویس پیامکی')
  if (mapped) return err(prefix, mapped)
  return err(prefix, sanitize(e instanceof Error ? e.message : 'خطای اتصال', secrets))
}

// ─── sms.ir ───
async function sendSmsIr(c: SmsCredentials, phone: string, code: string): Promise<SmsSendResult> {
  if (!c.apiKey) return err('sms.ir', 'کلید API تنظیم نشده است')
  if (!c.templateId) return err('sms.ir', 'شناسه قالب (TemplateId) تنظیم نشده است')
  const base = (c.baseUrl || 'https://api.sms.ir/v1').replace(/\/+$/, '')
  try {
    const r = await postJson(
      `${base}/send/verify`,
      { 'x-api-key': c.apiKey },
      {
        mobile: phone,
        templateId: Number(c.templateId),
        parameters: [{ name: c.codeParam || 'CODE', value: code }],
      },
      c,
    )
    if (r.status === 200 && r.json && Number(r.json.status) === 1) return { ok: true }
    const msg =
      (r.json && typeof r.json.message === 'string' && r.json.message) ||
      `پاسخ HTTP ${r.status}`
    return err('sms.ir', sanitize(msg, c))
  } catch (e) {
    return netErr('sms.ir', e, c)
  }
}

// ─── ملی پیامک ───
async function sendMelipayamak(c: SmsCredentials, phone: string, code: string): Promise<SmsSendResult> {
  if (!c.username || !c.password) return err('ملی پیامک', 'نام کاربری/رمز پنل تنظیم نشده است')
  if (!c.from) return err('ملی پیامک', 'شماره خط خدماتی (from) تنظیم نشده است')
  const base = (c.baseUrl || 'https://rest.payamak-panel.com/api/SendOTP').replace(/\/+$/, '')
  const text = (c.textTemplate || 'کد ورود دانیار: {CODE}').replace('{CODE}', code)
  try {
    const r = await postJson(
      `${base}/SendOTP`,
      {},
      { username: c.username, password: c.password, to: phone, from: c.from, text },
      c,
    )
    const ret = r.json ? Number(r.json.RetStatus) : NaN
    if (r.status === 200 && ret === 1) return { ok: true }
    const statusName = r.json && typeof r.json.StrRetStatus === 'string' ? r.json.StrRetStatus : ''
    return err('ملی پیامک', sanitize(`پاسخ HTTP ${r.status}${statusName ? ` — ${statusName}` : ''}`, c))
  } catch (e) {
    return netErr('ملی پیامک', e, c)
  }
}

// ─── فراز اس‌ام‌اس (ippanel pattern) ───
async function sendFarazSms(c: SmsCredentials, phone: string, code: string): Promise<SmsSendResult> {
  if (!c.apiKey) return err('فراز اس‌ام‌اس', 'کلید API تنظیم نشده است')
  if (!c.patternCode) return err('فراز اس‌ام‌اس', 'کد قالب (Pattern) تنظیم نشده است')
  if (!c.sender) return err('فراز اس‌ام‌اس', 'شماره فرستنده تنظیم نشده است')
  const base = (c.baseUrl || 'https://api2.ippanel.com/api/v1/sms/pattern/normal').replace(/\/+$/, '')
  try {
    const r = await postJson(
      `${base}/send`,
      { apikey: c.apiKey },
      {
        code: c.patternCode,
        sender: c.sender.startsWith('+') ? c.sender : `+${c.sender}`,
        recipient: phone,
        variable: { [c.varName || 'code']: code },
      },
      c,
    )
    const bodyCode = r.json && r.json.code !== undefined ? Number(r.json.code) : undefined
    const metaStatus = (r.json as { meta?: { status?: unknown } } | null)?.meta?.status
    if (r.status === 200 && (bodyCode === 200 || bodyCode === undefined) && metaStatus !== false) {
      return { ok: true }
    }
    const msg =
      (r.json && typeof r.json.message === 'string' && r.json.message) ||
      `پاسخ HTTP ${r.status}`
    return err('فراز اس‌ام‌اس', sanitize(msg, c))
  } catch (e) {
    return netErr('فراز اس‌ام‌اس', e, c)
  }
}

// ─── OTPy (REST سازگار — آدرس و بدنه طبق مستندات سرویس‌دهنده) ───
async function sendOtpy(c: SmsCredentials, phone: string, code: string): Promise<SmsSendResult> {
  if (!c.endpoint) return err('OTPy', 'آدرس سرویس (Endpoint) تنظیم نشده است')
  if (!c.bodyTemplate) {
    return err('OTPy', 'بدنه درخواست (Body Template) تنظیم نشده است')
  }
  const bodyRaw = c.bodyTemplate.replace(/\{\{phone\}\}/g, phone).replace(/\{\{code\}\}/g, code)
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyRaw)
  } catch {
    return err('OTPy', 'بدنه درخواست JSON معتبر نیست')
  }
  const headers: Record<string, string> = {}
  if (c.headerName && c.headerValue) headers[c.headerName] = c.headerValue
  try {
    const res = await fetch(c.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(parsed),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text().catch(() => '')
    if (res.ok) return { ok: true }
    return err('OTPy', sanitize(`پاسخ HTTP ${res.status} — ${text.slice(0, 150)}`, c))
  } catch (e) {
    return netErr('OTPy', e, c)
  }
}

export const SMS_PROVIDERS = ['smsir', 'melipayamak', 'farazsms', 'otpy'] as const
export type SmsProvider = (typeof SMS_PROVIDERS)[number]

export const SMS_PROVIDER_LABELS: Record<string, string> = {
  smsir: 'SMS.ir',
  melipayamak: 'ملی پیامک',
  farazsms: 'فراز اس‌ام‌اس',
  otpy: 'OTPy (REST سازگار)',
}

// ─── ارسال متن آزاد (پیامک انبوه) — هر سرویس با الگوی خودش ───

async function bulkSmsIr(c: SmsCredentials, phone: string, text: string): Promise<SmsSendResult> {
  if (!c.apiKey) return err('sms.ir', 'کلید API تنظیم نشده است')
  if (!c.bulkLineNumber) return err('sms.ir', 'شماره خط ارسال انبوه (lineNumber) تنظیم نشده است')
  const base = (c.baseUrl || 'https://api.sms.ir/v1').replace(/\/+$/, '')
  try {
    const r = await postJson(
      `${base}/send/bulk`,
      { 'x-api-key': c.apiKey },
      { message: text, mobiles: [phone], lineNumber: c.bulkLineNumber },
      c,
    )
    if (r.status === 200 && r.json && Number(r.json.status) === 1) return { ok: true }
    const msg =
      (r.json && typeof r.json.message === 'string' && r.json.message) ||
      `پاسخ HTTP ${r.status}`
    return err('sms.ir', sanitize(msg, c))
  } catch (e) {
    return netErr('sms.ir', e, c)
  }
}

async function bulkMelipayamak(c: SmsCredentials, phone: string, text: string): Promise<SmsSendResult> {
  if (!c.username || !c.password) return err('ملی پیامک', 'نام کاربری/رمز پنل تنظیم نشده است')
  if (!c.from) return err('ملی پیامک', 'شماره خط خدماتی (from) تنظیم نشده است')
  const base = (c.baseUrl || 'https://rest.payamak-panel.com/api/SendOTP').replace(/\/+$/, '')
  try {
    const r = await postJson(
      `${base}/SendOTP`,
      {},
      { username: c.username, password: c.password, to: phone, from: c.from, text },
      c,
    )
    const ret = r.json ? Number(r.json.RetStatus) : NaN
    if (r.status === 200 && ret === 1) return { ok: true }
    const statusName = r.json && typeof r.json.StrRetStatus === 'string' ? r.json.StrRetStatus : ''
    return err('ملی پیامک', sanitize(`پاسخ HTTP ${r.status}${statusName ? ` — ${statusName}` : ''}`, c))
  } catch (e) {
    return netErr('ملی پیامک', e, c)
  }
}

async function bulkFarazSms(c: SmsCredentials, phone: string, text: string): Promise<SmsSendResult> {
  if (!c.apiKey) return err('فراز اس‌ام‌اس', 'کلید API تنظیم نشده است')
  if (!c.sender) return err('فراز اس‌ام‌اس', 'شماره فرستنده تنظیم نشده است')
  const base = (c.baseUrl || 'https://api2.ippanel.com/api/v1/sms/send/webservice').replace(
    /\/pattern.*$/,
    '',
  )
  try {
    const r = await postJson(
      `${base}/send/webservice`,
      { apikey: c.apiKey },
      {
        sender: c.sender.startsWith('+') ? c.sender : `+${c.sender}`,
        recipient: [phone],
        message: text,
      },
      c,
    )
    const bodyCode = r.json && r.json.code !== undefined ? Number(r.json.code) : undefined
    if (r.status === 200 && (bodyCode === 200 || bodyCode === undefined)) return { ok: true }
    const msg =
      (r.json && typeof r.json.message === 'string' && r.json.message) ||
      `پاسخ HTTP ${r.status}`
    return err('فراز اس‌ام‌اس', sanitize(msg, c))
  } catch (e) {
    return netErr('فراز اس‌ام‌اس', e, c)
  }
}

async function bulkOtpy(c: SmsCredentials, phone: string, text: string): Promise<SmsSendResult> {
  if (!c.endpoint) return err('OTPy', 'آدرس سرویس (Endpoint) تنظیم نشده است')
  const template = c.textTemplate || c.bodyTemplate
  if (!template) return err('OTPy', 'قالب بدنه (Body/Text Template) تنظیم نشده است')
  const bodyRaw = template.replace(/\{\{phone\}\}/g, phone).replace(/\{\{text\}\}/g, text)
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyRaw)
  } catch {
    return err('OTPy', 'بدنه درخواست JSON معتبر نیست')
  }
  const headers: Record<string, string> = {}
  if (c.headerName && c.headerValue) headers[c.headerName] = c.headerValue
  try {
    const res = await fetch(c.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(parsed),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return { ok: true }
    const t = await res.text().catch(() => '')
    return err('OTPy', sanitize(`پاسخ HTTP ${res.status} — ${t.slice(0, 150)}`, c))
  } catch (e) {
    return netErr('OTPy', e, c)
  }
}

/** ارسال واقعی متن آزاد (پیامک انبوه مدیر کل) با سرویس انتخاب‌شده */
export async function sendBulkTextViaProvider(
  provider: string,
  credentials: SmsCredentials,
  phone: string,
  text: string,
): Promise<SmsSendResult> {
  switch (provider) {
    case 'smsir':
      return bulkSmsIr(credentials, phone, text)
    case 'melipayamak':
      return bulkMelipayamak(credentials, phone, text)
    case 'farazsms':
      return bulkFarazSms(credentials, phone, text)
    case 'otpy':
      return bulkOtpy(credentials, phone, text)
    default:
      return { ok: false, error: 'سرویس پیامکی انتخاب نشده است' }
  }
}

/** ارسال واقعی کد با سرویس انتخاب‌شده */
export async function sendOtpViaProvider(
  provider: string,
  credentials: SmsCredentials,
  phone: string,
  code: string,
): Promise<SmsSendResult> {
  switch (provider) {
    case 'smsir':
      return sendSmsIr(credentials, phone, code)
    case 'melipayamak':
      return sendMelipayamak(credentials, phone, code)
    case 'farazsms':
      return sendFarazSms(credentials, phone, code)
    case 'otpy':
      return sendOtpy(credentials, phone, code)
    default:
      return { ok: false, error: 'سرویس پیامکی انتخاب نشده است' }
  }
}

/** فیلدهای اعتبار هر سرویس: نمایشی (مقدار برگردانده می‌شود) و محرمانه (فقط ماسک) */
export const SMS_PROVIDER_FIELDS: Record<
  string,
  { key: string; label: string; secret: boolean; placeholder?: string; hint?: string }[]
> = {
  smsir: [
    { key: 'apiKey', label: 'کلید API (x-api-key)', secret: true },
    { key: 'templateId', label: 'شناسه قالب (TemplateId)', secret: false, hint: 'قالب باید متغیر CODE داشته باشد' },
    { key: 'bulkLineNumber', label: 'شماره خط ارسال انبوه (اختیاری — برای پیامک انبوه)', secret: false, placeholder: '5000...' },
    { key: 'codeParam', label: 'نام متغیر کد در قالب', secret: false, placeholder: 'CODE' },
    { key: 'baseUrl', label: 'آدرس پایه (اختیاری)', secret: false, placeholder: 'https://api.sms.ir/v1' },
  ],
  melipayamak: [
    { key: 'username', label: 'نام کاربری پنل', secret: true },
    { key: 'password', label: 'رمز پنل', secret: true },
    { key: 'from', label: 'خط خدماتی (from)', secret: false, placeholder: '5000...' },
    { key: 'textTemplate', label: 'متن پیام', secret: false, placeholder: 'کد ورود دانیار: {CODE}', hint: 'برای پیامک انبوه، متن آزاد مستقیم ارسال می‌شود' },
    { key: 'baseUrl', label: 'آدرس پایه (اختیاری)', secret: false, placeholder: 'https://rest.payamak-panel.com/api/SendOTP' },
  ],
  farazsms: [
    { key: 'apiKey', label: 'کلید API (apikey)', secret: true },
    { key: 'patternCode', label: 'کد قالب (Pattern)', secret: false },
    { key: 'sender', label: 'شماره فرستنده', secret: false, placeholder: '+983000505' },
    { key: 'varName', label: 'نام متغیر کد در قالب', secret: false, placeholder: 'code', hint: 'پیامک انبوه با کلید API و شماره فرستنده از مسیر webservice ارسال می‌شود' },
    { key: 'baseUrl', label: 'آدرس پایه (اختیاری)', secret: false, placeholder: 'https://api2.ippanel.com/api/v1/sms/pattern/normal' },
  ],
  otpy: [
    { key: 'endpoint', label: 'آدرس کامل سرویس (Endpoint)', secret: false, placeholder: 'https://...' },
    { key: 'headerName', label: 'نام هدر احراز هویت', secret: false, placeholder: 'Authorization' },
    { key: 'headerValue', label: 'مقدار هدر احراز هویت', secret: true },
    {
      key: 'bodyTemplate',
      label: 'بدنه JSON با {{phone}} و {{code}}',
      secret: false,
      placeholder: '{"mobile":"{{phone}}","code":"{{code}}"}',
      hint: 'مستندات رسمی OTPy در دسترس نبود؛ مقادیر را طبق مستندات خود سرویس وارد کنید',
    },
  ],
}

export { maskPhone }
