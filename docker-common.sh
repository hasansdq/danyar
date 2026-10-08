#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# Compose parses .env; never execute its contents as shell code.
compose=(docker compose -f docker-compose.yml)
provider=$(docker compose -f docker-compose.yml config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["nextjs"]["build"]["args"]["DB_PROVIDER"])')
if [[ "$provider" == postgres ]]; then
  compose+=(-f docker-compose.postgres.yml)
fi
volume_path() {
  local container
  container=$("${compose[@]}" ps -aq nextjs)
  [[ -n "$container" ]] || { echo "Create containers first with docker compose create nextjs" >&2; return 1; }
  docker inspect "$container" --format '{{json .Mounts}}' | python3 -c 'import json,sys; target=sys.argv[1]; print(next(m["Name"] for m in json.load(sys.stdin) if m["Destination"]==target))' "$1"
}
