/**
 * Shared site-settings contract used by both the public /api/settings route
 * and the SUPERADMIN-only /api/superadmin/settings route.
 *
 * Settings are stored in the SiteSetting table as rows of `{ key, value }`
 * where `value` is always a string. Booleans are stored as "true"/"false",
 * strings as-is, and string-arrays as `JSON.stringify([...])`. This module
 * is the canonical list of known keys + their default values + the
 * parse/format helpers so the API routes and the client hook stay in sync.
 *
 * There are three groups of settings:
 *  - "ui"        — the legacy UI toggles (lazyLoading, navigationProgress).
 *  - "ai"        — the AI-assistant settings (welcome message, suggested
 *                  prompts, access flags for stats/student-info/password).
 *  - "module"    — the global module toggles (class_chat, direct_chat, …).
 *                  When a module is off, the corresponding API endpoints
 *                  refuse the action via `assertModule` in module-check.ts.
 *                  SUPERADMIN bypasses every module check.
 */

/** Value type stored under each setting key. */
export type SettingValueType = "boolean" | "string" | "string[]";

/** Group a setting belongs to — drives the SUPERADMIN UI sectioning. */
export type SettingGroup = "ui" | "ai" | "module" | "webrtc";

/** Public shape returned by GET /api/settings. */
export interface SiteSettings {
  // UI toggles
  /** Show shimmer <Skeleton> placeholders during data fetching. */
  lazyLoading: boolean;
  /** Show the top navigation progress bar on page transitions. */
  navigationProgress: boolean;

  // AI assistant
  /** Welcome message shown at the top of the AI chat panel. */
  aiWelcomeMessage: string;
  /** Quick-reply chips rendered under the welcome message. */
  aiSuggestedPrompts: string[];
  /** AI may read the principal's school stats. */
  aiAccessStats: boolean;
  /** AI may read individual student info. */
  aiAccessStudentInfo: boolean;
  /** AI may suggest + execute a password change. */
  aiAccessPasswordChange: boolean;
  /** AI may delete users. */
  aiAccessDeleteUsers: boolean;
  /** AI may create groups. */
  aiAccessCreateGroups: boolean;
  /** AI may delete groups. */
  aiAccessDeleteGroups: boolean;
  /** AI may add users to groups. */
  aiAccessAddMembers: boolean;
  /** AI may read + summarize group chat content. */
  aiAccessGroupContent: boolean;
  /** AI may close groups for students. */
  aiAccessCloseGroups: boolean;
  /** AI may send announcements + read their content. */
  aiAccessAnnouncements: boolean;
  /** AI may read sample questions. */
  aiAccessSampleQuestions: boolean;
  /** AI may read assignments. */
  aiAccessAssignments: boolean;

  // Phase 35g — notification sound
  /** URL path to the notification sound file (e.g., "/sounds/notification.mp3").
   * Empty string = default browser sound. Managed by SUPERADMIN. */
  notificationSound: string;

  // NOTE: the SMS provider config moved to the dedicated «مدیریت OTP»
  // module (Phase 37 — src/lib/sms/provider-registry.ts +
  // /api/superadmin/otp-settings + /superadmin/otp). The old sms_* keys
  // (provider/username/password/from/api_key) were REMOVED from this catalog;
  // the login-method toggles live in «مدیریت ورود کاربر» (login-settings.ts).

  // Phase 36m — WebRTC STUN/TURN configuration (env-configurable for Docker).
  /** Comma-separated STUN server URLs (e.g. "stun:stun.l.google.com:19302"). */
  webrtcStunServers: string;
  /** TURN server URL (e.g. "turn:your-turn-server.com:443"). */
  webrtcTurnServer: string;
  /** TURN username. */
  webrtcTurnUsername: string;
  /** TURN credential (masked in GET). */
  webrtcTurnCredential: string;

  // AI provider config (Phase 34)
  /** "zai" (default) | "openai" | "anthropic". */
  aiProviderType: string;
  /** API key (MASKED in the GET response — full key is read directly
   * from the DB by the AI assistant route). */
  aiProviderApiKey: string;
  /** Base URL — empty string = use provider's default. */
  aiProviderBaseUrl: string;
  /** Model name — empty string = use provider's default model. */
  aiProviderModel: string;

  // Global module toggles
  modules: {
    classChat: boolean;
    directChat: boolean;
    assignments: boolean;
    sampleQuestions: boolean;
    grades: boolean;
    polls: boolean;
    fileUpload: boolean;
    bulkChat: boolean;
    aiAssistant: boolean;
    profileAvatar: boolean;
    darkMode: boolean;
    pushNotifications: boolean;
    /** Phase 27 — "فقط مدیر و معلم" filter toggle in the chat header.
     * When enabled, the chat header shows a Filter button that lets
     * users hide all STUDENT messages + see only TEACHER + ADMIN
     * messages. When disabled globally, the button is hidden from
     * all users. */
    teacherOnlyMessages: boolean;
    /** Phase 28 — attendance (حضور و غیاب) module. When enabled,
     * TEACHER/ADMIN/SUPERADMIN can take attendance per class+date+period
     * via the attendance-view, and students see their own reports.
     * When disabled, the attendance tab is hidden from the bottom nav
     * and the backend rejects all /api/attendance* calls. */
    attendance: boolean;
  };
}

/**
 * Catalog of known site settings.
 *
 *  - `key`           — primary key in the SiteSetting table.
 *  - `responseKey`   — dotted path into the public SiteSettings shape
 *                       (e.g. "modules.classChat"). Defaults to `key` itself
 *                       for the legacy UI toggles.
 *  - `label`         — Persian display label for the SUPERADMIN UI.
 *  - `description`   — Persian helper text explaining what the toggle does.
 *  - `defaultValue`  — returned when the row is missing (so disabling a
 *                       setting once + deleting the row still resolves to
 *                       the same value).
 *  - `valueType`     — how the value is stored/serialized in the DB.
 *  - `group`         — which SUPERADMIN settings section it belongs to.
 */
export interface KnownSettingDef {
  key: string;
  responseKey: string;
  label: string;
  description: string;
  defaultValue: boolean | string | string[];
  valueType: SettingValueType;
  group: SettingGroup;
  /**
   * Marks credential-like values (SMS/TURN/AI keys). Secret values are
   * masked when read back through the public settings endpoints.
   */
  isSecret?: boolean;
}

export const KNOWN_SETTINGS: KnownSettingDef[] = [
  // --- UI --------------------------------------------------------------
  {
    key: "lazyLoading",
    responseKey: "lazyLoading",
    label: "بارگذاری تنبل (Skeleton)",
    description:
      "هنگام بارگذاری اطلاعات، جایگاه‌های چشمک‌زن (Skeleton) نمایش داده شود. با خاموش کردن این گزینه، صفحه مستقیماً بدون جایگاه نمایش داده می‌شود.",
    defaultValue: true,
    valueType: "boolean",
    group: "ui",
  },
  {
    key: "navigationProgress",
    responseKey: "navigationProgress",
    label: "نوار پیشرفت ناوبری",
    description:
      "نوار پیشرفت بالای صفحه هنگام جابه‌جایی بین صفحات نمایش داده شود.",
    defaultValue: true,
    valueType: "boolean",
    group: "ui",
  },

  // --- AI assistant ----------------------------------------------------
  {
    key: "ai_welcome_message",
    responseKey: "aiWelcomeMessage",
    label: "پیام خوش‌آمد دستیار",
    description:
      "پیامی که هنگام باز کردن پنل دستیار هوش مصنوعی به مدیر نمایش داده می‌شود.",
    defaultValue:
      "سلام! من دستیار هوشمند شما هستم. می‌توانید آمار مدرسه، وضعیت دانش‌آموزان یا تغییر رمز عبور را بپرسید.",
    valueType: "string",
    group: "ai",
  },
  {
    key: "ai_suggested_prompts",
    responseKey: "aiSuggestedPrompts",
    label: "پیشنهادهای سریع",
    description:
      "فهرست پیشنهادهای سریع (دکمه‌های یک-کلیکی) که زیر پیام خوش‌آمد نمایش داده می‌شوند.",
    defaultValue: [
      "آمار مدرسه را بده",
      "وضعیت علی محمدی را بگو",
      "رمز student1 را به test1234 تغییر بده",
    ],
    valueType: "string[]",
    group: "ai",
  },
  {
    key: "ai_access_stats",
    responseKey: "aiAccessStats",
    label: "دسترسی به آمار مدرسه",
    description:
      "آیا دستیار می‌تواند آمار کلی مدرسه (تعداد دانش‌آموز/معلم/کلاس و …) را ببیند؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_student_info",
    responseKey: "aiAccessStudentInfo",
    label: "دسترسی به اطلاعات دانش‌آموز",
    description:
      "آیا دستیار می‌تواند اطلاعات یک دانش‌آموز (نمرات/تکالیف/کلاس‌ها) را ببیند؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_password_change",
    responseKey: "aiAccessPasswordChange",
    label: "اجازه تغییر رمز عبور",
    description:
      "آیا دستیار می‌تواند رمز عبور کاربران (دانش‌آموز/معلم) را تغییر دهد؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_delete_users",
    responseKey: "aiAccessDeleteUsers",
    label: "حذف کاربران",
    description:
      "آیا دستیار می‌تواند کاربران (دانش‌آموز/معلم) را حذف کند؟",
    defaultValue: false,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_create_groups",
    responseKey: "aiAccessCreateGroups",
    label: "ایجاد گروه‌ها",
    description:
      "آیا دستیار می‌تواند گروه‌های گفتگوی جدید ایجاد کند؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_delete_groups",
    responseKey: "aiAccessDeleteGroups",
    label: "حذف گروه‌ها",
    description:
      "آیا دستیار می‌تواند گروه‌های گفتگو را حذف کند؟",
    defaultValue: false,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_add_members",
    responseKey: "aiAccessAddMembers",
    label: "افزودن کاربر به گروه‌ها",
    description:
      "آیا دستیار می‌تواند کاربران را به گروه‌های گفتگو اضافه کند؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_group_content",
    responseKey: "aiAccessGroupContent",
    label: "خلاصه محتوای گروه‌ها",
    description:
      "آیا دستیار می‌تواند محتوای پیام‌های گروه‌ها را بخواند و خلاصه کند؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_close_groups",
    responseKey: "aiAccessCloseGroups",
    label: "بستن گروه‌ها برای دانش‌آموزان",
    description:
      "آیا دستیار می‌تواند گفتگوی گروه‌ها را برای دانش‌آموزان ببندد؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_announcements",
    responseKey: "aiAccessAnnouncements",
    label: "ارسال اطلاعیه‌ها و محتوای اطلاعیه‌ها",
    description:
      "آیا دستیار می‌تواند اطلاعیه‌ها را ارسال کند و محتوای آن‌ها را ببیند؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_sample_questions",
    responseKey: "aiAccessSampleQuestions",
    label: "محتوای نمونه سوالات",
    description:
      "آیا دستیار می‌تواند نمونه سوالات کلاس‌ها را بخواند؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "ai_access_assignments",
    responseKey: "aiAccessAssignments",
    label: "محتوای تکالیف",
    description:
      "آیا دستیار می‌تواند تکالیف کلاس‌ها را بخواند؟",
    defaultValue: true,
    valueType: "boolean",
    group: "ai",
  },
  {
    key: "notification_sound",
    responseKey: "notificationSound",
    label: "صدای نوتیفیکیشن",
    description:
      "مسیر فایل صدای نوتیفیکیشن (مثلاً /sounds/notification.mp3). خالی = صدای پیش‌فرض مرورگر.",
    defaultValue: "",
    valueType: "string",
    group: "ai",
  },

  // --- SMS provider config — REMOVED (Phase 37) ----------------------
  // The whole SMS group moved to the dedicated «مدیریت OTP» module:
  // multi-provider (OTPy / Melipayamak / Faraz / SMS.ir), credentials
  // resolved from env vars + the secure panel, hashed OTP storage and
  // delivery logging. See src/lib/sms/provider-registry.ts and
  // /superadmin/otp. The legacy sms_* / sms_otp_login_enabled rows are
  // inert (no longer read by anything).

  // --- WebRTC STUN/TURN config (Phase 36m) ---------------------------
  // Configurable via env vars (STUN_SERVERS, TURN_SERVER, etc.) for Docker,
  // OR via the superadmin settings panel. Env vars override DB values.
  {
    key: "webrtc_stun_servers",
    responseKey: "webrtcStunServers",
    label: "سرورهای STUN",
    description: "URLهای STUN با کاما جدا شوند. مثال: stun:stun.l.google.com:19302",
    defaultValue: "",
    valueType: "string",
    group: "webrtc",
    isSecret: false,
  },
  {
    key: "webrtc_turn_server",
    responseKey: "webrtcTurnServer",
    label: "سرور TURN",
    description: "URL سرور TURN برای NAT traversal.",
    defaultValue: "",
    valueType: "string",
    group: "webrtc",
    isSecret: false,
  },
  {
    key: "webrtc_turn_username",
    responseKey: "webrtcTurnUsername",
    label: "نام کاربری TURN",
    description: "نام کاربری سرور TURN.",
    defaultValue: "",
    valueType: "string",
    group: "webrtc",
    isSecret: false,
  },
  {
    key: "webrtc_turn_credential",
    responseKey: "webrtcTurnCredential",
    label: "رمز عبور TURN",
    description: "رمز عبور سرور TURN.",
    defaultValue: "",
    valueType: "string",
    group: "webrtc",
    isSecret: true,
  },

  // Lets the SUPERADMIN configure a custom AI provider (OpenAI-compatible
  // or Anthropic) instead of the built-in z-ai-web-dev-sdk. The
  // principal's AI assistant reads these + dispatches to the right
  // HTTP endpoint (see src/lib/ai-provider.ts).
  //
  // SECURITY: `ai_provider_api_key` is stored as a plain string in the
  // SiteSetting table (same as the existing welcome-message string) —
  // BUT the GET /api/superadmin/settings route MASKS it before returning
  // so the network response never leaks the full key. The AI assistant
  // route reads the full key directly from the DB.
  {
    key: "ai_provider_type",
    responseKey: "aiProviderType",
    label: "نوع ارائه‌دهنده هوش مصنوعی",
    description:
      "ارائه‌دهنده‌ای که دستیار مدیر از آن استفاده می‌کند. «پیش‌فرض» = زد-ای-آی، «OpenAI» = سازگار با OpenAI، «Anthropic» = سازگار با Anthropic.",
    defaultValue: "zai",
    valueType: "string",
    group: "ai",
  },
  {
    key: "ai_provider_api_key",
    responseKey: "aiProviderApiKey",
    label: "کلید API",
    description:
      "کلید API ارائه‌دهنده (در پاسخ‌های API به‌صورت ماسک‌شده نمایش داده می‌شود).",
    defaultValue: "",
    valueType: "string",
    group: "ai",
  },
  {
    key: "ai_provider_base_url",
    responseKey: "aiProviderBaseUrl",
    label: "Base URL",
    description:
      "آدرس پایه ارائه‌دهنده. خالی = پیش‌فرض ارائه‌دهنده (https://api.openai.com/v1 یا https://api.anthropic.com/v1).",
    defaultValue: "",
    valueType: "string",
    group: "ai",
  },
  {
    key: "ai_provider_model",
    responseKey: "aiProviderModel",
    label: "نام مدل",
    description:
      "نام مدل (مثلاً gpt-4o-mini برای OpenAI یا claude-3-5-sonnet-20241022 برای Anthropic). خالی = مدل پیش‌فرض ارائه‌دهنده.",
    defaultValue: "",
    valueType: "string",
    group: "ai",
  },

  // --- Global modules --------------------------------------------------
  {
    key: "module_class_chat",
    responseKey: "modules.classChat",
    label: "گفتگو کلاسی",
    description: "ماژول گفتگوهای کلاسی (پیام‌های گروهی در کلاس).",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_direct_chat",
    responseKey: "modules.directChat",
    label: "گفتگو مستقیم",
    description: "ماژول گفتگوهای خصوصی (۱-به-۱) بین کاربران.",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_assignments",
    responseKey: "modules.assignments",
    label: "تکالیف",
    description: "ماژول تکالیف (ایجاد/مشاهده/ثبت وضعیت).",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_sample_questions",
    responseKey: "modules.sampleQuestions",
    label: "نمونه سوالات",
    description: "ماژول نمونه سوالات (ایجاد/مشاهده).",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_grades",
    responseKey: "modules.grades",
    label: "نمرات",
    description: "ماژول نمرات (ثبت/مشاهده).",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_polls",
    responseKey: "modules.polls",
    label: "نظرسنجی",
    description: "ماژول نظرسنجی در گفتگوی کلاسی.",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_file_upload",
    responseKey: "modules.fileUpload",
    label: "ارسال فایل",
    description: "ماژول ارسال فایل در گفتگوها.",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_bulk_chat",
    responseKey: "modules.bulkChat",
    label: "گفتگوی دسته‌ای",
    description: "ماژول مدیریت دسته‌ای گفتگوها (بستن همه گفتگوها).",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_ai_assistant",
    responseKey: "modules.aiAssistant",
    label: "دستیار هوش مصنوعی",
    description: "ماژول دستیار هوش مصنوعی مدیر مدرسه.",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_profile_avatar",
    responseKey: "modules.profileAvatar",
    label: "تصویر پروفایل",
    description: "ماژول بارگذاری/تغییر تصویر پروفایل کاربر.",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_dark_mode",
    responseKey: "modules.darkMode",
    label: "حالت تاریک",
    description: "ماژول حالت تاریک (تغییر تم در کلاینت).",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_push_notifications",
    responseKey: "modules.pushNotifications",
    label: "پوش نوتیفیکیشن",
    description: "ماژول ارسال نوتیفیکیشن پوش به کاربران.",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_teacher_only_messages",
    responseKey: "modules.teacherOnlyMessages",
    label: "فقط مدیر و معلم",
    description:
      "قابلیت فیلتر پیام‌ها در چت — با فعال‌سازی، پیام‌های دانش‌آموزان مخفی و فقط پیام‌های معلم و مدیر نمایش داده می‌شود.",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
  {
    key: "module_attendance",
    responseKey: "modules.attendance",
    label: "حضور و غیاب",
    description:
      "ثبت حضور و غیاب دانش‌آموزان به‌صورت روزانه و به تفکیک زنگ — و مشاهده گزارش شخصی توسط دانش‌آموز.",
    defaultValue: true,
    valueType: "boolean",
    group: "module",
  },
];

/** Quick lookup map: key -> KnownSettingDef. */
export const KNOWN_SETTINGS_BY_KEY: Record<string, KnownSettingDef> =
  Object.fromEntries(KNOWN_SETTINGS.map((s) => [s.key, s]));

/** Returns true if `key` is one of the known site-setting keys. */
export function isKnownSettingKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(KNOWN_SETTINGS_BY_KEY, key);
}

/** Returns the def for a key, or null. */
export function getSettingDef(key: string): KnownSettingDef | null {
  return KNOWN_SETTINGS_BY_KEY[key] ?? null;
}

/**
 * Convert a raw `SiteSetting` row value to a boolean.
 * Accepts "true"/"false" (case-insensitive) and "1"/"0".
 * Falls back to the key's default (or `true` for unknown keys) when the
 * raw value is missing or unparseable.
 */
export function parseSettingBool(
  key: string,
  rawValue: string | null | undefined,
): boolean {
  const def = KNOWN_SETTINGS_BY_KEY[key];
  if (rawValue == null || rawValue === "") {
    return typeof def?.defaultValue === "boolean" ? def.defaultValue : true;
  }
  const v = rawValue.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return typeof def?.defaultValue === "boolean" ? def.defaultValue : true;
}

/** Parse a raw string value (returns the default when the row is missing). */
export function parseSettingString(
  key: string,
  rawValue: string | null | undefined,
): string {
  const def = KNOWN_SETTINGS_BY_KEY[key];
  if (rawValue == null) {
    return typeof def?.defaultValue === "string" ? def.defaultValue : "";
  }
  return rawValue;
}

/** Parse a raw JSON string-array value (returns the default on parse failure). */
export function parseSettingStringArray(
  key: string,
  rawValue: string | null | undefined,
): string[] {
  const def = KNOWN_SETTINGS_BY_KEY[key];
  const fallback = Array.isArray(def?.defaultValue)
    ? (def.defaultValue as string[])
    : [];
  if (rawValue == null || rawValue === "") return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed
        .map((x) => (typeof x === "string" ? x : String(x)))
        .filter((s) => s.length > 0);
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** Format a boolean back to its canonical stored string form. */
export function formatSettingValue(value: boolean): string {
  return value ? "true" : "false";
}

/**
 * Format any value (boolean/string/string[]) into its canonical stored form
 * based on the key's valueType.
 */
export function formatSetting(rawValue: unknown, valueType: SettingValueType): string {
  if (valueType === "boolean") {
    return formatSettingValue(Boolean(rawValue));
  }
  if (valueType === "string") {
    return typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
  }
  // string[]
  if (Array.isArray(rawValue)) {
    return JSON.stringify(
      rawValue.map((v) => (typeof v === "string" ? v : String(v))),
    );
  }
  // Allow a pre-serialized JSON string for string[] (caller's responsibility).
  if (typeof rawValue === "string") return rawValue;
  return "[]";
}

/**
 * Set a value at a dotted `responseKey` path on the output object
 * (e.g. `modules.classChat` → `out.modules.classChat`).
 */
function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== "object") {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Pure clone-and-set helper: returns a shallow clone of `obj` with `value`
 * written at the dotted `path`. Used by the SUPERADMIN settings UI to
 * produce an optimistic snapshot of the settings shape.
 *
 *   setPathClone({ modules: { classChat: true } }, "modules.classChat", false)
 *   → { modules: { classChat: false } }
 *
 * Every intermediate object along the path is cloned (so React sees a fresh
 * reference at each level); siblings outside the path keep their references.
 */
export function setPathClone<T>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const parts = path.split(".");
  const out: any = Array.isArray(obj)
    ? [...(obj as unknown as unknown[])]
    : { ...(obj as Record<string, unknown> | null | undefined) };
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const child = cur[k];
    if (child == null || typeof child !== "object") {
      cur[k] = {};
    } else {
      cur[k] = Array.isArray(child)
        ? [...(child as unknown[])]
        : { ...(child as Record<string, unknown>) };
    }
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return out as T;
}

/**
 * Build the full SiteSettings payload from raw DB rows. Missing keys fall
 * back to their defaults so the client always sees a complete object.
 */
export function buildSettingsMap(
  rows: Array<{ key: string; value: string }>,
): SiteSettings {
  const lookup = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const def of KNOWN_SETTINGS) {
    const raw = lookup.get(def.key) ?? null;
    let value: boolean | string | string[];
    if (def.valueType === "boolean") {
      value = parseSettingBool(def.key, raw);
    } else if (def.valueType === "string") {
      value = parseSettingString(def.key, raw);
    } else {
      value = parseSettingStringArray(def.key, raw);
    }
    setPath(out, def.responseKey, value);
  }
  return out as unknown as SiteSettings;
}

/**
 * Read a single setting's current value out of a populated SiteSettings
 * payload, using the def's dotted `responseKey` path
 * (e.g. "modules.classChat" → `settings.modules.classChat`).
 *
 * Returns the def's `defaultValue` when the path is missing (defensive —
 * shouldn't happen because `buildSettingsMap` always populates every key,
 * but keeps the helper total).
 */
export function getSettingValueByDef(
  settings: SiteSettings | null | undefined,
  def: KnownSettingDef,
): boolean | string | string[] {
  if (!settings) {
    return def.defaultValue;
  }
  const parts = def.responseKey.split(".");
  // Use `any` here because we're traversing a typed object whose fields are
  // a mix of boolean / string / string[] / nested object — TS can't narrow
  // the union by string path.
  let cur: any = settings;
  for (const p of parts) {
    if (cur == null) return def.defaultValue;
    cur = cur[p];
  }
  if (cur == null) return def.defaultValue;
  return cur as boolean | string | string[];
}
