#!/usr/bin/env bash
# docker shim برای تست تراکنشی restore.sh — بدون Docker واقعی
# حالت‌ها از فایل‌های داخل SHIM_STATE خوانده می‌شود:
#   running (0/1) | migrate_started (0/1) | migrate_exit (0/1/error) | services_healthy (0/1)
# هر فراخوانی در calls.log ثبت می‌شود (برای ادعاهای «UP/STOP هرگز/فقط یک‌بار»)
# تزریق خطا: SHIM_FAIL_AFTER=DB-REPLACED|UPLOADS-REPLACED → بعد از آن نشان، exit 98
set -u
SHIM_STATE="${SHIM_STATE:?}"
SHIM_CALLS="${SHIM_STATE}/calls.log"

log() { echo "[$*]" >> "$SHIM_CALLS"; }
get() { cat "$SHIM_STATE/$1" 2>/dev/null || echo ""; }

CMD1="${1:-}"
CMD2="${2:-}"
log "docker $CMD1 $CMD2 ${3:-} ${4:-} ${5:-}"
case "$CMD1" in
  image)
    exit 0 ;;
  rm)
    exit 0 ;;
  run)
    echo "shim-container-id"
    exit 0 ;;
  cp)
    # cp SRC HELPER:/path
    SRC="${2:-}"; DEST="${3:-}"
    T="${DEST#*:}"
    mkdir -p "$(dirname "$T")"
    cp "$SRC" "$T"
    exit 0 ;;
  exec)
    # exec [-e K=V]... HELPER sh -c CMD
    shift
    ENVS=()
    while [ "${1:-}" = "-e" ]; do ENVS+=("$2"); shift 2; done
    shift # HELPER
    [ "${1:-}" = "sh" ] && shift
    [ "${1:-}" = "-c" ] && shift
    BODY="$*"
    FAILEFTER="$(get SHIM_FAIL_AFTER)"
    if [ -n "$FAILEFTER" ]; then
      BODY="$(printf '%s' "$BODY" | sed "s/echo \"$FAILEFTER/echo \"$FAILEFTER\"\\nexit 98\\n# /")"
    fi
    env "${ENVS[@]}" sh -c "$BODY"
    exit $? ;;
  compose)
    SUB="${2:-}"
    case "$SUB" in
      stop)
        echo 0 > "$SHIM_STATE/running"
        exit 0 ;;
      up)
        echo 1 > "$SHIM_STATE/running"
        echo 1 > "$SHIM_STATE/migrate_started"
        exit 0 ;;
      ps)
        # ps -q --all migrate | ps -q SVC | ps
        if [ "${3:-}" = "-q" ]; then
          if [ "${4:-}" = "--all" ] && [ "${5:-}" = "migrate" ]; then
            [ "$(get migrate_started)" = "1" ] && echo "shim-migrate-cid"
            exit 0
          fi
          if [ "$(get running)" = "1" ]; then echo "shim-${5:-web}-cid"; fi
          exit 0
        fi
        echo "NAME      IMAGE          STATUS"
        echo "daniar-web-1   daniar:local   Up 2 minutes (healthy)"
        exit 0 ;;
      logs)
        exit 0 ;;
      *)
        exit 0 ;;
    esac ;;
  inspect)
    # inspect --format FMT CID
    FMT="${3:-}"
    CID="${4:-}"
    case "$FMT" in
      *State.Error*)
        echo "$(get migrate_exit)"
        exit 0 ;;
      *State.Health*)
        [ "$(get services_healthy)" = "1" ] && echo "healthy" || echo "unhealthy"
        exit 0 ;;
      *Config.Healthcheck*)
        echo "has"
        exit 0 ;;
      *State.Status*)
        if [ "$CID" = "shim-migrate-cid" ]; then
          [ "$(get migrate_started)" = "1" ] && echo "exited" || echo "created"
        else
          [ "$(get running)" = "1" ] && echo "running" || echo "exited"
        fi
        exit 0 ;;
      *)
        echo "unknown"
        exit 0 ;;
    esac ;;
  *)
    exit 0 ;;
esac
