import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Phase 28 — seed the module_attendance SiteSetting row.
  // The Prisma schema for SiteSetting has `key` as the primary key, so we
  // can upsert without a conflict. Missing rows default to `true` (module
  // enabled), but we materialize the row so the SUPERADMIN modules
  // manager can toggle it off cleanly (without the client-side fallback
  // hiding the "off" state).
  const setting = await prisma.siteSetting.upsert({
    where: { key: "module_attendance" },
    update: {},
    create: {
      key: "module_attendance",
      value: "true",
    },
  });
  console.log(
    `Seeded SiteSetting ${setting.key} = ${setting.value} (updatedAt ${setting.updatedAt.toISOString()})`,
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
