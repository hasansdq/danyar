// Seed 3 schools with principals, teachers, and students
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const pass = await bcrypt.hash("test1234", 10);
  const principalPass = await bcrypt.hash("principal123", 10);

  const schools = [
    { name: "مدرسه امام رضا (ع)", address: "تهران، خیابان ولیعصر" },
    { name: "مدرسه شهید بهشتی", address: "تهران، خیابان آزادی" },
    { name: "مدرسه فارابی", address: "تهران، خیابان انقلاب" },
  ];

  for (let s = 0; s < schools.length; s++) {
    const schoolData = schools[s];
    const school = await prisma.school.upsert({
      where: { name: schoolData.name },
      update: { address: schoolData.address },
      create: { name: schoolData.name, address: schoolData.address },
    });

    // Principal
    const principalUsername = `principal${s + 1}`;
    const principal = await prisma.user.upsert({
      where: { username: principalUsername },
      update: { schoolId: school.id },
      create: {
        username: principalUsername,
        password: principalPass,
        role: "ADMIN",
        fullName: `مدیر مدرسه ${s + 1}`,
        schoolId: school.id,
      },
    });
    await prisma.school.update({
      where: { id: school.id },
      data: { principalId: principal.id },
    });

    // 5 Teachers
    for (let t = 1; t <= 5; t++) {
      const tu = `school${s + 1}_teacher${t}`;
      await prisma.user.upsert({
        where: { username: tu },
        update: { schoolId: school.id },
        create: {
          username: tu,
          password: pass,
          role: "TEACHER",
          fullName: `معلم ${t} مدرسه ${s + 1}`,
          schoolId: school.id,
        },
      });
    }

    // 20 Students
    for (let st = 1; st <= 20; st++) {
      const su = `school${s + 1}_student${st}`;
      await prisma.user.upsert({
        where: { username: su },
        update: { schoolId: school.id },
        create: {
          username: su,
          password: pass,
          role: "STUDENT",
          fullName: `دانش‌آموز ${st} مدرسه ${s + 1}`,
          schoolId: school.id,
        },
      });
    }
  }

  const count = await prisma.school.count();
  const userCount = await prisma.user.count();
  console.log(`✅ Seeded ${count} schools with ${userCount} total users`);
  console.log("Principals: principal1/2/3 (password: principal123)");
  console.log("Teachers: schoolN_teacherT (password: test1234)");
  console.log("Students: schoolN_studentS (password: test1234)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
