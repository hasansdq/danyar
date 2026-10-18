import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
console.log("violationType table exists, count:", await db.violationType.count());
await db.$disconnect();
