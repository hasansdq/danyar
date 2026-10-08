import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SuperAdminClassDetail } from "@/components/superadmin/superadmin-class-detail";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SuperAdminClassDetailPage({
  params,
}: Props) {
  const { id } = await params;

  // Verify class exists server-side before rendering the client component.
  const cls = await db.classRoom.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!cls) {
    notFound();
  }

  return <SuperAdminClassDetail classId={id} />;
}
