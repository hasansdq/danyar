/**
 * Password policy — enforced server-side everywhere a password is set:
 *  - admin/superadmin user create & update APIs
 *  - AI assistant action tools (create_student / create_teacher / change_password)
 *  - seed script (info only — reads env)
 *
 * Policy:
 *  - 8..128 characters
 *  - at least one lowercase + one uppercase + one digit
 *    (Persian deployments commonly use latin passwords for usernames/Passwords)
 *  - must not contain the username
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: string;
}

export function checkPasswordPolicy(
  password: string,
  context?: { username?: string },
): PasswordPolicyResult {
  if (typeof password !== "string") return { ok: false, reason: "رمز عبور نامعتبر است" };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `رمز عبور باید حداقل ${PASSWORD_MIN_LENGTH} کاراکتر باشد` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `رمز عبور نباید بیش از ${PASSWORD_MAX_LENGTH} کاراکتر باشد` };
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, reason: "رمز عبور باید شامل حرف کوچک، حرف بزرگ و عدد باشد" };
  }
  if (context?.username && context.username.length >= 3) {
    if (password.toLowerCase().includes(context.username.toLowerCase())) {
      return { ok: false, reason: "رمز عبور نباید شامل نام کاربری باشد" };
    }
  }
  return { ok: true };
}

/** Throw helper for routes that use apiHandler's error mapping. */
export function assertPasswordPolicy(
  password: string,
  context?: { username?: string },
): void {
  const res = checkPasswordPolicy(password, context);
  if (!res.ok) {
    const err = new Error(res.reason ?? "رمز عبور ضعیف است");
    (err as { status?: number; code?: string }).status = 400;
    (err as { status?: number; code?: string }).code = "BAD_REQUEST";
    throw err;
  }
}
