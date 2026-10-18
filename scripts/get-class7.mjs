import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
const db = new PrismaClient();
const c = await db.classroom.findFirst({ where: { name: { contains: "هفتم۱" } } });
writeFileSync("/tmp/class7id.txt", c.id);
console.log("class7:", c.id);
await db.$disconnect();
