#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/docker-common.sh"
file=$(realpath "${1:?Usage: ./restore.sh backups/file.tar.gz}")
[[ -f "$file" ]]
read -r -p 'Replace current database and uploads? [y/N] ' answer
[[ "$answer" == y || "$answer" == Y ]] || exit 1
umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Only extract the known files, never arbitrary archive paths.
tar xzf "$file" -C "$work" ./provider ./uploads.tar.gz
[[ "$(cat "$work/provider")" == "$provider" ]] || { echo 'Database provider mismatch'; exit 1; }
if [[ "$provider" == postgres ]]; then
  tar xzf "$file" -C "$work" ./database.dump
  "${compose[@]}" up -d --wait postgres
else
  tar xzf "$file" -C "$work" ./database.tar.gz
fi
uploads=$(volume_path /data/uploads)
"${compose[@]}" stop nextjs chat-service classroom-service caddy
if [[ "$provider" == postgres ]]; then
  "${compose[@]}" exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --exit-on-error --single-transaction' < "$work/database.dump"
else
  db=$(volume_path /data/db)
  docker run --rm -v "$db:/data" -v "$work:/in:ro" alpine sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar xzf /in/database.tar.gz -C /data; chown -R 10001:10001 /data'
fi
docker run --rm -v "$uploads:/data" -v "$work:/in:ro" alpine sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar xzf /in/uploads.tar.gz -C /data; chown -R 10001:10001 /data'
"${compose[@]}" up -d --wait
echo 'Restore completed.'
