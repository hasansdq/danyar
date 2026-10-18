import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
const db = new PrismaClient();
const admin = await db.user.findUnique({ where: { username: "beheshti.admin" }, select: { id: true } });
writeFileSync("/tmp/admin-uid.txt", admin.id);
await db.$disconnect();
