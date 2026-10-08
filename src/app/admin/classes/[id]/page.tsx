import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { ClassDetail } from "@/components/admin/class-detail";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ClassDetailPage({ params }: Props) {
  const { id } = await params;

  // Verify class exists server-side before rendering the client component.
  // (The actual data fetching happens client-side via the API.)
  const cls = await db.classRoom.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!cls) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <ClassDetail classId={id} />
    </Suspense>
  );
}
