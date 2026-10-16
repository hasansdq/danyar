// ─────────────────────────────────────────────────────────────────────────────
// verify-group-lock-migration.ts — اثبات سلامت دو مسیر استقرار مهاجرت قفل گروه
//   مسیر ۱ (استقرار تازه): زنجیره کامل مهاجرت‌ها باید دقیقاً schema زنده (db/custom.db)
//                          را بازتولید کند — بدون هیچ تفاوت ساختاری
//   مسیر ۲ (ارتقا): دیتابیس در وضعیت classroom_capacity + داده → اعمال مهاجرت جدید
//                          → داده حفظ + ستون lockedForStudents اضافه + schema کامل
// اجرا: bun scripts/verify-group-lock-migration.ts
// ─────────────────────────────────────────────────────────────────────────────
import { Database } from "bun:sqlite";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const MIGDIR = join(ROOT, "prisma/migrations");
const LIVE = join(ROOT, "db/custom.db");
const NEW_MIG = "20261015090000_group_lock";

const migDirs = readdirSync(MIGDIR)
  .filter((d) => /^\d{14}_/.test(d))
  .sort();
console.log("migrations:", migDirs.join(", "));

function replayChain(target: string, dirs: string[]) {
  const db = new Database(target);
  for (const d of dirs) {
    const sql = readFileSync(join(MIGDIR, d, "migration.sql"), "utf8");
    db.exec(sql);
  }
  db.close();
}

// ─── مسیر ۱: استقرار تازه ───
const fresh = "/tmp/verify-fresh.db";
rmf(fresh);
replayChain(fresh, migDirs);
const d1 = diff(fresh, LIVE);
console.log(isEmptyDiff(d1) ? "✔ مسیر ۱: زنجیره کامل == schema دیتابیس زنده (بدون تفاوت)" : "✘ مسیر ۱ تفاوت دارد:\n" + d1.slice(0, 800));

// ─── مسیر ۲: ارتقا از وضعیت قبل از مهاجرت جدید ───
const upg = "/tmp/verify-upg.db";
rmf(upg);
const before = migDirs.filter((d) => d !== NEW_MIG);
replayChain(upg, before);
{
  const db = new Database(upg);
  const hasCol = db.prepare("SELECT count(*) c FROM pragma_table_info('SubjectGroup') WHERE name='lockedForStudents'").get() as any;
  db.prepare("INSERT INTO SubjectGroup (id, name, messagePolicy, updatedAt) VALUES ('t1','گروه آزمون','ALL',datetime('now'))").run();
  db.prepare("INSERT INTO SubjectGroup (id, name, messagePolicy, updatedAt) VALUES ('t2','گروه قفل','ALL',datetime('now'))").run();
  db.close();
  console.log(`  قبل از مهاجرت: ستون lockedForStudents = ${hasCol.c} (انتظار ۰)`);
  // اعمال مهاجرت جدید (عین کار prisma migrate deploy)
  const db2 = new Database(upg);
  db2.exec("PRAGMA foreign_keys=OFF");
  db2.exec(readFileSync(join(MIGDIR, NEW_MIG, "migration.sql"), "utf8"));
  db2.exec("PRAGMA foreign_keys=ON");
  db2.close();
}
{
  const db = new Database(upg);
  const rows = db.prepare("SELECT id, name, lockedForStudents FROM SubjectGroup ORDER BY id").all() as any[];
  console.log(`  پس از مهاجرت: ${rows.length} ردیف، نمونه:`, rows.map((r) => `${r.id}(locked=${r.lockedForStudents})`).join(" "));
  const cnt = db.prepare("SELECT count(*) c FROM SubjectGroup").get() as any;
  const okData = rows.length === 2 && rows.every((r) => r.lockedForStudents === 0 && cnt.c === 2);
  db.close();
  console.log(okData ? "✔ مسیر ۲: داده‌ها حفظ شدند و ستون قفل با پیش‌فرض false اضافه شد" : "✘ مسیر ۲: مشکل داده!");
  if (!okData) process.exit(1);
}
// schema پس از ارتقا باید با schema زنده یکی باشد
const d2 = diff(upg, LIVE);
console.log(isEmptyDiff(d2) ? "✔ مسیر ۲: ساختار پس از ارتقا == schema دیتابیس زنده" : "✘ مسیر ۲ تفاوت ساختاری دارد:\n" + d2.slice(0, 800));

function isEmptyDiff(s: string): boolean {
  const t = s.trim();
  return t === "" || t.endsWith("This is an empty migration.");
}

function diff(a: string, b: string): string {
  const p = Bun.spawnSync([
    "bunx", "prisma", "migrate", "diff",
    "--from-url", `file:${a}`,
    "--to-url", `file:${b}`,
    "--exit-code", "--script",
  ], { cwd: ROOT });
  return p.stdout.toString();
}
function rmf(p: string) { try { require("node:fs").unlinkSync(p); } catch {} }
