"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, GraduationCap, LogIn, Eye, EyeOff, Smartphone, MessageSquare, Crown, ShieldAlert } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiFetch } from "@/lib/api-fetch";

/** Shape returned by the public /api/auth/login-options endpoint. */
interface LoginOptions {
  passwordEnabled: boolean;
  smsEnabled: boolean;
  isSuperadmin?: boolean;
}

/** Response of POST /api/auth/sms/request in test mode. */
interface SMSRequestResponse {
  ok: boolean;
  sent: boolean;
  testMode?: boolean;
  testCode?: string;
  /** True when the still-active code was re-displayed (not regenerated). */
  reused?: boolean;
  /** Effective code validity in seconds («مدیریت OTP» — default 120). */
  ttlSeconds?: number;
}

/**
 * Login page (Persian RTL) — the login page for EVERYONE EXCEPT the
 * superadmin (the SUPERADMIN account signs in only at /superadmin/login;
 * the server-side authorize() enforces this and this page explains it).
 *
 * Which login methods are rendered is controlled by the superadmin's
 * «مدیریت ورود کاربر» settings (password / SMS / test-code display).
 *
 * On success: redirect to the messenger home (/).
 */
export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Phase 25 — password visibility toggle state.
  const [showPassword, setShowPassword] = useState(false);

  // «مدیریت ورود کاربر» — live login-method availability.
  const [options, setOptions] = useState<LoginOptions | null>(null);
  // Set when a SUPERADMIN account tries to sign in here (requirement C).
  const [superadminBlocked, setSuperadminBlocked] = useState(false);

  // Phase 36k — SMS OTP login state.
  const [loginMode, setLoginMode] = useState<"credentials" | "sms">("credentials");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  // «مدیریت ورود کاربر» — the TEST code returned by the server (displayed
  // prominently + prefilled into the OTP input).
  const [testCode, setTestCode] = useState<string | null>(null);
  const [testTtl, setTestTtl] = useState<number | null>(null);

  const passwordEnabled = options?.passwordEnabled ?? true;
  const smsEnabled = options?.smsEnabled ?? false;

  // Load login-method availability (managed by the superadmin).
  useEffect(() => {
    fetch("/api/auth/login-options")
      .then((r) => r.json())
      .then((d: LoginOptions) => {
        setOptions(d);
        // Default to the first AVAILABLE method.
        if (!d.passwordEnabled && d.smsEnabled) setLoginMode("sms");
      })
      .catch(() => setOptions({ passwordEnabled: true, smsEnabled: false }));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSuperadminBlocked(false);

    const u = username.trim().toLowerCase();
    const p = password;
    if (!u || !p) {
      toast({
        title: "خطا",
        description: "نام کاربری و رمز عبور را وارد کنید.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      // scope: "public" tells the server this sign-in comes from the MAIN
      // login page — SUPERADMIN accounts are rejected here server-side.
      const res = await signIn<"credentials">("credentials", {
        username: u,
        password: p,
        scope: "public",
        redirect: false,
      });

      if (!res || res.error || !res.ok) {
        // Distinguish "superadmin on the wrong page" from a wrong password
        // so the user gets a precise, actionable message.
        let isSuperadmin = false;
        try {
          const pre = await apiFetch<LoginOptions>("/api/auth/login-options", {
            method: "POST",
            body: JSON.stringify({ username: u }),
          });
          isSuperadmin = !!pre?.isSuperadmin;
        } catch {
          /* fall back to the generic error */
        }
        if (isSuperadmin) {
          setSuperadminBlocked(true);
          toast({
            title: "ورود مدیر کل",
            description:
              "ورود حساب مدیر کل فقط از صفحه «ورود مدیر کل» امکان‌پذیر است.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "ورود ناموفق",
            description: "نام کاربری یا رمز عبور اشتباه است.",
            variant: "destructive",
          });
        }
        setSubmitting(false);
        return;
      }

      // Fetch the session to learn the role, then redirect.
      try {
        const r = await fetch("/api/auth/session");
        const data = await r.json();
        toast({
          title: "خوش آمدید",
          description: `${data?.user?.name ?? ""} عزیز، با موفقیت وارد شدید.`,
        });
        // Phase 35g: ADMIN (school principal) should land on the messenger
        // (/) — NOT the admin panel. They can access the admin panel via
        // the "پنل مدیریت" button in the messenger's bottom nav. Only
        // SUPERADMIN is redirected to /superadmin (handled by page.tsx).
        router.replace("/");
        router.refresh();
      } catch {
        // Fall back to home if session fetch fails for some reason.
        router.replace("/");
        router.refresh();
      }
    } catch (err: any) {
      toast({
        title: "خطای سرور",
        description: err?.message || "خطای غیرمنتظره‌ای رخ داد.",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }

  // SMS OTP login: send the OTP code to the user's phone.
  async function handleSendOTP(e: FormEvent) {
    e.preventDefault();
    if (sendingOtp) return;
    const p = phone.trim();
    if (!p) {
      toast({ title: "خطا", description: "شماره موبایل را وارد کنید.", variant: "destructive" });
      return;
    }
    setSendingOtp(true);
    try {
      const res = await apiFetch<SMSRequestResponse>('/api/auth/sms/request', {
        method: 'POST',
        body: JSON.stringify({ phone: p }),
      });
      if (res.sent) {
        setOtpSent(true);
        if (res.testMode && res.testCode) {
          // TEST MODE — the server returned the code so it can be displayed
          // (managed by «مدیریت ورود کاربر» → نمایش کد ورود تستی).
          setTestCode(res.testCode);
          setTestTtl(typeof res.ttlSeconds === "number" ? res.ttlSeconds : null);
          setOtp(res.testCode);
          toast({
            title: res.reused
              ? "کد فعال مجدداً نمایش داده شد"
              : "کد ورود تستی صادر شد",
            description: `کد ورود تستی: ${res.testCode}`,
          });
        } else {
          setTestCode(null);
          toast({ title: "کد ارسال شد", description: `کد ۶ رقمی به شماره ${p} پیامک شد.` });
        }
      } else {
        toast({ title: "خطا", description: "ارسال پیامک ناموفق بود یا شماره یافت نشد.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "خطا", description: err?.message || "خطای غیرمنتظره.", variant: "destructive" });
    } finally {
      setSendingOtp(false);
    }
  }

  // SMS OTP login: pre-validate via /api/auth/sms/verify (gives precise
  // Persian errors for unregistered phones in test mode), then sign in via
  // the "sms" provider.
  async function handleSMSLogin(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const p = phone.trim();
    const o = otp.trim();
    if (!p || !o) {
      toast({ title: "خطا", description: "شماره موبایل و کد را وارد کنید.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      try {
        await apiFetch<{ ok: boolean }>("/api/auth/sms/verify", {
          method: "POST",
          body: JSON.stringify({ phone: p, otp: o }),
        });
      } catch (err: any) {
        // Precise error from the pre-check (e.g. unregistered phone).
        toast({ title: "ورود ناموفق", description: err?.message || "کد نامعتبر است یا منقضی شده.", variant: "destructive" });
        setSubmitting(false);
        return;
      }

      const res = await signIn("sms", {
        phone: p,
        otp: o,
        scope: "public",
        redirect: false,
      });
      if (!res || res.error || !res.ok) {
        toast({ title: "ورود ناموفق", description: "کد نامعتبر است یا منقضی شده.", variant: "destructive" });
        setSubmitting(false);
        return;
      }
      toast({ title: "خوش آمدید", description: "با موفقیت وارد شدید." });
      router.replace("/");
      router.refresh();
    } catch (err: any) {
      toast({ title: "خطای سرور", description: err?.message || "خطای غیرمنتظره.", variant: "destructive" });
      setSubmitting(false);
    }
  }

  const bothDisabled = !passwordEnabled && !smsEnabled;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-secondary/40 to-background px-4 py-10">
      {/* Theme toggle — pinned to the visually top-left corner in RTL. */}
      <div className="absolute left-4 top-4 z-10">
        <ThemeToggle className="size-9" />
      </div>

      <div className="w-full max-w-md animate-fade-in-up">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-2xl shadow-md">
            <GraduationCap className="size-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">دانیار</h1>
          <p className="text-sm text-muted-foreground">سامانه آموزشی مدارس</p>
          <p className="text-muted-foreground text-sm">
            سامانه آموزشی کلاس، تکالیف، نمرات و ارتباط با استاد
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">ورود به حساب کاربری</CardTitle>
            <CardDescription>
              {loginMode === "credentials"
                ? "برای ادامه، نام کاربری و رمز عبور خود را وارد کنید."
                : "شماره موبایل خود را وارد کنید تا کد تایید برای شما پیامک شود."}
            </CardDescription>
          </CardHeader>

          {/* Login method toggle (credentials ↔ SMS OTP) — tabs shown only
              when BOTH methods are enabled. */}
          {passwordEnabled && smsEnabled && (
            <div className="flex gap-1 border-b px-6 pb-3">
              <button
                type="button"
                onClick={() => setLoginMode("credentials")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  loginMode === "credentials" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <LogIn className="size-4" />
                نام کاربری
              </button>
              <button
                type="button"
                onClick={() => setLoginMode("sms")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  loginMode === "sms" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <Smartphone className="size-4" />
                ورود پیامکی
              </button>
            </div>
          )}

          {/* «مدیریت ورود کاربر» — password login disabled notice. */}
          {!passwordEnabled && smsEnabled && (
            <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <p className="leading-relaxed">
                ورود با نام کاربری و رمز عبور در حال حاضر توسط مدیر کل
                غیرفعال است. لطفاً از «ورود پیامکی» استفاده کنید.
              </p>
            </div>
          )}

          {/* Both login methods disabled — shouldn't normally happen (the
              backend rejects disabling both), shown defensively. */}
          {bothDisabled && (
            <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <p className="leading-relaxed">
                ورود به سیستم در حال حاضر توسط مدیر کل غیرفعال است. لطفاً
                بعداً مراجعه کنید.
              </p>
            </div>
          )}

          {/* Requirement C — a SUPERADMIN account tried to sign in here. */}
          {superadminBlocked && (
            <div
              className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"
              role="alert"
            >
              <Crown className="mt-0.5 size-4 shrink-0" />
              <p className="leading-relaxed">
                ورود حساب <strong>مدیر کل</strong> از این صفحه امکان‌پذیر
                نیست. لطفاً از{" "}
                <Link
                  href="/superadmin/login"
                  className="font-medium underline underline-offset-2"
                >
                  صفحه ورود مدیر کل
                </Link>{" "}
                استفاده کنید.
              </p>
            </div>
          )}

          {passwordEnabled && (loginMode === "credentials" || !smsEnabled) ? (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">نام کاربری</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  dir="ltr"
                  placeholder="نام کاربری خود را وارد کنید"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={submitting}
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">رمز عبور</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    dir="ltr"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    className="text-left pl-10"
                  />
                  {/* Phase 25 — password reveal toggle. The button is
                      positioned at the start (left in LTR / visually left
                      in RTL since the input is dir=ltr) so it doesn't
                      overlap the typed text. Uses Eye/EyeOff icons. */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={submitting}
                    className="absolute left-2 top-1/2 -translate-y-1/2 inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    aria-label={showPassword ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"}
                    title={showPassword ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                {/* Phase 25 — hint about the reveal toggle + a quick "show"
                    affordance below for discoverability on touch devices. */}
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>برای مشاهده رمز عبور روی چشم کلیک کنید</span>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={submitting}
                    className="text-primary hover:underline disabled:opacity-50"
                  >
                    {showPassword ? "پنهان کردن" : "نمایش رمز"}
                  </button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    در حال ورود…
                  </>
                ) : (
                  <>
                    <LogIn className="size-4" />
                    ورود
                  </>
                )}
              </Button>
            </CardFooter>
          </form>
          ) : smsEnabled ? (
          /* SMS OTP login form. */
          <form onSubmit={handleSMSLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">شماره موبایل</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  dir="ltr"
                  placeholder="09123456789"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={submitting || sendingOtp || otpSent}
                  className="text-left"
                />
              </div>
              {!otpSent ? (
                <Button
                  type="button"
                  onClick={handleSendOTP}
                  disabled={sendingOtp}
                  className="w-full"
                >
                  {sendingOtp ? (
                    <><Loader2 className="size-4 animate-spin" /> در حال ارسال کد…</>
                  ) : (
                    <><MessageSquare className="size-4" /> ارسال کد تایید</>
                  )}
                </Button>
              ) : (
                <div className="space-y-2">
                  {/* «مدیریت ورود کاربر» — TEST MODE code display. The
                      superadmin's test-code toggle makes the OTP visible
                      right here so members can log in without a real SMS
                      gateway. */}
                  {testCode && (
                    <div
                      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-center"
                      role="status"
                    >
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                        کد ورود تستی (حالت آزمایشی):
                      </p>
                      <p
                        className="mt-1 font-mono text-2xl font-bold tracking-[0.35em] text-amber-700 dark:text-amber-300"
                        dir="ltr"
                      >
                        {testCode}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        این کد به‌صورت آزمایشی نمایش داده می‌شود و{" "}
                        {testTtl ? `${testTtl.toLocaleString("fa-IR")} ثانیه` : "مدت محدود"}{" "}
                        اعتبار دارد.
                      </p>
                    </div>
                  )}
                  <Label htmlFor="otp">کد تایید ۶ رقمی</Label>
                  <Input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    dir="ltr"
                    maxLength={6}
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    disabled={submitting}
                    className="text-center text-lg tracking-widest"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => { setOtpSent(false); setOtp(""); setTestCode(null); }}
                    disabled={submitting}
                    className="text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    تغییر شماره موبایل
                  </button>
                </div>
              )}
            </CardContent>
            {otpSent && (
              <CardFooter>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <><Loader2 className="size-4 animate-spin" /> در حال ورود…</>
                  ) : (
                    <><LogIn className="size-4" /> ورود</>
                  )}
                </Button>
              </CardFooter>
            )}
          </form>
          ) : null}
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          ساخته‌شده با Next.js 16 —{" "}
          <Link
            href="/"
            className="text-primary hover:underline"
          >
            رفتن به صفحه اصلی
          </Link>
        </p>
      </div>
    </div>
  );
}
