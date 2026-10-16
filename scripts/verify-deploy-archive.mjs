#!/usr/bin/env node
// verify-deploy-archive.mjs
// راستی‌آزمایی: آیا download/daniar-repo-deploy.tar.gz دقیقاً برابر ریپو است؟
// ۱) هر فایل آرشیو با همتای آن در working tree مقایسهٔ sha256 می‌شود
// ۲) فایل‌های موردانتظار (git-tracked + extras) که در آرشیو نیستند گزارش می‌شوند
// ۳) گارد امنیتی: .env و فایل‌های حاوی رمز هرگز نباید در بسته باشند
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/home/z/my-project';
// استخراج در /tmp (خارج از ریپو) — دایرکتوری راستی‌آزمایی جزو ریپو/بسته نیست
const VERIFY_DIR = '/tmp/daniar-archive-verify';
const ARCHIVE = join(ROOT, 'download', 'daniar-repo-deploy.tar.gz');

// استخراج تازهٔ بسته
rmSync(VERIFY_DIR, { recursive: true, force: true });
mkdirSync(VERIFY_DIR, { recursive: true });
execSync(`tar -xzf ${ARCHIVE} -C ${VERIFY_DIR}`, { cwd: ROOT });

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// ---- 1. archive file list ----
const tarList = execSync(`tar -tzf ${ARCHIVE}`, { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((l) => l && !l.endsWith('/'));
const archiveFiles = new Set(tarList);

// ---- 2. expected set: git tracked + explicit runtime extras ----
const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

const EXCLUDE_PREFIXES = [
  'download/',           // آرشیوها و اسکرین‌شات‌ها
  'skills/',             // مهارت‌های محیطی، جزو ریپوی استقرار نیست
  'tmp-archive-verify/', // دایرکتوری راستی‌آزمایی همین اسکریپت
  'logs/',               // لاگ‌های سندباکس
  'upload/',             // مصنوعات سندباکس
  'tool-results/',       // خروجی ابزارهای جلسه
];
const EXCLUDE_FILES = new Set([
  'prisma/dev.db',       // دیتابیس صفرِ dev که نباید در بسته باشد
  'nohup.out',
]);
const isExcluded = (p) =>
  EXCLUDE_PREFIXES.some((pre) => p === pre.slice(0, -1) || p.startsWith(pre)) ||
  EXCLUDE_FILES.has(p) ||
  /(^|\/)(node_modules|\.next|\.git)(\/|$)/.test(p) ||
  /\.log$/.test(p);

const expected = new Set();
for (const f of tracked) {
  if (isExcluded(f)) continue;
  const full = join(ROOT, f);
  if (existsSync(full) && statSync(full).isFile()) expected.add(f);
}
// explicit runtime extras that are untracked but bundled intentionally
// ⚠ .env عمداً اینجا نیست — رمزها هرگز وارد بستهٔ استقرار نمی‌شوند
// socket-server.mjs و db/custom.db عمداً حذف شدند: داکر سرویس سوکت را داخل
// ایمیج از سورس می‌سازد و دیتابیس VPS با migrations+seed ساخته می‌شود.
const EXTRA_FILES = [];
for (const f of EXTRA_FILES) {
  const full = join(ROOT, f);
  if (existsSync(full) && statSync(full).isFile()) expected.add(f);
}
// expected = دقیقاً فایل‌های git-tracked منهای مستثنیات — آرشیو از git ls-files
// ساخته می‌شود. فایل‌های untracked دیسک (رسانه‌های uploads/*، باینری‌های
// .tools/livekit-server و .tools/bin/bore، فایل‌های pid) عمداً جزو بستهٔ
// استقرار نیستند: داکر سرویس سوکت را داخل ایمیج از سورس می‌سازد و
// دیتابیس/آپلودهای VPS روی ولوم /data ساخته می‌شوند.

// ---- 3. compare ----
const identical = [], differing = [], archiveOnly = [], missingFromArchive = [];
let unexpectedCount = 0;

for (const f of archiveFiles) {
  const wt = join(ROOT, f);
  if (!existsSync(wt)) { archiveOnly.push(f); continue; }
  const av = sha256(join(VERIFY_DIR, f));
  const wv = sha256(wt);
  (av === wv ? identical : differing).push(f);
}
for (const f of expected) {
  if (!archiveFiles.has(f)) missingFromArchive.push(f);
}

console.log(`archive files: ${archiveFiles.size}`);
console.log(`expected files: ${expected.size}`);
console.log(`identical: ${identical.length}`);
console.log(`differing: ${differing.length}`);
console.log(`archive-only (not in working tree): ${archiveOnly.length}`);
console.log(`missing from archive: ${missingFromArchive.length}`);

if (differing.length) {
  console.log('\n=== DIFFERING (archive stale) ===');
  for (const f of differing) console.log('  ' + f);
}
if (archiveOnly.length) {
  console.log('\n=== ARCHIVE-ONLY ===');
  for (const f of archiveOnly.slice(0, 20)) console.log('  ' + f);
}
if (missingFromArchive.length) {
  // طبقه‌بندی: فقط حذف‌های عمدیِ طراحیِ بسته مجازند
  const INTENTIONAL = [
    /^\.verify-[^/]*\//,     // محیط‌های آزمون راستی‌آزمایی
    /^\.baseline-test\//,    // دیتابیس‌های سایهٔ آزمون
    /^\.tools\/livekit-server$/, // باینری 55MB لایوکیت — در ایمیج ساخته می‌شود (LICENSE و yaml داخل بسته هست)
    /^\.tools\/[a-z0-9_-]+_known_hosts$/, // known_hosts تونل‌های SSH سندباکس (serveo/lhr/…) — وضعیت محیط dev، جزو بستهٔ استقرار نیست
    /^\.tools\/\.watchdog-media-mode$/, // فایل وضعیت runtime نگهبان (external/local) — نه محتوای استقرار
    /^\.zscripts\/.*\.pid$/, // فایل PID کهنهٔ سندباکس
    /^tool-results\//,       // مصنوعات خروجی ابزارهای جلسه — محتوای استقرار نیست
    /^upload\//,             // دایرکتوری قدیمی حاوی یک tarball قبلی
    /^db\/custom\.pre-capacity\.db$/, // اسنپ‌شات بکاپ قدیمی مهاجرت capacity
    /^prisma\/dev\.db$/,
    /^logs\//,
    /\.log$/,
    /\.pid$/,
    /^\.git\//,
    /^node_modules\//,
    /^\.next\//,
    /^download\//,
    /^tmp-/,
    /^skills\//,
  ];
  const unexpected = missingFromArchive.filter((f) => !INTENTIONAL.some((re) => re.test(f)));
  unexpectedCount = unexpected.length;
  console.log('\n=== MISSING CLASSIFICATION ===');
  console.log(`  intentional excludes: ${missingFromArchive.length - unexpected.length}`);
  console.log(`  UNEXPECTED (real gaps): ${unexpected.length}`);
  for (const f of unexpected) console.log('    !! ' + f);
  // گروه‌بندی حذف‌های عمدی
  const groups = {};
  for (const f of missingFromArchive) {
    const g = INTENTIONAL.find((re) => re.test(f)) ? f.split('/')[0] : 'UNEXPECTED';
    groups[g] = (groups[g] || 0) + 1;
  }
  console.log('  by group: ' + JSON.stringify(groups, null, 0));
}

// ---- 4. critical spot checks ----
console.log('\n=== CRITICAL SPOT CHECKS ===');
const critical = [
  'src/lib/livekit.ts',
  'mini-services/socket-server/livekit.ts',
  'mini-services/socket-server/index.ts',
  'src/app/api/live-sessions/[id]/token/route.ts',
  'Dockerfile',
  'docker-compose.yml',
  'docker-entrypoint.sh',
  'deploy/livekit.yaml',
  'deploy/turnserver.conf',
  'prisma/migrations/20261015090000_group_lock/migration.sql',
  '.env.example',
];
let allOk = true;
for (const f of critical) {
  const inArchive = archiveFiles.has(f);
  let match = false, note = '';
  if (inArchive && existsSync(join(ROOT, f))) {
    match = sha256(join(VERIFY_DIR, f)) === sha256(join(ROOT, f));
    note = match ? 'IDENTICAL' : 'STALE!';
  } else if (!inArchive) note = 'NOT IN ARCHIVE!';
  else note = 'not in working tree';
  if (!inArchive || !match) allOk = false;
  console.log(`  [${inArchive && match ? 'OK' : '!!'}] ${f} → ${note}`);
}

// ---- 5. signal fix marker ----
console.log('\n=== SIGNAL FIX MARKER (livekitClientUrl reads Origin header first) ===');
const archLivekit = readFileSync(join(VERIFY_DIR, 'src/lib/livekit.ts'), 'utf8');
const wtLivekit = readFileSync(join(ROOT, 'src/lib/livekit.ts'), 'utf8');
const originFirst = /origin\?: string \| null/.test(archLivekit) && /if \(origin\)/.test(archLivekit);
console.log(`  archive has origin-first logic: ${originFirst ? 'yes' : 'NO!'}`);
console.log(`  archive == working tree: ${archLivekit === wtLivekit ? 'YES' : 'NO!'}`);

// ---- 6. secret guard: .env و فایل‌های رمز‌دار هرگز در بسته نباشند ----
console.log('\n=== SECRET GUARD ===');
const forbidden = ['.env', '.env.local', '.env.production'];
let secretClean = true;
for (const f of forbidden) {
  if (archiveFiles.has(f)) { secretClean = false; console.log(`  [!!] ${f} INSIDE ARCHIVE — رمز افشا می‌شود!`); }
}
// .env.example مجاز است (قالب بدون رمز)
console.log(`  ${secretClean ? '[OK] هیچ فایل .env رمز‌داری در بسته نیست (.env.example قالب مجاز است)' : 'SECRET LEAK!'}`);

const verdictOk =
  allOk && differing.length === 0 && archiveOnly.length === 0 && unexpectedCount === 0 && secretClean;
console.log(`\nVERDICT: ${verdictOk ? 'ARCHIVE == LATEST REPO (SECRET-FREE)' : 'ARCHIVE NEEDS REBUILD'}`);
if (!verdictOk) process.exit(1);
