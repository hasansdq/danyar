/**
 * SMS provider REGISTRY — the single extension point of the provider-based
 * OTP architecture (Phase 37).
 *
 * ADDING A 5th PROVIDER (no OTP-core change needed):
 *   1. Create `src/lib/sms/providers/<id>.ts` implementing SMSProviderAdapter.
 *   2. Add the id to SMSProviderId (types.ts).
 *   3. Add one PROVIDER_DEF entry + one factory case below.
 *   4. (Optional) add its env vars to .env.example.
 * Everything else — settings API, panel UI, delivery logging, OTP core —
 * works off the metadata in this registry automatically.
 *
 * Each definition declares the provider's metadata (labels shown in the
 * superadmin panel), its credential fields (which env var backs each field,
 * whether it is a SECRET that must never be returned to the frontend, and
 * whether it is required), and its capabilities.
 */

import type { SMSProviderId, SMSProviderAdapter, SMSProviderConfig } from "./providers/types";
import { OtpyProvider } from "./providers/otpy";
import { MelipayamakProvider } from "./providers/melipayamak";
import { FarazSmsProvider } from "./providers/faraz";
import { SmsIrProvider } from "./providers/smsir";

/** A credential field of a provider (drives the settings panel + resolution). */
export interface ProviderFieldDef {
  /** Field key inside the adapter config (fields/secrets record). */
  key: string;
  /** Persian label shown in the panel. */
  label: string;
  /** Persian help text shown under the input. */
  description?: string;
  /** Secret fields: write-only (never returned to the frontend). */
  secret: boolean;
  /** Required for the provider to be considered "configured". */
  required: boolean;
  /** Environment variable that backs this field when no DB value is set. */
  envVar: string;
  /** Input placeholder (non-secret hints only). */
  placeholder?: string;
}

export interface ProviderDef {
  id: SMSProviderId;
  /** Persian display name. */
  label: string;
  /** Short Persian description shown on the provider card. */
  description: string;
  /** Official docs URL (shown as a link in the panel). */
  docsUrl: string;
  /** Credential fields. */
  fields: ProviderFieldDef[];
  /**
   * MANAGED: the provider generates + verifies the OTP itself (OTPy).
   * Custom-code providers embed OUR generated code in the message.
   */
  managed: boolean;
  /** Whether plain-text (announcement) SMS is supported. */
  plainSms: boolean;
  /** Builds the adapter from resolved credentials. */
  create: (config: SMSProviderConfig) => SMSProviderAdapter;
}

/** SiteSetting key naming: `otp_provider_<id>_enabled`. */
export function providerEnabledKey(id: SMSProviderId): string {
  return `otp_provider_${id}_enabled`;
}

/** SiteSetting key naming: `otp_cred_<provider>_<field>`. */
export function providerCredentialKey(id: SMSProviderId, field: string): string {
  return `otp_cred_${id}_${field}`;
}

export const PROVIDER_DEFS: ProviderDef[] = [
  {
    id: "otpy",
    label: "OTPy",
    description:
      "سامانه تخصصی OTP ایرانی (otpy.ir) — خودِ سرویس کد را تولید و تایید می‌کند؛ نیازی به خط اختصاصی و الگو ندارد. ۱۰ پیامک رایگان در روز.",
    docsUrl: "https://otpy.ir/docs",
    managed: true,
    plainSms: false,
    fields: [
      {
        key: "apiKey",
        label: "کلید API",
        description: "کلید پروژه از پنل OTPy (با پیشوند otpy_). فقط از طریق پنل یا متغیر محیطی ذخیره می‌شود و هرگز نمایش داده نمی‌شود.",
        secret: true,
        required: true,
        envVar: "SMS_OTPY_API_KEY",
        placeholder: "otpy_…",
      },
    ],
    create: (config) => new OtpyProvider(config),
  },
  {
    id: "melipayamak",
    label: "ملی پیامک",
    description:
      "وب‌سرویس رسمی rest.payamak-panel.com — ارسال ساده و ارسال با کد متن (پترن) خدماتی. برای کد تایید، تنظیم «کد متن» توصیه می‌شود.",
    docsUrl: "https://melipayamak.com/api",
    managed: false,
    plainSms: true,
    fields: [
      {
        key: "username",
        label: "نام کاربری پنل",
        secret: true,
        required: true,
        envVar: "SMS_MELIPAYAMAK_USERNAME",
      },
      {
        key: "password",
        label: "رمز عبور پنل",
        secret: true,
        required: true,
        envVar: "SMS_MELIPAYAMAK_PASSWORD",
      },
      {
        key: "from",
        label: "شماره خط فرستنده",
        description: "شماره اختصاصی پنل، مثال: 5000123456 — برای ارسال ساده الزامی است.",
        secret: false,
        required: true,
        envVar: "SMS_MELIPAYAMAK_FROM",
        placeholder: "5000123456",
      },
      {
        key: "bodyId",
        label: "کد متن خدماتی (پترن)",
        description: "اختیاری — کد متن تاییدشده پنل. اگر وارد شود، کد تایید با اولویت بالاتر از طریق همین متن ارسال می‌شود.",
        secret: false,
        required: false,
        envVar: "SMS_MELIPAYAMAK_BODY_ID",
        placeholder: "مثال: 1234",
      },
    ],
    create: (config) => new MelipayamakProvider(config),
  },
  {
    id: "faraz",
    label: "فراز اس‌ام‌اس (IPPanel)",
    description:
      "وب‌سرویس رسمی api2.ippanel.com — ارسال ساده و ارسال با پترن (متغیرهای قالب). برای کد تایید، تنظیم «کد پترن» توصیه می‌شود.",
    docsUrl: "https://ippanelcom.github.io/Edge-Document/docs",
    managed: false,
    plainSms: true,
    fields: [
      {
        key: "apiKey",
        label: "کلید API",
        description: "کلید API پنل فراز/IPPanel. هرگز نمایش داده نمی‌شود.",
        secret: true,
        required: true,
        envVar: "SMS_FARAZ_API_KEY",
      },
      {
        key: "sender",
        label: "شماره خط فرستنده",
        description: "شماره خط (originator)، مثال: +9810001 یا 3000…",
        secret: false,
        required: true,
        envVar: "SMS_FARAZ_SENDER",
        placeholder: "+9810001",
      },
      {
        key: "patternCode",
        label: "کد پترن",
        description: "اختیاری — کد پترن تاییدشده؛ اگر وارد شود کد تایید از کانال پترن ارسال می‌شود.",
        secret: false,
        required: false,
        envVar: "SMS_FARAZ_PATTERN_CODE",
        placeholder: "t2cfmnyo0c",
      },
      {
        key: "patternArg",
        label: "نام متغیر پترن",
        description: "نام متغیر کد داخل قالب پترن (پیش‌فرض: code).",
        secret: false,
        required: false,
        envVar: "SMS_FARAZ_PATTERN_ARG",
        placeholder: "code",
      },
    ],
    create: (config) => new FarazSmsProvider(config),
  },
  {
    id: "smsir",
    label: "SMS.ir",
    description:
      "وب‌سرویس رسمی api.sms.ir — ارسال کد تایید از طریق قالب «ارسال سریع» (Verify) و ارسال ساده از خط اختصاصی.",
    docsUrl: "https://sms.ir/rest-api",
    managed: false,
    plainSms: true,
    fields: [
      {
        key: "apiKey",
        label: "کلید API",
        description: "کلید API از بخش برنامه‌نویسان پنل SMS.ir. هرگز نمایش داده نمی‌شود.",
        secret: true,
        required: true,
        envVar: "SMS_SMSIR_API_KEY",
      },
      {
        key: "lineNumber",
        label: "شماره خط اختصاصی",
        description: "خط ارسال ساده، مثال: 3000748200042 — برای ارسال اطلاع‌رسانی‌ها الزامی است.",
        secret: false,
        required: true,
        envVar: "SMS_SMSIR_LINE_NUMBER",
        placeholder: "30004505000017",
      },
      {
        key: "templateId",
        label: "شناسه قالب کد تایید",
        description: "شناسه قالب تعریف‌شده در بخش «ارسال سریع» پنل — برای ارسال کد تایید با این سرویس الزامی است.",
        secret: false,
        required: false,
        envVar: "SMS_SMSIR_TEMPLATE_ID",
        placeholder: "مثال: 100000",
      },
      {
        key: "templateParam",
        label: "نام پارامتر کد",
        description: "نام پارامتر کد داخل قالب (پیش‌فرض: Code).",
        secret: false,
        required: false,
        envVar: "SMS_SMSIR_TEMPLATE_PARAM",
        placeholder: "Code",
      },
    ],
    create: (config) => new SmsIrProvider(config),
  },
];

/** Look up a provider definition by id. */
export function getProviderDef(id: string): ProviderDef | undefined {
  return PROVIDER_DEFS.find((p) => p.id === id);
}

/** All valid active-provider values (incl. "off"). */
export const ACTIVE_PROVIDER_VALUES = ["off", ...PROVIDER_DEFS.map((p) => p.id)] as const;
export type ActiveProviderValue = (typeof ACTIVE_PROVIDER_VALUES)[number];
