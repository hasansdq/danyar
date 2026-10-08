import { OtpSettingsManager } from "@/components/superadmin/otp-settings-manager";

export const dynamic = "force-dynamic";

/**
 * /superadmin/otp — «مدیریت OTP» (Phase 37).
 *
 * SUPERADMIN-only page (auth-gated by the (protected) layout) for the
 * provider-based SMS OTP system:
 *  - engine settings (TTL default 120s + per-phone/IP/device rate limits),
 *  - the four provider adapters (OTPy / Melipayamak / Faraz / SMS.ir) with
 *    write-only secrets, enable toggles + «تست اتصال»,
 *  - active provider selection,
 *  - «ارسال OTP آزمایشی» + live delivery status/log.
 *
 * Thin server component — all query/mutation logic lives in
 * {@link OtpSettingsManager} (backed by /api/superadmin/otp-settings).
 */
export default function SuperAdminOtpPage() {
  return <OtpSettingsManager />;
}
