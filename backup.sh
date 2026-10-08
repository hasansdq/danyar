#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/docker-common.sh"
umask 077
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
work=$(mktemp -d "$(pwd)/backups/.tmp.XXXXXX")
restart_apps=false
cleanup() { if $restart_apps; then "${compose[@]}" start nextjs chat-service classroom-service; fi; rm -rf "$work"; }
trap cleanup EXIT
uploads=$(volume_path /data/uploads)
"${compose[@]}" stop nextjs chat-service classroom-service
restart_apps=true
if [[ "$provider" == postgres ]]; then
  "${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$work/database.dump"
else
  db=$(volume_path /data/db)
  docker run --rm -v "$db:/data:ro" -v "$work:/out" alpine tar czf /out/database.tar.gz -C /data .
fi
docker run --rm -v "$uploads:/data:ro" -v "$work:/out" alpine tar czf /out/uploads.tar.gz -C /data .
printf '%s\n' "$provider" > "$work/provider"
tar czf "backups/daniyar-$stamp.tar.gz" -C "$work" .
echo "Backup: backups/daniyar-$stamp.tar.gz"
