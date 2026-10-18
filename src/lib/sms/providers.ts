import { maskPhone } from '@/lib/phone'
import { describeNetworkError } from '@/lib/net-errors'

/**
 * اتصال واقعی به سرویس‌های پیامکی — هر سرویس مطابق مستندات رسمی خودش.
 * - sms.ir: متد «ارسال کد تایید» (send/verify) با هدر x-api-key و قالب TemplateId
 * - ملی پیامک: وب‌سرویس رسمی REST پنل (rest.payamak-panel.com/api/SendSMS/SendSMS)
 *   با بدنه x-www-form-urlencoded — دقیقاً مطابق SDK رسمی ملی پیامک
 *   (github.com/Melipayamak/melipayamak-python و پکیج npm رسمی).
 *   سرویس OTP پنل ملی پیامک که در پیاده‌سازی قبلی به آن اشاره می‌شد
 *   (api/SendOTP/SendOTP) وجود ندارد (پاسخ ۴۰۴) و حذف شد.
 *   برای اطمینان از اتصال، متد GetCredit همان سامانه استفاده می‌شود.
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

/**
 * POST با بدنه x-www-form-urlencoded — مطابق SDK رسمی ملی پیامک.
 * URLSearchParams متن فارسی را به‌درستی encode می‌کند.
 */
async function postForm(
  url: string,
  body: Record<string, string>,
  secrets: SmsCredentials,
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams(body).toString(),
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

/** پیام‌های رسمی ملی پیامک برای RetStatus — طبقه SDK رسمی (npm @mfrtn/melipayamak-api) */
const MELIPAYAMAK_RET_MESSAGES: Record<number, string> = {
  0: 'نام کاربری یا رمز عبور پنل اشتباه است',
  2: 'اعتبار پنل کافی نمی‌باشد',
  3: 'محدودیت در ارسال روزانه',
  4: 'محدودیت در حجم ارسال',
  5: 'شماره فرستنده (خط) معتبر نمی‌باشد',
  6: 'سامانه ملی پیامک در حال بروزرسانی است',
  7: 'متن پیامک حاوی کلمه فیلترشده است',
  9: 'ارسال از خطوط عمومی از طریق وب‌سرویس امکان‌پذیر نیست',
  10: 'کاربر پنل فعال نمی‌باشد',
  11: 'پیامک ارسال نشد',
  12: 'مدارک کاربر کامل نمی‌باشد',
  13: 'متن پیامک حاوی لینک است',
  14: 'شماره گیرنده نامعتبر است',
  15: 'ارسال به بیش از یک شماره همراه بدون درج «لغو11» ممکن نیست',
  19: 'خطای نامشخص سامانه پیامکی',
  35: 'داده‌های ارسالی نامعتبر است — شماره خط (from) به پنل شما تعلق ندارد یا گیرنده در لیست سیاه است',
  [-1]: 'دسترسی وب‌سرویس برای این پنل فعال نیست',
}

/**
 * تفسیر پاسخ رسمی ملی پیامک به نتیجه استاندارد ما.
 * پاسخ موفق: RetStatus === 1 (StrRetStatus=Ok) و Value = شناسه پیام (recId).
 */
function melipayamakResult(
  r: { status: number; json: Record<string, unknown> | null; text: string },
  c: SmsCredentials,
): SmsSendResult {
  const ret = r.json ? Number(r.json.RetStatus) : NaN
  const strRet = r.json && typeof r.json.StrRetStatus === 'string' ? r.json.StrRetStatus : ''
  if (r.status === 200 && ret === 1) {
    return { ok: true }
  }
  const official = Number.isFinite(ret) ? MELIPAYAMAK_RET_MESSAGES[ret] : undefined
  const parts: string[] = []
  if (r.status !== 200) parts.push(`پاسخ HTTP ${r.status}`)
  if (official) parts.push(official)
  else if (strRet) parts.push(strRet)
  if (!official && strRet) parts.push(`(RetStatus ${ret})`)
  if (!parts.length) parts.push('پاسخ نامعتبر از سرویس')
  return err('ملی پیامک', sanitize(parts.join(' — '), c))
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

// ─── ملی پیامک (وب‌سرویس رسمی REST — rest.payamak-panel.com) ───
/**
 * ارسال کد ورود: مطابق SDK رسمی، POST به /api/SendSMS/SendSMS با بدنه
 * form-urlencoded شامل username/password/to/from/text/isFlash=false.
 * مسیر قبلی /api/SendOTP/SendOTP در سرور ملی پیامک وجود ندارد (404) و حذف شد.
 */
async function sendMelipayamak(c: SmsCredentials, phone: string, code: string): Promise<SmsSendResult> {
  if (!c.username || !c.password) return err('ملی پیامک', 'نام کاربری/رمز پنل تنظیم نشده است')
  if (!c.from) return err('ملی پیامک', 'شماره خط ارسال (from) تنظیم نشده است')
  const base = melipayamakBase(c)
  const text = (c.textTemplate || 'کد ورود دانیار: {CODE}').replace('{CODE}', code)
  try {
    const r = await postForm(
      `${base}/SendSMS`,
      { username: c.username, password: c.password, to: phone, from: c.from, text, isFlash: 'false' },
      c,
    )
    return melipayamakResult(r, c)
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
  if (!c.from) return err('ملی پیامک', 'شماره خط ارسال (from) تنظیم نشده است')
  const base = melipayamakBase(c)
  try {
    const r = await postForm(
      `${base}/SendSMS`,
      { username: c.username, password: c.password, to: phone, from: c.from, text, isFlash: 'false' },
      c,
    )
    return melipayamakResult(r, c)
  } catch (e) {
    return netErr('ملی پیامک', e, c)
  }
}

/** آدرس پایه وب‌سرویس ملی پیامک — پشتیبانی از مقدار قدیمی baseUrl (SendOTP) برای مهاجرت */
function melipayamakBase(c: SmsCredentials): string {
  const raw = (c.baseUrl || '').trim()
  if (!raw) return 'https://rest.payamak-panel.com/api/SendSMS'
  let base = raw.replace(/\/+$/, '')
  // پیکربندی‌های قدیمی که به SendOTP اشاره می‌کردند به مسیر رسمی SendSMS هدایت می‌شوند
  base = base.replace(/\/api\/(SendOTP|SendSMS)\/?$/i, '/api/SendSMS')
  if (!/\/api\/SendSMS$/i.test(base)) base = `${base}/api/SendSMS`
  return base
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

/**
 * بررسی اتصال و اعتبار پنل بدون ارسال پیامک — برای دکمه «تست اتصال» مدیر کل.
 * ملی پیامک: متد رسمی GetCredit (نام کاربری/رمز را بدون ارسال پیامک اعتبارسنجی می‌کند)
 * و اعتبار باقی‌مانده پنل را برمی‌گرداند. بقیه سرویس‌ها فعلاً فقط آماده‌بودن پیکربندی را چک می‌کنند.
 */
export async function checkProviderConnection(
  provider: string,
  credentials: SmsCredentials,
): Promise<{ ok: boolean; detail: string }> {
  if (provider === 'melipayamak') {
    if (!credentials.username || !credentials.password) {
      return { ok: false, detail: 'نام کاربری/رمز پنل تنظیم نشده است' }
    }
    const base = melipayamakBase(credentials)
    try {
      const r = await postForm(
        `${base}/GetCredit`,
        { username: credentials.username, password: credentials.password },
        credentials,
      )
      const ret = r.json ? Number(r.json.RetStatus) : NaN
      if (r.status === 200 && ret === 1) {
        const value = r.json ? String(r.json.Value ?? '') : ''
        return {
          ok: true,
          detail: value ? `اتصال برقرار است؛ اعتبار پنل: ${sanitize(value, credentials)} ریال` : 'اتصال برقرار است',
        }
      }
      const res = melipayamakResult(r, credentials)
      return { ok: false, detail: res.error ?? 'اتصال ناموفق بود' }
    } catch (e) {
      const res = netErr('ملی پیامک', e, credentials)
      return { ok: false, detail: res.error ?? 'خطای اتصال' }
    }
  }
  // سرویس‌های دیگر: اعتبارسنجی پیکربندی
  const fields = SMS_PROVIDER_FIELDS[provider]
  if (!fields) return { ok: false, detail: 'سرویس پیامکی نامعتبر است' }
  const missing = fields
    .filter((f) => ['apiKey', 'username', 'password', 'endpoint', 'patternCode'].includes(f.key))
    .filter((f) => !credentials[f.key])
    .map((f) => f.label)
  if (missing.length) return { ok: false, detail: `تنظیم نشده: ${missing.join('، ')}` }
  return { ok: true, detail: 'پیکربندی کامل است؛ ارسال آزمایشی را انجام دهید' }
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
    { key: 'username', label: 'نام کاربری پنل ملی پیامک', secret: true },
    { key: 'password', label: 'رمز عبور پنل', secret: true },
    { key: 'from', label: 'شماره خط ارسال (from)', secret: false, placeholder: '5000... یا 3000... یا 021...', hint: 'شماره خطی که در پنل ملی پیامک به شما اختصاص داده شده است' },
    { key: 'textTemplate', label: 'متن پیام', secret: false, placeholder: 'کد ورود دانیار: {CODE}', hint: 'برای پیامک انبوه، متن آزاد مستقیم ارسال می‌شود — وب‌سرویس رسمی: rest.payamak-panel.com/api/SendSMS/SendSMS' },
    { key: 'baseUrl', label: 'آدرس پایه (اختیاری)', secret: false, placeholder: 'https://rest.payamak-panel.com/api/SendSMS' },
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
