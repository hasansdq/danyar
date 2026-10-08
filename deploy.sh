#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || { echo 'Create .env from .env.example and set domain, secrets and admin password.'; exit 1; }
source ./docker-common.sh
"${compose[@]}" config --quiet
if [[ "$provider" == postgres ]]; then
  "${compose[@]}" up -d --wait postgres
fi
"${compose[@]}" build
"${compose[@]}" up -d --wait
"${compose[@]}" ps
echo 'Gateway: http://127.0.0.1:3034 — configure your DirectAdmin domain proxy and SSL.'
