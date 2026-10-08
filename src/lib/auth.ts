import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { verifyOTP, normalizePhone, isValidIranPhone } from "@/lib/sms/otp";
import { isPasswordLoginEnabled, isSMSLoginEnabled } from "@/lib/login-settings";
import { getNextAuthSecret } from "@/lib/env";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { audit, AuditActions } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Login page scope (requirement: the SUPERADMIN account may ONLY sign in
// from /superadmin/login; /login serves everyone else).
// The login pages pass an extra `scope` field through signIn():
//   - /superadmin/login → scope: "superadmin"
//   - /login            → scope: "public" (or absent)
// authorize() enforces the matrix server-side:
//   scope "superadmin"  → the account MUST be SUPERADMIN
//   scope "public"/none → the account must NOT be SUPERADMIN
// ---------------------------------------------------------------------------
function readLoginScope(credentials: Record<string, unknown> | undefined): "public" | "superadmin" {
  return credentials?.scope === "superadmin" ? "superadmin" : "public";
}

// ---------------------------------------------------------------------------
// Login brute-force protection (per-username failed-attempt lockout).
// NOTE: authorize() has no request object → per-IP limits are enforced in
// src/proxy.ts for POST /api/auth/callback/*; this layer locks the TARGET
// ACCOUNT so distributed attacks against one account are also stopped.
// ---------------------------------------------------------------------------
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const failureBuckets = new Map<string, { count: number; lockedUntil: number }>();

function isLocked(username: string): boolean {
  const b = failureBuckets.get(username);
  if (!b) return false;
  if (b.lockedUntil > Date.now()) return true;
  if (b.lockedUntil !== 0 && b.lockedUntil <= Date.now()) failureBuckets.delete(username);
  return false;
}

function recordFailure(username: string): void {
  const b = failureBuckets.get(username) ?? { count: 0, lockedUntil: 0 };
  b.count += 1;
  if (b.count >= LOGIN_MAX_FAILURES) {
    b.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
  }
  failureBuckets.set(username, b);
}

function clearFailures(username: string): void {
  failureBuckets.delete(username);
}

// Periodic cleanup so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of failureBuckets) {
    if (b.lockedUntil !== 0 && b.lockedUntil <= now) failureBuckets.delete(k);
  }
}, 60_000).unref?.();

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials.password) {
          return null;
        }
        const username = credentials.username.trim().toLowerCase();
        // NEVER log the password.
        if (isLocked(username)) {
          await audit({
            actorUsername: username,
            action: AuditActions.LOGIN_LOCKOUT,
            meta: { reason: "too many failed attempts" },
          });
          return null;
        }
        // "مدیریت ورود کاربر": password login can be disabled platform-wide
        // by the superadmin. Fail-open on read errors so a DB hiccup can
        // never lock everyone out of the app.
        if (!(await isPasswordLoginEnabled())) {
          await audit({
            actorUsername: username,
            action: AuditActions.LOGIN_FAILURE,
            meta: { reason: "password login disabled by superadmin" },
          });
          return null;
        }
        const user = await db.user.findUnique({
          where: { username },
        });
        if (!user) {
          recordFailure(username);
          await audit({ actorUsername: username, action: AuditActions.LOGIN_FAILURE });
          return null;
        }
        // Scope enforcement (server-side): SUPERADMIN may ONLY authenticate
        // through the /superadmin/login page; every other account signs in
        // through /login.
        const scope = readLoginScope(credentials as Record<string, unknown> | undefined);
        if (scope === "superadmin" && user.role !== "SUPERADMIN") {
          await audit({
            actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId },
            action: AuditActions.LOGIN_FAILURE,
            meta: { reason: "non-superadmin attempted the superadmin login page" },
          });
          return null;
        }
        if (scope !== "superadmin" && user.role === "SUPERADMIN") {
          await audit({
            actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId },
            action: AuditActions.LOGIN_FAILURE,
            meta: { reason: "superadmin login blocked on the main /login page" },
          });
          return null;
        }
        const ok = await bcrypt.compare(credentials.password, user.password);
        if (!ok) {
          recordFailure(username);
          await audit({
            actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId },
            action: AuditActions.LOGIN_FAILURE,
          });
          return null;
        }
        clearFailures(username);
        await audit({
          actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId },
          action: AuditActions.LOGIN_SUCCESS,
        });
        return {
          id: user.id,
          name: user.fullName,
          role: user.role as "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN",
          username: user.username,
          schoolId: user.schoolId,
        };
      },
    }),
    // Phase 36k — SMS OTP login provider (modular). Active whenever the
    // superadmin enables SMS login in «مدیریت ورود کاربر» — test mode works
    // WITHOUT a real SMS provider (the code is displayed on the login page).
    CredentialsProvider({
      id: "sms",
      name: "sms-otp",
      credentials: {
        phone: { label: "Phone", type: "tel" },
        otp: { label: "OTP Code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.phone || !credentials?.otp) return null;
        // Brute-force guard: OTP verify attempts are also rate-limited
        // per-phone (in addition to the per-code attempt counter in otp.ts).
        const rl = rateLimit(`otp-verify:${normalizePhone(credentials.phone)}`, {
          limit: 10,
          windowMs: 10 * 60 * 1000,
        });
        if (!rl.ok) return null;
        // "مدیریت ورود کاربر": SMS login can be disabled platform-wide.
        if (!(await isSMSLoginEnabled())) return null;
        const phone = normalizePhone(credentials.phone);
        if (!isValidIranPhone(phone)) return null;
        // Scope: the SUPERADMIN's phone may ONLY be used on /superadmin/login;
        // everyone else signs in via /login.
        const scope = readLoginScope(credentials as Record<string, unknown> | undefined);
        // Verify the OTP code (Phase 37: DB-backed hash storage, one-time-use,
        // configurable TTL + attempt cap — see src/lib/sms/otp.ts). NEVER log
        // the code.
        const verdict = await verifyOTP(phone, credentials.otp.trim());
        if (!verdict.ok) {
          await audit({
            actorUsername: phone,
            action: "OTP_LOGIN_FAILURE",
            meta: { reason: verdict.reason },
          });
          return null;
        }
        // Look up the user by phone number.
        // SECURITY: `phone` is not unique in the schema — when more than one
        // account shares the phone, OTP login is REJECTED (ambiguous target)
        // instead of silently logging into the earliest account.
        const users = await db.user.findMany({
          where: { phone },
          select: { id: true, fullName: true, role: true, username: true, schoolId: true },
        });
        if (users.length !== 1) return null;
        const user = users[0];
        if (scope === "superadmin" && user.role !== "SUPERADMIN") {
          await audit({
            actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId },
            action: "OTP_LOGIN_FAILURE",
            meta: { reason: "non-superadmin phone on the superadmin login page" },
          });
          return null;
        }
        if (scope !== "superadmin" && user.role === "SUPERADMIN") {
          await audit({
            actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId },
            action: "OTP_LOGIN_FAILURE",
            meta: { reason: "superadmin phone blocked on the main /login page" },
          });
          return null;
        }
        await audit({
          actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId },
          action: AuditActions.OTP_LOGIN_SUCCESS,
        });
        return {
          id: user.id,
          name: user.fullName,
          role: user.role as "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN",
          username: user.username,
          schoolId: user.schoolId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.username = (user as any).username;
        token.schoolId = (user as any).schoolId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).username = token.username;
        (session.user as any).schoolId = token.schoolId ?? null;
      }
      return session;
    },
  },
  // SECURITY: no hardcoded fallback — getNextAuthSecret() throws in
  // production when NEXTAUTH_SECRET is missing/weak (see src/lib/env.ts).
  secret: getNextAuthSecret(),
};
