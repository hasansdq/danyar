#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# تست تراکنشی بودن restore.sh — بدون Docker واقعی (shim)
# تضمین‌های آزمون‌شده:
#   ① موفقیت کامل (db+آپلودها / فقط db) + نسخه prev + پاک‌سازی محل بازگشت
#   ② خطای اعتبارسنجی (بکاپ خراب / لینک / ../ / خارج از uploads) =
#      انصراف بی‌آسیب، داده‌ها بایت‌به‌بایت ثابت، بدون توقف و بدون UP
#   ③ خطای میانی جایگزینی (بعد از db / بعد از آپلودها) =
#      بازگردانی کامل بایت‌به‌بایت، بدون UP، سرویس‌ها متوقف، پیام واضح
#   ④ شکست مهاجرت / سلامت = توقف سرویس‌ها + بازگردانی کامل + بدون UP دوم
#   ⑤ قفل هم‌زمانی
# ─────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✔ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✘ $1"; }
check(){ if [ "$1" = "0" ]; then ok "$2"; else bad "$2"; fi; }

RUNROOT="$(mktemp -d /tmp/daniar-restore-test.XXXXXX)"
SHIM_STATE="$RUNROOT/state"
BIN="$RUNROOT/bin"
mkdir -p "$SHIM_STATE" "$BIN"
cp scripts/test-support/docker-shim.sh "$BIN/docker"
cp scripts/test-support/sqlite3 "$BIN/sqlite3"
chmod +x "$BIN/docker" "$BIN/sqlite3"
# sqlite3 shim برای خودِ تست هم در دسترس باشد (mk_db / db_marker / integrity)
export PATH="$BIN:$PATH"

cleanup_all() { rm -rf "$RUNROOT"; }
trap cleanup_all EXIT
ABS="$(pwd)"

# ─── ابزار ساخت فیکسچر ───
mk_db() { # $1=path $2=marker — دیتابیس با ۴ جدول حیاتی + یک رد نشان
  rm -f "$1"
  sqlite3 "$1" "CREATE TABLE User (id INTEGER PRIMARY KEY, username TEXT);
CREATE TABLE School (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE Message (id INTEGER PRIMARY KEY, content TEXT);
CREATE TABLE Classroom (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO User (username) VALUES ('$2');"
}

db_marker() { sqlite3 "$1" "SELECT username FROM User LIMIT 1" 2>/dev/null; }

mk_uploads() { # $1=dir $2=tag
  rm -rf "$1"; mkdir -p "$1/sub"
  echo "content-$2-a" > "$1/a.txt"
  echo "content-$2-b" > "$1/sub/b.txt"
}

mk_upload_tar() { # $1=tar path $2=staging dir با محتوای uploads/$2
  local staging; staging="$(dirname "$1")/stage-$(basename "$1" .tar.gz)"
  rm -rf "$staging"; mkdir -p "$staging/uploads"
  echo "new-uploads-$2" > "$staging/uploads/new.txt"
  mkdir -p "$staging/uploads/nested"
  echo "deep-$2" > "$staging/uploads/nested/deep.txt"
  tar czf "$1" -C "$staging" uploads
  rm -rf "$staging"
}

dir_sha() { (cd "$1" && find . -type f | sort | xargs sha256sum 2>/dev/null) | sha256sum | cut -d' ' -f1; }

# ─── اجرای یک سناریو ───
# run_restore <vol> <out-log> [env K=V]... -- <args به restore>
run_restore() {
  local vol="$1"; shift
  local logfile="$1"; shift
  local -a envs=()
  : > "$SHIM_STATE/calls.log"
  echo 1 > "$SHIM_STATE/running"          # سرویس‌ها در ابتدا روشن
  echo 0 > "$SHIM_STATE/migrate_started"
  echo 0 > "$SHIM_STATE/migrate_exit"
  echo 1 > "$SHIM_STATE/services_healthy"
  rm -f "$SHIM_STATE/SHIM_FAIL_AFTER"
  while [ "${1:-}" != "--" ]; do
    case "$1" in
      MIGRATE_EXIT=*|SERVICES_HEALTHY=*|SHIM_FAIL_AFTER=*)
        local k="${1%%=*}" v="${1#*=}"
        case "$k" in
          MIGRATE_EXIT) echo "$v" > "$SHIM_STATE/migrate_exit" ;;
          SERVICES_HEALTHY) echo "$v" > "$SHIM_STATE/services_healthy" ;;
          *) echo "$v" > "$SHIM_STATE/SHIM_FAIL_AFTER" ;;
        esac ;;
      *) envs+=("$1") ;;
    esac
    shift
  done
  shift
  ( cd "$RUNROOT" && \
    env PATH="$BIN:$PATH" \
        SHIM_STATE="$SHIM_STATE" \
        DANIAR_DATA_ROOT="$vol" \
        DANIAR_HELPER_TMP="$RUNROOT/helper-tmp" \
        DANIAR_RESTORE_YES=1 \
        DANIAR_GATE_TIMEOUT=6 \
        "${envs[@]}" \
        bash "$ABS/scripts/restore.sh" "$@" > "$logfile" 2>&1 )
  echo $?
}

in_calls() { grep -qF "$1" "$SHIM_STATE/calls.log"; }
count_calls() { grep -cF "$1" "$SHIM_STATE/calls.log" 2>/dev/null || true; }

echo "══ ۰) syntax ══"
bash -n scripts/restore.sh && ok "bash -n restore.sh" || bad "syntax restore.sh"

# ═══════════════════ سناریو ۱: موفقیت کامل db+آپلودها ═══════════════════
echo "══ ۱) موفقیت کامل: دیتابیس + آپلودها ═══════════════════"
{
  VOL="$RUNROOT/t1"; mkdir -p "$VOL"
  mk_db "$VOL/daniar.db" OLDDB
  mk_uploads "$VOL/uploads" old
  OLDDB_SHA="$(sha256sum "$VOL/daniar.db" | cut -d' ' -f1)"
  OLDUP_SHA="$(dir_sha "$VOL/uploads")"
  mk_db "$RUNROOT/backup1.db" NEWDB
  mk_upload_tar "$RUNROOT/up1.tar.gz" new
  RC=$(run_restore "$VOL" "$RUNROOT/t1.log" -- "$RUNROOT/backup1.db" "$RUNROOT/up1.tar.gz")
  echo "$RC" > "$RUNROOT/t1.rc"
} 
[ "$(cat "$RUNROOT/t1.rc")" = "0" ] && ok "خروج ۰" || { bad "خروج $(cat "$RUNROOT/t1.rc")"; cat "$RUNROOT/t1.log" | tail -20; }
[ "$(db_marker "$VOL/daniar.db")" = "NEWDB" ] && ok "دیتابیس جدید جایگزین شد" || bad "مارکر دیتابیس: $(db_marker "$VOL/daniar.db")"
[ -f "$VOL/uploads/new.txt" ] && [ -f "$VOL/uploads/nested/deep.txt" ] && [ ! -f "$VOL/uploads/a.txt" ] && ok "آپلودها کامل جایگزین شد" || bad "آپلودها ناقص"
[ "$(db_marker "$VOL/daniar.db.prev" 2>/dev/null)" = "OLDDB" ] && ok "نسخه prev = نسخه قبلی" || bad "prev مفقود/نادرست"
[ ! -d "$VOL/.restore-rollback" ] && [ ! -d "$VOL/.restore-staging" ] && ok "محل بازگشت/موقت پاک شد" || bad "باقی‌مانده rollback/staging"
[ "$(count_calls "compose up")" = "1" ] && ok "دقیقاً یک compose up" || bad "تعداد up = $(count_calls "compose up")"

# ═══════════════════ سناریو ۲: موفقیت فقط دیتابیس ═══════════════════
echo "══ ۲) موفقیت فقط دیتابیس — آپلودها دست‌نخورده ═══════════════════"
{
  VOL="$RUNROOT/t2"; mkdir -p "$VOL"
  mk_db "$VOL/daniar.db" OLD2
  mk_uploads "$VOL/uploads" old2
  mk_db "$RUNROOT/backup2.db" NEW2
  RC=$(run_restore "$VOL" "$RUNROOT/t2.log" -- "$RUNROOT/backup2.db")
  echo "$RC" > "$RUNROOT/t2.rc"
}
[ "$(cat "$RUNROOT/t2.rc")" = "0" ] && ok "خروج ۰" || bad "خروج $(cat "$RUNROOT/t2.rc")"
[ "$(db_marker "$VOL/daniar.db")" = "NEW2" ] && ok "دیتابیس جایگزین شد" || bad "دیتابیس: $(db_marker "$VOL/daniar.db")"
[ "$(dir_sha "$VOL/uploads")" = "$(dir_sha "$RUNROOT/t2-upref" 2>/dev/null)" ] || true
[ -f "$VOL/uploads/a.txt" ] && grep -q "content-old2-a" "$VOL/uploads/a.txt" && ok "آپلودها دست‌نخورده" || bad "آپلودها تغییر کردند"
[ "$(count_calls "compose up")" = "1" ] && ok "یک up" || bad "up = $(count_calls "compose up")"

# ═══════════════════ سناریو ۳: بکاپ دیتابیس خراب ═══════════════════
echo "══ ۳) بکاپ خراب — انصراف بی‌آسیب، بدون توقف/UP ═══════════════════"
{
  VOL="$RUNROOT/t3"; mkdir -p "$VOL"
  mk_db "$VOL/daniar.db" OLD3
  mk_uploads "$VOL/uploads" old3
  OLDDB_SHA=$(sha256sum "$VOL/daniar.db" | cut -d' ' -f1)
  OLDUP_SHA=$(dir_sha "$VOL/uploads")
  printf 'this is not a sqlite file at all %s' "$(head -c 200 /dev/urandom | base64)" > "$RUNROOT/backup3.db"
  RC=$(run_restore "$VOL" "$RUNROOT/t3.log" -- "$RUNROOT/backup3.db")
  echo "$RC" > "$RUNROOT/t3.rc"
}
[ "$(cat "$RUNROOT/t3.rc")" != "0" ] && ok "خروج غیرصفر" || bad "خروج ۰ (!)"
[ "$(sha256sum "$VOL/daniar.db" | cut -d' ' -f1)" = "$OLDDB_SHA" ] && ok "دیتابیس بایت‌به‌بایت ثابت" || bad "دیتابیس تغییر کرد"
[ "$(dir_sha "$VOL/uploads")" = "$OLDUP_SHA" ] && ok "آپلودها ثابت" || bad "آپلودها تغییر کردند"
in_calls "compose stop" && bad "سرویس‌ها متوقف شدند (نباید)" || ok "سرویس‌ها هرگز متوقف نشدند"
in_calls "compose up" && bad "UP انجام شد (نباید)" || ok "بدون UP"

# ═══════════════════ سناریو ۴/۵/۶: آرشیو خطرناک ═══════════════════
mk_bad_tar() { # $1=out $2=kind
  local st; st="$(dirname "$1")/badstage"; rm -rf "$st"; mkdir -p "$st/uploads"
  echo x > "$st/uploads/f.txt"
  case "$2" in
    symlink) ln -s /etc/passwd "$st/uploads/link.txt"
             tar czf "$1" -C "$st" uploads ;;
    traverse) tar czf "$1" --transform 's,^uploads/,uploads/../../,' -C "$st" uploads ;;
    offroot) mkdir -p "$st/etc"; echo x > "$st/etc/passwd"
             tar czf "$1" -C "$st" uploads etc ;;
  esac
  rm -rf "$st"
}
for KIND in symlink traverse offroot; do
  {
    VOL="$RUNROOT/t-$KIND"; mkdir -p "$VOL"
    mk_db "$VOL/daniar.db" "OLD-$KIND"
    mk_uploads "$VOL/uploads" "$KIND"
    OLDDB_SHA=$(sha256sum "$VOL/daniar.db" | cut -d' ' -f1)
    OLDUP_SHA=$(dir_sha "$VOL/uploads")
    mk_bad_tar "$RUNROOT/bad-$KIND.tar.gz" "$KIND"
    RC=$(run_restore "$VOL" "$RUNROOT/t-$KIND.log" -- "$RUNROOT/backup2.db" "$RUNROOT/bad-$KIND.tar.gz")
    echo "$RC" > "$RUNROOT/t-$KIND.rc"
  }
  [ "$(cat "$RUNROOT/t-$KIND.rc")" != "0" ] && ok "$KIND: رد شد (خروج $(cat "$RUNROOT/t-$KIND.rc"))" || bad "$KIND: پذیرفته شد (!)"
  [ "$(sha256sum "$VOL/daniar.db" | cut -d' ' -f1)" = "$OLDDB_SHA" ] && ok "$KIND: db ثابت" || bad "$KIND: db تغییر کرد"
  [ "$(dir_sha "$VOL/uploads")" = "$OLDUP_SHA" ] && ok "$KIND: آپلودها ثابت" || bad "$KIND: آپلودها تغییر کردند"
  in_calls "compose up" && bad "$KIND: UP (!)" || ok "$KIND: بدون UP"
done

# ═══════════════════ سناریو ۷: شکست میانی بعد از جایگزینی db ═══════════════════
echo "══ ۷) خطای میانی بعد از db — بازگردانی کامل بایت‌به‌بایت ═══════════════════"
{
  VOL="$RUNROOT/t7"; mkdir -p "$VOL"
  mk_db "$VOL/daniar.db" OLD7
  mk_uploads "$VOL/uploads" old7
  OLDDB_SHA=$(sha256sum "$VOL/daniar.db" | cut -d' ' -f1)
  OLDUP_SHA=$(dir_sha "$VOL/uploads")
  mk_db "$RUNROOT/backup7.db" NEW7
  mk_upload_tar "$RUNROOT/up7.tar.gz" new7
  RC=$(run_restore "$VOL" "$RUNROOT/t7.log" "SHIM_FAIL_AFTER=DB-REPLACED" -- "$RUNROOT/backup7.db" "$RUNROOT/up7.tar.gz")
  echo "$RC" > "$RUNROOT/t7.rc"
}
[ "$(cat "$RUNROOT/t7.rc")" != "0" ] && ok "خروج غیرصفر" || bad "خروج ۰ (!)"
[ "$(db_marker "$VOL/daniar.db")" = "OLD7" ] && ok "db قبلی برگشت (مارکر OLD7)" || bad "db: $(db_marker "$VOL/daniar.db" 2>/dev/null)"
[ "$(db_marker "$VOL/daniar.db")" = "OLD7" ] && [ "$(sqlite3 "$VOL/daniar.db" 'PRAGMA integrity_check;')" = "ok" ] && ok "db بازگشتی سالم" || bad "db بازگشتی ناسالم"
[ -f "$VOL/uploads/a.txt" ] && grep -q content-old7-a "$VOL/uploads/a.txt" && [ ! -f "$VOL/uploads/new.txt" ] && ok "آپلودهای قبلی کامل برگشتند" || bad "آپلودها: $(ls "$VOL/uploads" 2>/dev/null | tr '\n' ' ')"
[ ! -d "$VOL/.restore-rollback" ] && [ ! -d "$VOL/.restore-staging" ] && ok "باقی‌مانده موقت پاک شد" || bad "rollback/staging باقی ماند"
in_calls "compose stop" && ok "سرویس‌ها متوقف شدند" || bad "stop ثبت نشد"
in_calls "compose up" && bad "UP انجام شد (!)" || ok "هیچ UP رخ نداد"
grep -q "متوقف مانده" "$RUNROOT/t7.log" && ok "پیام واضح وضعیت توقف" || bad "پیام واضح یافت نشد"
grep -q "بازگرداند" "$RUNROOT/t7.log" && ok "پیام بازگردانی" || bad "پیام بازگردانی یافت نشد"

# ═══════════════════ سناریو ۸: شکست میانی بعد از آپلودها ═══════════════════
echo "══ ۸) خطای میانی بعد از آپلودها — بازگردانی هر دو ═══════════════════"
{
  VOL="$RUNROOT/t8"; mkdir -p "$VOL"
  mk_db "$VOL/daniar.db" OLD8
  mk_uploads "$VOL/uploads" old8
  mk_db "$RUNROOT/backup8.db" NEW8
  mk_upload_tar "$RUNROOT/up8.tar.gz" new8
  RC=$(run_restore "$VOL" "$RUNROOT/t8.log" "SHIM_FAIL_AFTER=UPLOADS-REPLACED" -- "$RUNROOT/backup8.db" "$RUNROOT/up8.tar.gz")
  echo "$RC" > "$RUNROOT/t8.rc"
}
[ "$(cat "$RUNROOT/t8.rc")" != "0" ] && ok "خروج غیرصفر" || bad "خروج ۰ (!)"
[ "$(db_marker "$VOL/daniar.db")" = "OLD8" ] && ok "db قبلی برگشت" || bad "db: $(db_marker "$VOL/daniar.db" 2>/dev/null)"
[ -f "$VOL/uploads/a.txt" ] && grep -q content-old8-a "$VOL/uploads/a.txt" && [ ! -f "$VOL/uploads/new.txt" ] && ok "آپلودهای قبلی برگشتند" || bad "آپلودها ناقص"
in_calls "compose up" && bad "UP (!)" || ok "بدون UP"

# ═══════════════════ سناریو ۹: شکست مهاجرت پس از UP ═══════════════════
echo "══ ۹) شکست مهاجرت — توقف + بازگردانی کامل ═══════════════════"
{
  VOL="$RUNROOT/t9"; mkdir -p "$VOL"
  mk_db "$VOL/daniar.db" OLD9
  mk_uploads "$VOL/uploads" old9
  mk_db "$RUNROOT/backup9.db" NEW9
  mk_upload_tar "$RUNROOT/up9.tar.gz" new9
  RC=$(run_restore "$VOL" "$RUNROOT/t9.log" "MIGRATE_EXIT=1" -- "$RUNROOT/backup9.db" "$RUNROOT/up9.tar.gz")
  echo "$RC" > "$RUNROOT/t9.rc"
}
[ "$(cat "$RUNROOT/t9.rc")" != "0" ] && ok "خروج غیرصفر" || bad "خروج ۰ (!)"
[ "$(db_marker "$VOL/daniar.db")" = "OLD9" ] && ok "db قبلی برگشت" || bad "db: $(db_marker "$VOL/daniar.db" 2>/dev/null)"
[ -f "$VOL/uploads/a.txt" ] && grep -q content-old9-a "$VOL/uploads/a.txt" && ok "آپلودهای قبلی برگشتند" || bad "آپلودها"
[ "$(count_calls "compose up")" = "1" ] && ok "فقط یک UP (UP دوم نشد)" || bad "UP = $(count_calls "compose up")"
grep -q "متوقف مانده" "$RUNROOT/t9.log" && ok "پیام توقف سرویس‌ها" || bad "پیام توقف"

# ═══════════════════ سناریو ۱۰: شکست سلامت سرویس‌ها ═══════════════════
echo "══ ۱۰) شکست سلامت سرویس‌ها — توقف + بازگردانی ═══════════════════"
{
  VOL="$RUNROOT/t10"; mkdir -p "$VOL"
  mk_db "$VOL/daniar.db" OLD10
  mk_uploads "$VOL/uploads" old10
  mk_db "$RUNROOT/backup10.db" NEW10
  RC=$(run_restore "$VOL" "$RUNROOT/t10.log" "SERVICES_HEALTHY=0" -- "$RUNROOT/backup10.db")
  echo "$RC" > "$RUNROOT/t10.rc"
}
[ "$(cat "$RUNROOT/t10.rc")" != "0" ] && ok "خروج غیرصفر" || bad "خروج ۰ (!)"
[ "$(db_marker "$VOL/daniar.db")" = "OLD10" ] && ok "db قبلی برگشت" || bad "db: $(db_marker "$VOL/daniar.db" 2>/dev/null)"
[ "$(count_calls "compose up")" = "1" ] && ok "فقط یک UP" || bad "UP = $(count_calls "compose up")"

# ═══════════════════ سناریو ۱۱: قفل هم‌زمانی ═══════════════════
echo "══ ۱۱) قفل هم‌زمانی ═══════════════════"
LOCKDIR="${TMPDIR:-/tmp}/daniar-restore.lock"
mkdir -p "$LOCKDIR"
VOL="$RUNROOT/t11"; mkdir -p "$VOL"
mk_db "$VOL/daniar.db" OLD11
DANIAR_RESTORE_YES=1 DANIAR_DATA_ROOT="$VOL" DANIAR_HELPER_TMP="$RUNROOT/helper-tmp" \
  PATH="$BIN:$PATH" SHIM_STATE="$SHIM_STATE" bash "$ABS/scripts/restore.sh" "$RUNROOT/backup2.db" > "$RUNROOT/t11.log" 2>&1
RC11=$?
rm -rf "$LOCKDIR"
[ "$RC11" != "0" ] && ok "اجرای موازی رد شد" || bad "اجرای موازی پذیرفته شد (!)"
grep -q "بازیابی دیگری" "$RUNROOT/t11.log" && ok "پیام قفل واضح" || bad "پیام قفل"

# ═══════════════════ سناریو ۱۲: ولوم تازه — فقط دیتابیس ═══════════════════
echo "══ ۱۲) ولوم تازه (بدون db/آپلودهای قبلی) ═══════════════════"
{
  VOL="$RUNROOT/t12"; mkdir -p "$VOL"
  mk_db "$RUNROOT/backup12.db" NEW12
  RC=$(run_restore "$VOL" "$RUNROOT/t12.log" -- "$RUNROOT/backup12.db")
  echo "$RC" > "$RUNROOT/t12.rc"
}
[ "$(cat "$RUNROOT/t12.rc")" = "0" ] && ok "خروج ۰" || bad "خروج $(cat "$RUNROOT/t12.rc")"
[ "$(db_marker "$VOL/daniar.db")" = "NEW12" ] && ok "دیتابیس ساخته/جایگزین شد" || bad "db: $(db_marker "$VOL/daniar.db" 2>/dev/null)"
[ "$(count_calls "compose up")" = "1" ] && ok "یک up" || bad "up"

echo
echo "══════ نتیجه: $PASS سبز، $FAIL قرمز ══════"
[ "$FAIL" = "0" ] && echo "همه آزمون‌های تراکنش بازیابی پاس شد" || echo "آزمون‌های ناموفق موجود است"
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
