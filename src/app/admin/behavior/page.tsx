import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The "نمرات رفتاری" (behavior marks) feature has been removed from the
 * platform. Redirect any stray navigation to the admin dashboard.
 */
export default function AdminBehaviorPage() {
  redirect("/admin");
}
