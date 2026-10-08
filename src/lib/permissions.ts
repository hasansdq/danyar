/**
 * Modular feature-permission catalog.
 *
 * The SUPERADMIN toggles these on/off per role (STUDENT / TEACHER / ADMIN).
 * When a feature is off for a role:
 *   - the frontend hides the corresponding UI for users of that role
 *   - the backend rejects the corresponding API action (defense in depth)
 *
 * `key` is stored in the `RolePermission.featureKey` column.
 */

export type Role = "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";

export const MANAGED_ROLES: Role[] = ["STUDENT", "TEACHER", "ADMIN"];

export type FeatureDef = {
  key: string;
  label: string;
  description: string;
};

export const STUDENT_FEATURES: FeatureDef[] = [
  { key: "chat", label: "گفتگو", description: "استفاده از چت کلاس" },
  { key: "assignments", label: "تکالیف", description: "مشاهده تکالیف و وضعیت" },
  { key: "sample_questions", label: "نمونه سوالات", description: "مشاهده نمونه سوالات" },
  { key: "grades", label: "نمرات", description: "مشاهده نمرات خود" },
  { key: "behavior", label: "کارت‌های رفتاری", description: "مشاهده کارت‌های رفتاری خود" },
  { key: "file_upload", label: "ارسال فایل در چت", description: "آپلود فایل در گفتگو" },
];

export const TEACHER_FEATURES: FeatureDef[] = [
  { key: "chat", label: "گفتگو", description: "استفاده از چت کلاس" },
  { key: "create_assignment", label: "ایجاد تکلیف", description: "افزودن و ویرایش تکالیف" },
  { key: "create_sample_question", label: "ایجاد نمونه سوال", description: "افزودن نمونه سوالات" },
  { key: "set_grades", label: "ثبت نمرات", description: "وارد کردن نمرات دانش‌آموزان" },
  { key: "set_behavior", label: "ثبت کارت رفتاری", description: "ثبت کارت‌های رفتاری دانش‌آموزان" },
  { key: "create_poll", label: "ایجاد نظرسنجی", description: "ساخت نظرسنجی در چت" },
  { key: "close_chat", label: "بستن گفتگو", description: "بستن/باز کردن چت کلاس" },
  { key: "delete_message", label: "حذف پیام", description: "حذف پیام دانش‌آموزان" },
  { key: "file_upload", label: "ارسال فایل در چت", description: "آپلود فایل در گفتگو" },
  { key: "bulk_chat_management", label: "مدیریت دسته‌ای گفتگو", description: "بستن همه گفتگوها" },
];

export const ADMIN_FEATURES: FeatureDef[] = [
  { key: "manage_users", label: "مدیریت کاربران", description: "ایجاد/ویرایش/حذف کاربران" },
  { key: "manage_classes", label: "مدیریت کلاس‌ها", description: "ایجاد/ویرایش/حذف کلاس‌ها" },
  { key: "manage_enrollment", label: "عضویت دسته‌ای", description: "ثبت‌نام دسته‌ای دانش‌آموزان" },
  { key: "manage_content", label: "مدیریت محتوا", description: "تکالیف/نمونه سوال/نمرات" },
  { key: "bulk_chat_management", label: "مدیریت دسته‌ای گفتگو", description: "بستن همه گفتگوها" },
  { key: "ai_assistant", label: "دستیار هوش مصنوعی", description: "دسترسی مدیر مدرسه به دستیار AI" },
];

export const FEATURES_BY_ROLE: Record<"STUDENT" | "TEACHER" | "ADMIN", FeatureDef[]> = {
  STUDENT: STUDENT_FEATURES,
  TEACHER: TEACHER_FEATURES,
  ADMIN: ADMIN_FEATURES,
};

export function featuresForRole(role: string): FeatureDef[] {
  if (role === "STUDENT") return STUDENT_FEATURES;
  if (role === "TEACHER") return TEACHER_FEATURES;
  if (role === "ADMIN") return ADMIN_FEATURES;
  return [];
}

export type Permissions = Record<string, Record<string, boolean>>;

export function defaultPermissions(): Permissions {
  const out: Permissions = {};
  for (const role of MANAGED_ROLES) {
    out[role] = {};
    for (const f of featuresForRole(role)) {
      out[role][f.key] = true;
    }
  }
  return out;
}
