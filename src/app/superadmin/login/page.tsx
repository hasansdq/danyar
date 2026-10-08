"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
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
import { Crown, Loader2, LogIn, ArrowRight, ArrowLeft, Smartphone, MessageSquare, ShieldAlert } from "lucide-react";
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
 * SUPERADMIN-only login page.
 *
 * Distinct from the main /login — dark slate shell with emerald accents.
 *
 * Requirement C: the SUPERADMIN panel is reachable ONLY through this page.
 * Both the password and SMS providers receive `scope: "superadmin"` and the
 * server-side authorize() rejects every NON-superadmin account here (and,
 * symmetrically, rejects the superadmin account on the main /login page).
 *
 * Login methods rendered here follow the superadmin's «مدیریت ورود کاربر»
 * settings; the SMS method logs in with the superadmin's registered phone
 * (default 0913652461 — changeable in the panel).
 */
export default function SuperAdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // «مدیریت ورود کاربر» — login-method availability.
  const [options, setOptions] = useState<LoginOptions | null>(null);
  const [loginMode, setLoginMode] = useState<"credentials" | "sms">("credentials");

  // SMS OTP state.
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [testCode, setTestCode] = useState<string | null>(null);
  const [testTtl, setTestTtl] = useState<number | null>(null);

  const passwordEnabled = options?.passwordEnabled ?? true;
  const smsEnabled = options?.smsEnabled ?? false;

  // Load login-method availability.
  useEffect(() => {
    fetch("/api/auth/login-options")
      .then((r) => r.json())
      .then((d: LoginOptions) => {
        setOptions(d);
        if (!d.passwordEnabled && d.smsEnabled) setLoginMode("sms");
      })
      .catch(() => setOptions({ passwordEnabled: true, smsEnabled: false }));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

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
      // scope: "superadmin" — the server only authenticates the SUPERADMIN
      // account through this page.
      const res = await signIn<"credentials">("credentials", {
        username: u,
        password: p,
        scope: "superadmin",
        redirect: false,
      });

      if (!res || res.error || !res.ok) {
        // Distinguish "non-superadmin account on this page" (server
        // rejected it by scope) from a wrong password.
        let isSuperadmin: boolean | null = null;
        try {
          const pre = await apiFetch<LoginOptions>("/api/auth/login-options", {
            method: "POST",
            body: JSON.stringify({ username: u }),
          });
          isSuperadmin = !!pre?.isSuperadmin;
        } catch {
          /* fall back to the generic error */
        }
        if (isSuperadmin === false) {
          toast({
            title: "دسترسی غیرمجاز",
            description: "این ورود مخصوص مدیر کل است. لطفاً از صفحه ورود اصلی استفاده کنید.",
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

      // Fetch session to learn the role (defense in depth — the server-side
      // scope check above already guarantees SUPERADMIN here).
      const r = await fetch("/api/auth/session");
      const data = await r.json();
      const role = data?.user?.role as string | undefined;

      if (role !== "SUPERADMIN") {
        toast({
          title: "دسترسی غیرمجاز",
          description: "این ورود مخصوص مدیر کل است.",
          variant: "destructive",
        });
        // Sign the non-superadmin user out so the dashboard auth-gate stays clean.
        await signOut({ redirect: false });
        setSubmitting(false);
        return;
      }

      toast({
        title: "خوش آمدید",
        description: `${data?.user?.name ?? "مدیر کل"} عزیز، با موفقیت وارد شدید.`,
      });
      router.replace("/superadmin");
      router.refresh();
    } catch (err) {
      toast({
        title: "خطای سرور",
        description: (err as Error)?.message || "خطای غیرمنتظره‌ای رخ داد.",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }

  // SMS OTP login — sends the code to the superadmin's registered phone.
  async function handleSendOTP(e: FormEvent) {
    e.preventDefault();
    if (sendingOtp) return;
    const p = phone.trim();
    if (!p) {
      toast({ title: "خطا", description: "شماره موبایل مدیر کل را وارد کنید.", variant: "destructive" });
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

  // SMS OTP login — verify + sign in with scope "superadmin".
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
        toast({ title: "ورود ناموفق", description: err?.message || "کد نامعتبر است یا منقضی شده.", variant: "destructive" });
        setSubmitting(false);
        return;
      }

      const res = await signIn("sms", {
        phone: p,
        otp: o,
        scope: "superadmin",
        redirect: false,
      });
      if (!res || res.error || !res.ok) {
        toast({
          title: "ورود ناموفق",
          description: "شماره موبایل متعلق به حساب مدیر کل نیست یا کد نامعتبر است.",
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }

      toast({ title: "خوش آمدید", description: "با موفقیت وارد شدید." });
      router.replace("/superadmin");
      router.refresh();
    } catch (err: any) {
      toast({ title: "خطای سرور", description: err?.message || "خطای غیرمنتظره.", variant: "destructive" });
      setSubmitting(false);
    }
  }

  return (
    <div className="relative bg-background text-foreground flex min-h-screen flex-col items-center justify-center px-4 py-10">
      {/* Theme toggle — pinned to the visually top-left corner in RTL.
          On the slate shell we want slate-emerald button styling. */}
      <div className="absolute left-4 top-4 z-10">
        <ThemeToggle className="size-9 text-foreground hover:bg-muted hover:text-emerald-500" />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500 shadow-md ring-1 ring-emerald-500/30">
            <Crown className="size-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">دانیار · مدیر کل</h1>
          <p className="text-muted-foreground text-sm">
            ورود مخصوص مدیر ارشد سامانه — کنترل کامل نقش‌ها و دسترسی‌ها
          </p>
        </div>

        <Card className="border-border bg-card/70 text-foreground shadow-xl backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">ورود به حساب مدیر کل</CardTitle>
            <CardDescription className="text-muted-foreground">
              {loginMode === "credentials"
                ? "برای ادامه، نام کاربری و رمز عبور مدیر کل را وارد کنید."
                : "شماره موبایل ثبت‌شده مدیر کل را وارد کنید تا کد تایید صادر شود."}
            </CardDescription>
          </CardHeader>

          {/* Login method toggle (credentials ↔ SMS OTP). */}
          {passwordEnabled && smsEnabled && (
            <div className="flex gap-1 border-b border-border px-6 pb-3">
              <button
                type="button"
                onClick={() => setLoginMode("credentials")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  loginMode === "credentials"
                    ? "bg-emerald-600 text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-emerald-500"
                }`}
              >
                <LogIn className="size-4" />
                نام کاربری
              </button>
              <button
                type="button"
                onClick={() => setLoginMode("sms")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  loginMode === "sms"
                    ? "bg-emerald-600 text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-emerald-500"
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
                غیرفعال است. لطفاً از «ورود پیامکی» با شماره موبایل مدیر کل
                استفاده کنید.
              </p>
            </div>
          )}

          {loginMode === "credentials" && passwordEnabled ? (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-foreground">
                  نام کاربری
                </Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  dir="ltr"
                  placeholder="superadmin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={submitting}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground text-left focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground">
                  رمز عبور
                </Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground text-left focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button
                type="submit"
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-500 text-white w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    در حال ورود…
                  </>
                ) : (
                  <>
                    <LogIn className="size-4" />
                    ورود به پنل
                  </>
                )}
              </Button>
            </CardFooter>
          </form>
          ) : smsEnabled ? (
          /* SMS OTP login form (superadmin's registered phone). */
          <form onSubmit={handleSMSLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-foreground">
                  شماره موبایل مدیر کل
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  dir="ltr"
                  placeholder="09xxxxxxxxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={submitting || sendingOtp || otpSent}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground text-left focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  شماره موبایل ثبت‌شده مدیر کل را وارد کنید (قابل تغییر در بخش
                  «مدیریت ورود کاربر» پنل).
                </p>
              </div>
              {!otpSent ? (
                <Button
                  type="button"
                  onClick={handleSendOTP}
                  disabled={sendingOtp}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white w-full"
                >
                  {sendingOtp ? (
                    <><Loader2 className="size-4 animate-spin" /> در حال ارسال کد…</>
                  ) : (
                    <><MessageSquare className="size-4" /> ارسال کد تایید</>
                  )}
                </Button>
              ) : (
                <div className="space-y-2">
                  {/* TEST MODE code display (managed by «مدیریت ورود کاربر»). */}
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
                  <Label htmlFor="otp" className="text-foreground">
                    کد تایید ۶ رقمی
                  </Label>
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
                    className="bg-background border-border text-foreground text-center text-lg tracking-widest focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => { setOtpSent(false); setOtp(""); setTestCode(null); }}
                    disabled={submitting}
                    className="text-xs text-emerald-500 hover:underline disabled:opacity-50"
                  >
                    تغییر شماره موبایل
                  </button>
                </div>
              )}
            </CardContent>
            {otpSent && (
              <CardFooter>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white w-full"
                >
                  {submitting ? (
                    <><Loader2 className="size-4 animate-spin" /> در حال ورود…</>
                  ) : (
                    <><LogIn className="size-4" /> ورود به پنل</>
                  )}
                </Button>
              </CardFooter>
            )}
          </form>
          ) : null}
        </Card>

        <div className="mt-6 rounded-lg border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground">
          <p className="leading-relaxed">
            این ورود فقط برای حسابی با نقش <code dir="ltr">SUPERADMIN</code> مجاز
            است. سایر کاربران (دانش‌آموز / معلم / مدیر) باید از{" "}
            <Link
              href="/login"
              className="text-emerald-500 hover:underline"
            >
              صفحه ورود اصلی
            </Link>{" "}
            استفاده کنند.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-between text-xs">
          <Link
            href="/login"
            className="text-muted-foreground hover:text-emerald-500 inline-flex items-center gap-1 transition-colors"
          >
            <ArrowRight className="size-3.5" />
            صفحه ورود اصلی
          </Link>
          <Link
            href="/"
            className="text-muted-foreground hover:text-emerald-500 inline-flex items-center gap-1 transition-colors"
          >
            بازگشت به سایت
            <ArrowLeft className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
