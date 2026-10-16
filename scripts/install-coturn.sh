#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-coturn.sh — نصب coturn بدون root برای پل TURN پیش‌نمایش
#
# چرا؟ بازنشانی سندباکس /home/z/.local/opt/coturn را پاک می‌کند؛ این اسکریپت
# پکیج‌ها را با apt-get download دانلود و با dpkg -x در مسیر کاربر استخراج
# می‌کند (بدون نیاز به root). سپس wrapper .tools/turnserver را می‌آزماید.
# توسط dev-up.sh / dev-watchdog.sh به‌صورت best-effort فراخوانی می‌شود.
# ─────────────────────────────────────────────────────────────────────────────
set -u
DEST="/home/z/.local/opt/coturn"
BIN="$DEST/usr/bin/turnserver"
LIBDIR="$DEST/usr/lib/x86_64-linux-gnu"

# از قبل سالم است؟
if [ -x "$BIN" ] && LD_LIBRARY_PATH="$LIBDIR" "$BIN" --version >/dev/null 2>&1; then
  echo "install-coturn: از قبل نصب و سالم است"; exit 0
fi

echo "install-coturn: در حال نصب (apt-get download + dpkg -x)…"
TMP="$(mktemp -d /tmp/coturn-install.XXXXXX)" || exit 1
trap 'rm -rf "$TMP"' EXIT
cd "$TMP" || exit 1

PKGS=(coturn libevent-core-2.1-7t64 libevent-pthreads-2.1-7t64
      libevent-extra-2.1-7t64 libevent-openssl-2.1-7t64 libhiredis1.1.0)
for p in "${PKGS[@]}"; do
  apt-get download "$p" >/dev/null 2>&1 || { echo "install-coturn: دانلود $p ناموفق"; exit 1; }
done
mkdir -p "$DEST"
for d in *.deb; do dpkg -x "$d" "$DEST" || exit 1; done

if [ -x "$BIN" ] && LD_LIBRARY_PATH="$LIBDIR" "$BIN" --version >/dev/null 2>&1; then
  echo "install-coturn: نصب شد → $BIN"
  exit 0
fi
echo "install-coturn: پس از نصب باینری سالم نیست"; exit 1
