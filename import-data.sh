#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/docker-common.sh"
[[ "$provider" == sqlite ]] || { echo 'This importer is SQLite-only. PostgreSQL requires a separate data migration.'; exit 1; }
[[ -f db/custom.db ]] || { echo 'db/custom.db missing'; exit 1; }
"${compose[@]}" create nextjs
container=$("${compose[@]}" ps -aq nextjs)
[[ "$(docker inspect "$container" --format '{{.State.Running}}')" == false ]] || { echo 'Stop application before importing.'; exit 1; }
db=$(volume_path /data/db)
uploads=$(volume_path /data/uploads)
for volume in "$db" "$uploads"; do
  docker run --rm -v "$volume:/target:ro" alpine sh -c '[ -z "$(ls -A /target)" ]' || { echo 'Destination volume is not empty; refusing overwrite.'; exit 1; }
done
docker run --rm -v "$db:/target" -v "$(pwd)/db:/source:ro" alpine sh -c 'cp /source/custom.db /target/; for f in /source/custom.db-wal /source/custom.db-shm; do [ ! -f "$f" ] || cp "$f" /target/; done; chown -R 10001:10001 /target'
if [[ -d public/uploads ]]; then
  docker run --rm -v "$uploads:/target" -v "$(pwd)/public/uploads:/source:ro" alpine sh -c 'cp -a /source/. /target/; chown -R 10001:10001 /target'
fi
echo 'Imported. Run ./deploy.sh. Legacy DBs without migration history require manual schema verification.'
