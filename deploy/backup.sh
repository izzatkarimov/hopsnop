#!/usr/bin/env bash
# The database and the pictures, into BACKUP_ROOT/<UTC time>/, kept BACKUP_KEEP_DAYS days.
# Run nightly by hopsnop-backup.timer and before every deploy (deploy/README.md, Backups).
set -euo pipefail
cd "$(dirname "$0")"

root=${BACKUP_ROOT:-/srv/hopsnop-backups}
keep_days=${BACKUP_KEEP_DAYS:-7}
umask 077

target="$root/$(date -u +%Y-%m-%dT%H%M%SZ)"
mkdir -p "$target"

# Paused, requests wait: no row can lose its picture between the dump and the archive.
docker compose pause api
trap 'docker compose unpause api' EXIT
docker compose exec -T postgres pg_dump --username=hopsnop --dbname=hopsnop --format=custom > "$target/database.dump"
docker compose run --rm --no-deps -T backup-images > "$target/images.tar.gz"
docker compose unpause api
trap - EXIT
# Docker reports a paused container unhealthy until its next check passes; a deploy waits on that.
api=$(docker compose ps --quiet api)
for _ in $(seq 1 60); do
  [ "$(docker inspect --format '{{.State.Health.Status}}' "$api")" = healthy ] && break
  sleep 1
done

# A dump that pg_restore can't read is no backup.
docker compose exec -T postgres pg_restore --list > /dev/null < "$target/database.dump"
tar -tzf "$target/images.tar.gz" > /dev/null
(cd "$target" && sha256sum database.dump images.tar.gz > SHA256SUMS)
echo "Backup written to $target"

find "$root" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??T??????Z' -mtime +"$keep_days" -print -exec rm -rf {} +
