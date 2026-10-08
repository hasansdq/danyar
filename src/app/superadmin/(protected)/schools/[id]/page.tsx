import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSuperAdminOrRedirect } from "@/lib/session";
import { SuperAdminSchoolDetail } from "@/components/superadmin/superadmin-school-detail";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SuperAdminSchoolDetailPage({
  params,
}: Props) {
  await requireSuperAdminOrRedirect();

  const { id } = await params;

  // Verify the school exists server-side before rendering the client component.
  const school = await db.school.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!school) {
    notFound();
  }

  return <SuperAdminSchoolDetail schoolId={id} />;
}
