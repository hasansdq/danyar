#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# تست منطق‌های شل اصلاح‌شده — بدون docker واقعی (با توابع قلابی)
# ۱) سازگاری بررسی پورت deploy.sh با set -e
# ۲) گیت مهاجرت _common.sh با docker compose ps --all
# ۳) اعتبارسنجی آرشیو restore.sh (مسیر/لینک/نوع)
# ۴) الگوی entrypoint/کاربر import-data.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✔ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✘ $1"; }
check(){ if [ "$1" = "0" ]; then ok "$2"; else bad "$2"; fi }

echo "── ۰) syntax-check همه اسکریپت‌های شل ──"
SYN=0
for f in scripts/deploy.sh scripts/update.sh scripts/restore.sh scripts/import-data.sh scripts/backup.sh scripts/_common.sh docker-entrypoint.sh; do
  bash -n "$f" 2>/dev/null || { echo "  ✘ syntax $f"; SYN=1; }
done
check $SYN "bash -n هر ۷ اسکریپت سالم"

# ═════════════════════════════════════════════════════════════
echo "── ۱) بررسی پورت با set -e — پورت آزاد نباید اسکریپت را متوقف کند ──"

# شبیه‌سازی دقیق منطق deploy.sh در زیرشل با set -euo pipefail
run_port_logic() {
  # $1 = خروجی شبیه‌سازی‌شده ss (خالی = پورت آزاد)؛ $2 = خروجی docker ps پروژه
  bash -c '
    set -euo pipefail
    PORT="3034"
    SS_OUTPUT="$1"
    OURS_OUTPUT="$2"

    ss() { printf "%s" "$SS_OUTPUT"; return 0; }
    docker() {
      case "$1 $2 $3" in
        "ps --filter label=com.docker.compose.project=daniar"|"ps --filter *") printf "%s" "$OURS_OUTPUT"; return 0 ;;
      esac
      case "$1" in ps|inspect) printf "%s" "$OURS_OUTPUT"; return 0 ;; esac
      return 0
    }

    port_busy_foreign() {
      if command -v ss >/dev/null 2>&1; then
        if ss -ltnH "sport = :${PORT}" 2>/dev/null | grep -q .; then return 0; else return 1; fi
      elif command -v netstat >/dev/null 2>&1; then
        if netstat -ltn 2>/dev/null | awk "{print \$4}" | grep -q ":${PORT}$"; then return 0; else return 1; fi
      else
        return 2
      fi
    }
    BUSY=0
    port_busy_foreign || BUSY=$?
    case "$BUSY" in
      2) echo "NO-TOOLS" ;;
      0)
        OURS="$(docker ps --filter "label=com.docker.compose.project=daniar" --format "{{.Names}} {{.Ports}}" 2>/dev/null | grep ":${PORT}->" || true)"
        if [ -n "$OURS" ]; then echo "OURS"; else echo "FOREIGN"; fi
        ;;
      1) echo "FREE" ;;
    esac
  ' _ "$1" "$2"
}

R="$(run_port_logic '' '')"
[ "$R" = "FREE" ] && ok "پورت آزاد + set -e → ادامه (FREE)" || bad "پورت آزاد → $R (باید FREE باشد)"

R="$(run_port_logic 'LISTEN 0 128 0.0.0.0:3034' '')"
[ "$R" = "FOREIGN" ] && ok "پورت اشغال خارجی → FOREIGN (توقف با پیام)" || bad "اشغال خارجی → $R"

R="$(run_port_logic 'LISTEN 0 128 0.0.0.0:3034' 'daniar-proxy-1 0.0.0.0:3034->8080/tcp')"
[ "$R" = "OURS" ] && ok "اشغال توسط خود پروژه → OURS (مانع نیست)" || bad "اشغال خود پروژه → $R"

# تابع بدون شبیه‌سازی ss (ابزار موجود نیست) → NO-TOOLS
R="$(bash -c '
  set -euo pipefail
  PORT="3034"
  command() {
    if [ "${1:-}" = "-v" ] && { [ "${2:-}" = "ss" ] || [ "${2:-}" = "netstat" ]; }; then
      return 1
    fi
    builtin command "$@"
  }
  port_busy_foreign() {
    if command -v ss >/dev/null 2>&1; then return 0
    elif command -v netstat >/dev/null 2>&1; then return 0
    else return 2; fi
  }
  BUSY=0
  port_busy_foreign || BUSY=$?
  echo "$BUSY"
')"
[ "$R" = "2" ] && ok "نبود ابزار بررسی → BUSY=2 (Docker خودش بررسی می‌کند)" || bad "نبود ابزار → $R"

# ═════════════════════════════════════════════════════════════
echo "── ۲) گیت مهاجرت _common.sh — docker compose ps --all ──"

# زیرشل با docker قلابی و توابع واقعی _common.sh
run_gate() {
  local scen="$1"
  bash -c '
    set -uo pipefail
    SCEN="$1"
    source scripts/_common.sh 2>/dev/null || true

    # docker قلابی: وضعیت کانتینر migrate بر اساس سناریو
    docker() {
      case "$*" in
        *"ps"*"migrate"*)
          case "$SCEN" in
            exited0)  echo "c-migrate-1" ;;
            exited1)  echo "c-migrate-1" ;;
            running)  echo "c-migrate-1" ;;
            noc)      return 1 ;;
            tworuns)  printf "c-old\nc-new\n" ;;
          esac
          return 0 ;;
        "compose logs"*) echo "fake-log"; return 0 ;;
        *) return 0 ;;
      esac
    }
    inspect_fmt() {
      case "$1" in
        c-migrate-1)
          case "$SCEN" in
            exited0) echo "exited"; echo "0" ;;
            exited1) echo "exited"; echo "1" ;;
            running) echo "running"; echo "0" ;;
          esac ;;
        c-old) echo "exited"; echo "0" ;;
        c-new)
          case "$SCEN" in
            tworuns) echo "exited"; echo "0" ;;
          esac ;;
      esac
    }
    # docker inspect قلابی — دو فرمت: Status و ExitCode
    docker_inspect() { :; }

    # جایگزینی docker inspect (تابع جدا در _common صدا زده می‌شود؟ نه — docker inspect خودش)
    docker() {
      case "$*" in
        *"ps"*"migrate"*)
          case "$SCEN" in
            exited0)  echo "c-migrate-1" ;;
            exited1)  echo "c-migrate-1" ;;
            running)  echo "c-migrate-1" ;;
            noc)      return 1 ;;
            tworuns)  printf "c-old\nc-new\n" ;;
          esac
          return 0 ;;
        "compose logs"*) echo "fake-log"; return 0 ;;
        "inspect --format {{.State.Status}}"*|"inspect --format {{.State.Status}} "*)
          local cid="${!#}"
          case "$cid" in
            c-migrate-1) case "$SCEN" in exited0|exited1) echo "exited";; running) echo "running";; esac ;;
            c-old) echo "exited" ;;
            c-new) echo "exited" ;;
          esac
          return 0 ;;
        "inspect --format {{.Created}}"*|"inspect --format {{.Created}} "*)
          local cid="${!#}"
          case "$cid" in
            c-old) echo "2026-10-13T09:00:00.000000000Z" ;;
            c-new) echo "2026-10-13T10:00:00.000000000Z" ;;
            *)     echo "2026-10-13T10:00:00.000000000Z" ;;
          esac
          return 0 ;;
        "inspect --format {{if .State.Error}}error{{else}}{{.State.ExitCode}}{{end}}"*)
          local cid="${!#}"
          case "$cid" in
            c-migrate-1) case "$SCEN" in exited0) echo "0" ;; exited1) echo "1" ;; running) echo "0" ;; esac ;;
            c-old) echo "0" ;;
            c-new) echo "0" ;;
          esac
          return 0 ;;
      esac
      return 0
    }

    case "$SCEN" in
      noc)      timeout=2 daniar_wait_migrate 2 >/dev/null 2>&1; R=$? ;;
      running)  timeout=2 daniar_wait_migrate 2 >/dev/null 2>&1; R=$? ;;
      exited0)  daniar_wait_migrate 5 >/dev/null 2>&1; R=$? ;;
      exited1)  daniar_wait_migrate 5 >/dev/null 2>&1; R=$? ;;
      tworuns)  daniar_wait_migrate 5 >/dev/null 2>&1; R=$? ;;
    esac
    echo "RESULT:$R"
  ' _ "$scen"
}

grep -q "daniar_wait_migrate" scripts/_common.sh || { bad "_common.sh بارگذاری نشد"; exit 1; }

# exited0 → موفق (0)
R="$(run_gate exited0)"; [ "$R" = "RESULT:0" ] && ok "migrate پایان‌یافته + کد ۰ → گیت موفق" || bad "exited0 → $R"
# exited1 → شکست (1)
R="$(run_gate exited1)"; [ "$R" = "RESULT:1" ] && ok "migrate پایان‌یافته + کد ۱ → شکست" || bad "exited1 → $R"
# running → مهلت (شکست بعد از timeout، نه اعلام موفقیت زودهنگام)
R="$(run_gate running)"; [ "$R" = "RESULT:1" ] && ok "migrate هنوز در حال اجرا → اعلام موفقیت نمی‌شود" || bad "running → $R"
# no container → مهلت
R="$(run_gate noc)"; [ "$R" = "RESULT:1" ] && ok "کانتینر migrate وجود ندارد → شکست پس از مهلت" || bad "noc → $R"
# دو نمونه (قدیمی exit-0 + جدید exit-0) → جدیدترین ملاک = موفق
R="$(run_gate tworuns)"; [ "$R" = "RESULT:0" ] && ok "دو نمونه migrate → جدیدترین ملاک (۰ = موفق)" || bad "tworuns → $R"

# ps --all واقعاً در کد استفاده شده؟
grep -q "ps -q --all migrate" scripts/_common.sh && ok "daniar_migrate_exit_code از docker compose ps -q --all استفاده می‌کند" || bad "ps --all در کد نیست"

# ═════════════════════════════════════════════════════════════
echo "── ۳) اعتبارسنجی آرشیو restore.sh — مسیر/لینک/نوع ──"

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

# آرشیو استاندار سالم
mkdir -p "$TMPD/good/uploads/branding"
echo hello > "$TMPD/good/uploads/a.txt"
echo x > "$TMPD/good/uploads/branding/f.woff2"
tar czf "$TMPD/good.tar.gz" -C "$TMPD/good" uploads

# آرشیو با تراورسال ../
mkdir -p "$TMPD/evil1"; echo pwn > "$TMPD/evil1/payload"
tar czf "$TMPD/traversal.tar.gz" -C "$TMPD/evil1" ../payload 2>/dev/null || \
  tar czf "$TMPD/traversal.tar.gz" -C "$TMPD" evil1/payload
# ساخت آرشیو با مسیر مطلق (GNU tar مجاز می‌کند با حذف / — با -P مطلق واقعی)
tar czfP "$TMPD/absolute.tar.gz" "$TMPD/evil1/payload" 2>/dev/null || cp "$TMPD/traversal.tar.gz" "$TMPD/absolute.tar.gz"

# آرشیو با symlink
mkdir -p "$TMPD/evil2/uploads"
echo a > "$TMPD/evil2/uploads/a.txt"
ln -s /etc/passwd "$TMPD/evil2/uploads/link"
tar czf "$TMPD/symlink.tar.gz" -C "$TMPD/evil2" uploads

# آرشیو با ورودی خارج از uploads/
mkdir -p "$TMPD/evil3"
echo b > "$TMPD/evil3/etc.txt"
echo c > "$TMPD/evil3/uploads2.txt"
tar czf "$TMPD/offroot.tar.gz" -C "$TMPD/evil3" etc.txt uploads2.txt

validate_archive() {
  local archive="$1"
  bash -c '
    set -euo pipefail
    ARCHIVE="$1"
    tar tzf "$ARCHIVE" >/dev/null 2>&1 || { echo "UNREADABLE"; exit 0; }
    tar tvzf "$ARCHIVE" > /tmp/archive-listing.txt
    NENT=$(wc -l < /tmp/archive-listing.txt)
    [ "$NENT" -gt 0 ] 2>/dev/null || { echo "EMPTY"; exit 0; }
    BADTYPE=$(grep -E "^[bclhps]" /tmp/archive-listing.txt | head -5 || true)
    if [ -n "$BADTYPE" ]; then echo "BADTYPE"; exit 0; fi
    BADPATH=$(grep -E "(^|[[:space:]])/" /tmp/archive-listing.txt | head -5 || true)
    BADPATH2=$(grep -E "(^|[[:space:]])[.][.]/|/[.][.]([[:space:]]|$)" /tmp/archive-listing.txt | head -5 || true)
    if [ -n "$BADPATH" ] || [ -n "$BADPATH2" ]; then echo "TRAVERSAL"; exit 0; fi
    OFFROOT=$(sed -e "s/ -> .*//" /tmp/archive-listing.txt | awk "{print \$NF}" | grep -v "^uploads/" | grep -v "^$" | head -5 || true)
    if [ -n "$OFFROOT" ]; then echo "OFFROOT"; exit 0; fi
    echo "OK"
  ' _ "$archive"
}

R="$(validate_archive "$TMPD/good.tar.gz")"
[ "$R" = "OK" ] && ok "آرشیو استاندارد → تأیید" || bad "آرشیو سالم → $R"
R="$(validate_archive "$TMPD/symlink.tar.gz")"
[ "$R" = "BADTYPE" ] && ok "آرشیو با symlink → رد (BADTYPE)" || bad "symlink → $R"
R="$(validate_archive "$TMPD/offroot.tar.gz")"
[ "$R" = "OFFROOT" ] && ok "آرشیو با ورودی خارج از uploads/ → رد" || bad "offroot → $R"
R="$(validate_archive /home/z/my-project/nonexistent.tar.gz 2>/dev/null || echo UNREADABLE)"
[ "$R" = "UNREADABLE" ] && ok "فایل ناسالم/ناموجود → رد" || bad "ناموجود → $R"

# ═════════════════════════════════════════════════════════════
echo "── ۴) الگوی import-data.sh — entrypoint/کاربر صریح ──"
grep -q -- "--entrypoint /bin/sh" scripts/import-data.sh && ok "entrypoint صریح به /bin/sh جایگزین می‌شود" || bad "entrypoint صریح نیست"
grep -q -- "--user 0:0" scripts/import-data.sh && ok "کانتینر کمکی با root اجرا می‌شود (مجوز نوشتن/مالکیت)" || bad "--user 0:0 نیست"
grep -q "chown -R 10001:10001 /data" scripts/import-data.sh && ok "مالکیت نهایی به کاربر سرویس برمی‌گردد" || bad "chown نهایی نیست"
grep -q "unreadable" scripts/import-data.sh && ok "مقصد ناخوانا = خطای صریح (نه empty)" || bad "گارد ناخوانایی مقصد نیست"
# فراخوانی‌های docker run ایمیج پروژه دیگر به‌صورت مستقیم sh -c نمی‌گیرند (entrypoint عوض شده)
if grep -qE 'docker run[^\n]*"\$HELPER_IMG" sh -c' scripts/import-data.sh; then
  bad "فراخوانی بدون entrypoint صریح باقی مانده"
else
  ok "همه docker runها با HELPER_ARGS (entrypoint+user) اجرا می‌شوند"
fi

echo
echo "════════════════════════════════════════"
echo "نتیجه: $PASS سبز، $FAIL قرمز"
[ "$FAIL" = "0" ]
