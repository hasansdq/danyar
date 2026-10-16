#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# توابع مشترک deploy.sh / update.sh / restore.sh
# قاعده: «موفقیت» فقط پس از ① موفق‌بودن مهاجرت ② healthy‌بودن همه
# سرویس‌های فعال اعلام می‌شود — نه زودتر.
# ─────────────────────────────────────────────────────────────

# خدمات فعال پروژه (با پروفایل‌های .env) — خروجی: web socket proxy [livekit] [coturn]
daniar_active_services() {
  local svcs="web socket proxy"
  local profiles
  profiles="$(grep -E '^COMPOSE_PROFILES=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
  case ",${profiles:-}," in
    *,media,*) svcs="$svcs livekit" ;;
  esac
  case ",${profiles:-}," in
    *,turn,*)  svcs="$svcs coturn" ;;
  esac
  echo "$svcs"
}

# کد خروج کانتینر یک‌باره migrate — «docker compose ps --all» تا کانتینِر
# پایان‌یافته هم دیده شود (ps معمولی فقط running را می‌دهد و مهاجرتِ تمام‌شده
# همیشه «no-container» گزارش می‌شد = اعلام موفقیت ناممکن).
# خروجی: no-container | running | error | unknown | <کد خروج — فقط برای ended>
daniar_migrate_exit_code() {
  local cids cid state created newest="" newest_created=""
  cids="$(docker compose ps -q --all migrate 2>/dev/null || true)"
  [ -n "$cids" ] || { echo "no-container"; return 0; }
  # هر نمونه در حال اجرا/در صف راه‌اندازی = مهاجرت هنوز تمام نشده
  for cid in $cids; do
    state="$(docker inspect --format '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)"
    case "$state" in
      created|running|restarting|paused)
        echo "running"; return 0 ;;
    esac
  done
  # همه پایان یافته‌اند — جدیدترین نمونه (همین اجرا) ملاک است
  for cid in $cids; do
    created="$(docker inspect --format '{{.Created}}' "$cid" 2>/dev/null || echo '')"
    if [ -n "$created" ] && [[ "$created" > "$newest_created" ]]; then
      newest_created="$created"; newest="$cid"
    fi
  done
  [ -n "$newest" ] || newest="$(echo "$cids" | head -1)"
  docker inspect --format '{{if .State.Error}}error{{else}}{{.State.ExitCode}}{{end}}' "$newest" 2>/dev/null || echo "unknown"
}

# منتظر پایان «واقعی» مهاجرت با کد ۰ — خروجی 0=موفق 1=شکست
# موفقیت فقط وقتی اعلام می‌شود که کانتینر واقعاً پایان یافته و کد خروجش صفر باشد.
daniar_wait_migrate() {
  local timeout="${1:-240}" waited=0 state
  echo "── انتظار برای مهاجرت دیتابیس ──"
  while [ "$waited" -lt "$timeout" ]; do
    state="$(daniar_migrate_exit_code)"
    case "$state" in
      0) echo "  ✔ مهاجرت با موفقیت کامل شد (کانتینر پایان‌یافته، کد خروج ۰)"; return 0 ;;
      no-container|running) sleep 2; waited=$((waited+2)); continue ;;
      error|unknown) break ;;
      *)
        # 1/137 و… = شکست — لاگ بگیریم و شکست بدهیم
        echo "  ✘ سرویس migrate با کد خروج $state ناموفق بود — آخرین لاگ‌ها:" >&2
        docker compose logs --tail=25 migrate 2>/dev/null | sed 's/^/     /' >&2
        return 1 ;;
    esac
  done
  echo "  ✘ انتظار برای مهاجرت به نتیجه نرسید (${timeout}s) — docker compose logs migrate" >&2
  return 1
}

# منتظر healthy‌بودن همه سرویس‌های فعال — خروجی 0=همه سالم 1=مهلت/ناسالم
daniar_wait_healthy() {
  local timeout="${1:-240}" waited=0 pending bad
  local svcs; svcs="$(daniar_active_services)"
  echo "── انتظار برای سلامت کامل سرویس‌ها ($svcs) ──"
  while [ "$waited" -lt "$timeout" ]; do
    pending=""
    for s in $svcs; do
      local cid state health
      cid="$(docker compose ps -q "$s" 2>/dev/null | head -1 || true)"
      if [ -z "$cid" ]; then pending="$pending $s(نبود)"; continue; fi
      state="$(docker inspect --format '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)"
      health="$(docker inspect --format '{{if .Config.Healthcheck}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo unknown)"
      case "$health" in
        healthy) : ;;
        none) [ "$state" = "running" ] || pending="$pending $s($state)" ;;
        *)    pending="$pending $s($health)" ;;
      esac
    done
    if [ -z "$pending" ]; then
      echo "  ✔ همه سرویس‌ها healthy هستند"
      return 0
    fi
    sleep 3; waited=$((waited+3))
  done
  echo "  ✘ این سرویس‌ها پس از ${timeout}s سالم نشدند:$pending" >&2
  for s in $pending; do
    echo "  ── لاگ ${s%%(*} ──" >&2
    docker compose logs --tail=15 "${s%%(*}" 2>/dev/null | sed 's/^/     /' >&2
  done
  return 1
}

# دروازه نهایی اعلام موفقیت: مهاجرت + سلامت همه؛ در شکست راهنمای بازیابی
daniar_gate_success() {
  daniar_wait_migrate "$1" || return 1
  daniar_wait_healthy "$1" || return 1
  return 0
}

daniar_fail_hint() {
  echo >&2
  echo "  ✘ اعلام موفقیت انجام نشد — وضعیت با «docker compose ps» و «docker compose logs» بررسی کنید." >&2
  echo "  داده‌ها روی ولوم daniar_data دست‌نخورده‌اند؛ پشتیبان‌ها: ./backups و /data/backups" >&2
  echo "  بازیابی در صورت نیاز: bash scripts/restore.sh ./backups/daniar-db-<زمان>.db" >&2
}
