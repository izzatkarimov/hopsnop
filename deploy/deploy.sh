#!/usr/bin/env bash
# A deploy: a backup, the new code, migrations, then the new containers.
#   deploy.sh             pulls main first
#   deploy.sh --no-pull   deploys what is checked out (a rollback, deploy/README.md)
set -euo pipefail
cd "$(dirname "$0")"

# Shared with the purge and the backup timers: none of them overlap.
exec 9> "${HOPSNOP_LOCK:-/run/lock/hopsnop.lock}"
flock 9

if [ -n "$(docker compose ps --quiet --status running postgres)" ]; then
  ./backup.sh
fi

if [ "${1:-}" != "--no-pull" ]; then
  git pull --ff-only
fi

docker compose build
# On its own first: `up` would remove the old API before a failing migration stops it.
docker compose run --rm migrate
docker compose up --detach --wait --remove-orphans
# Only the images this replaced: a plain prune also removes images pulled by digest alone,
# postgres's among them whenever nothing runs it.
docker image prune --force --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME:-hopsnop}" > /dev/null
echo "Deployed $(git rev-parse --short=12 HEAD)"
