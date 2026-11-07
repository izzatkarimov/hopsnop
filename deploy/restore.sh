#!/usr/bin/env bash
# Restores a folder written by backup.sh into an empty database and an empty picture
# volume, then starts everything. Refuses anything else (deploy/README.md, Restoring).
set -euo pipefail
cd "$(dirname "$0")"

source_dir=${1:?usage: restore.sh BACKUP_FOLDER}
(cd "$source_dir" && sha256sum --check --quiet SHA256SUMS)

docker compose up --detach --wait postgres
tables=$(docker compose exec -T postgres psql --username=hopsnop --dbname=hopsnop --tuples-only --no-align \
  --command="SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$tables" != "0" ]; then
  echo "Refused: the database already has $tables tables. Restore only into a new, empty one." >&2
  exit 2
fi
if [ -n "$(docker compose run --rm --no-deps -T --entrypoint find restore-images /data/media -mindepth 1 -print -quit)" ]; then
  echo "Refused: the picture volume is not empty." >&2
  exit 2
fi

docker compose exec -T postgres pg_restore --username=hopsnop --dbname=hopsnop \
  --no-owner --exit-on-error --single-transaction < "$source_dir/database.dump"
docker compose run --rm --no-deps -T restore-images < "$source_dir/images.tar.gz"

# Migrations first, as on a deploy, in case the backup is older than the code.
docker compose up --detach --wait
echo "Restored from $source_dir"
