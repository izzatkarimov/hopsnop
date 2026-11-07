#!/usr/bin/env bash
# The local proof of deploy/ (deploy/test/README.md): the production stack under
# test names, deployed with deploy.sh, checked end to end; then the purge dry run,
# a failing deploy, a backup and a restore into a new stack. Everything it
# creates, secrets included, is removed at the end.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
deploy=$(dirname "$here")
project=hopsnop-localtest
restored=hopsnop-restoretest
canary=caddy@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
work=$(mktemp -d)
failures=0

export COMPOSE_PROJECT_NAME=$project
export COMPOSE_FILE="$deploy/compose.yml:$here/compose.test.yml"
export COMPOSE_ENV_FILES="$work/test.env"
export HOPSNOP_ENV_FILE="$work/test.env"
export FAKE_RESEND_CERTS="$work/public/fake-resend"
export BACKUP_ROOT="$work/backups"
export HOPSNOP_LOCK="$work/hopsnop.lock"

cleanup() {
  if [ "${HOPSNOP_PROOF_KEEP:-}" = 1 ]; then
    echo "Kept: $work and the projects $project, $restored"
    return
  fi
  for p in "$project" "$restored"; do
    COMPOSE_PROJECT_NAME=$p docker compose --profile tools down --volumes --remove-orphans > /dev/null 2>&1
  done
  docker image rm "$canary" > /dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
check() {
  local name=$1
  shift
  if "$@"; then ok "$name"; else fail "$name"; fi
}
equals() { [ "$1" = "$2" ] || { printf '        got: %s\n        expected: %s\n' "$1" "$2"; return 1; }; }
contains() { case "$1" in *"$2"*) return 0 ;; *) printf '        lacks: %s\n' "$2"; return 1 ;; esac; }
quiet() { local log=$1; shift; "$@" > "$log" 2>&1; }
secret() { python3 -c "import secrets; print(secrets.token_urlsafe($1))"; }
container() { docker compose ps --all --quiet "$1"; }
inspect() { docker inspect --format "$2" "$(container "$1")"; }
export_root_ca() {
  for _ in $(seq 1 60); do
    docker compose exec -T caddy test -f /data/caddy/pki/authorities/local/root.crt && break
    sleep 1
  done
  docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$work/public/root.crt" > /dev/null
  chmod 644 "$work/public/root.crt"
}

echo "Settings: generated for this run, in $work (mode 600), never printed"
umask 022
mkdir -p "$work/public/fake-resend" "$work/bin"
(
  umask 077
  cat > "$work/test.env" << EOF
SITE_DOMAIN=hopsnop.localhost
API_DOMAIN=api.hopsnop.localhost
POSTGRES_PASSWORD=$(secret 32)
RATE_LIMIT_SECRET=$(secret 48)
TWO_FACTOR_KEY=$(secret 32)
RESEND_API_KEY=re_proof_$(secret 24)
EMAIL_FROM="Hopsnop <no-reply@hopsnop.localhost>"
EOF
  mkdir -m 700 "$BACKUP_ROOT"
)
# flock is util-linux; elsewhere (macOS) the proof runs without the lock.
if ! command -v flock > /dev/null; then
  printf '#!/bin/sh\nexit 0\n' > "$work/bin/flock"
  chmod +x "$work/bin/flock"
  export PATH="$work/bin:$PATH"
fi

echo "Images"
docker compose build --quiet || { echo "build failed"; exit 1; }
docker run --rm --volume "$here/fake_resend.py:/srv/fake_resend.py:ro" --entrypoint python \
  hopsnop-api:latest /srv/fake_resend.py make-certs |
  python3 -c 'import json, sys; [open(sys.argv[1] + "/" + n, "w").write(p) for n, p in json.load(sys.stdin).items()]' \
    "$FAKE_RESEND_CERTS"
chmod 644 "$FAKE_RESEND_CERTS"/*.pem

echo "First deploy (deploy.sh --no-pull)"
check "deploy.sh: exit 0" quiet "$work/deploy1.log" "$deploy/deploy.sh" --no-pull
check "  no backup on a first deploy" test -z "$(ls -A "$BACKUP_ROOT")"
export_root_ca

echo "Containers"
for svc in postgres api frontend caddy; do
  check "$svc: healthy" equals "$(inspect "$svc" '{{.State.Health.Status}}')" healthy
  uid=$(docker compose exec -T "$svc" id -u | tr -d '\r')
  check "$svc: not root (uid $uid)" sh -c "[ -n '$uid' ] && [ '$uid' -gt 0 ]"
  check "$svc: read-only root file system" equals "$(inspect "$svc" '{{.HostConfig.ReadonlyRootfs}}')" true
  check "$svc: every capability dropped" equals "$(inspect "$svc" '{{.HostConfig.CapDrop}}')" "[ALL]"
  check "$svc: no-new-privileges" equals "$(inspect "$svc" '{{.HostConfig.SecurityOpt}}')" "[no-new-privileges:true]"
  check "$svc: restart unless-stopped" equals "$(inspect "$svc" '{{.HostConfig.RestartPolicy.Name}}')" unless-stopped
done
check "migrate: exited 0" equals "$(inspect migrate '{{.State.Status}} {{.State.ExitCode}}')" "exited 0"
check "migrate finished before the API started" python3 -c '
import datetime, sys
t = lambda s: datetime.datetime.fromisoformat(s[:26].rstrip("Z") + "+00:00")
sys.exit(0 if t(sys.argv[1]) < t(sys.argv[2]) else 1)' \
  "$(inspect migrate '{{.State.FinishedAt}}')" "$(inspect api '{{.State.StartedAt}}')"
published=$(docker ps --filter "label=com.docker.compose.project=$project" --format '{{.Names}} {{.Ports}}' | grep -- '->' | sed 's/^\([^ ]*\) .*/\1/' | sort -u | tr '\n' ' ')
check "only Caddy publishes ports" equals "$published" "$project-caddy-1 "
caddy_ports=$(docker port "$(container caddy)" | sed 's/ ->.*//' | sort -u | tr '\n' ' ')
check "  and only TCP 80 and 443" equals "$caddy_ports" "443/tcp 80/tcp "
check "postgres has no published port" test -z "$(docker port "$(container postgres)")"
check "nothing answers on the host's 5432" python3 -c '
import socket, sys
try:
    socket.create_connection(("127.0.0.1", 5432), 2)
except OSError:
    sys.exit(0)
sys.exit(1)'
pg_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$(container postgres)" | tr -d ' ')
check "caddy can't even resolve postgres" contains "$(docker compose exec -T caddy wget -T 3 -q -O /dev/null http://postgres:5432/ 2>&1)" "bad address"
check "frontend can't reach postgres at $pg_ip" docker compose exec -T frontend node -e "
const s = require('net').connect(5432, '$pg_ip');
s.setTimeout(3000, () => process.exit(0));
s.on('error', () => process.exit(0));
s.on('connect', () => process.exit(1));"
check "the frontend has no way out" docker compose exec -T frontend node -e "
fetch('https://example.com', { signal: AbortSignal.timeout(5000) }).then(() => process.exit(1), () => process.exit(0))"

echo "No secrets in the images"
for image in hopsnop-api:latest hopsnop-frontend:latest hopsnop-caddy:latest; do
  check "$image: no .env file" test -z "$(docker run --rm --entrypoint find "$image" / -xdev -name '.env*' 2> /dev/null)"
done
docker save hopsnop-api:latest hopsnop-frontend:latest hopsnop-caddy:latest -o "$work/images.tar"
check "no value of test.env in any layer or config" python3 - "$work/images.tar" "$work/test.env" << 'SCAN'
import gzip, sys, tarfile
values = [line.split("=", 1)[1].strip().encode() for line in open(sys.argv[2])
          if line.split("=", 1)[0] in ("POSTGRES_PASSWORD", "RATE_LIMIT_SECRET", "TWO_FACTOR_KEY", "RESEND_API_KEY")]
with tarfile.open(sys.argv[1]) as archive:
    for member in archive:
        if not member.isfile():
            continue
        data = archive.extractfile(member).read()
        if data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        if any(value in data for value in values):
            print("        found in", member.name)
            sys.exit(1)
SCAN
rm -f "$work/images.tar"
check "the pages have the API URL built in" docker compose exec -T frontend grep -rqF "https://api.hopsnop.localhost" /app/.next/static
check "  and no other API URL" test -z "$(docker compose exec -T frontend grep -rlF "localhost:8000" /app/.next/static)"

echo "End to end"
"$here/e2e.sh" "$work" full || failures=$((failures + 1))

echo "Retention purge, dry run"
docker compose run --rm --no-deps purge > "$work/purge.log" 2>&1
status=$?
check "exit 0" equals "$status" 0
purge_log=$(cat "$work/purge.log")
check "environment production" contains "$purge_log" "environment                   production"
check "the stack's database" contains "$purge_log" "database                      hopsnop on postgres:5432"
check "the stack's pictures" contains "$purge_log" "pictures                      /data/media"
check "counts only" contains "$purge_log" "Would remove:"
check "removes nothing: no 'Removed:'" test -z "$(grep '^Removed:' "$work/purge.log")"
check "the pictures are read-only to it" contains "$(docker compose run --rm --no-deps --entrypoint touch purge /data/media/proof 2>&1)" "Read-only file system"
sed 's/^/        /' "$work/purge.log"

echo "Second deploy"
# Untagged and unused, as postgres's image is after a `down`: only a plain prune removes it.
docker pull --quiet "$canary" > /dev/null
api_before=$(container api)
since=$(date +%s)
check "deploy.sh: exit 0" quiet "$work/deploy2.log" "$deploy/deploy.sh" --no-pull
check "  backed up first" test -n "$(ls -A "$BACKUP_ROOT")"
check "  the API paused and resumed during the backup" equals \
  "$(docker events --since "$since" --until "$(date +%s)" --filter "container=$api_before" --filter event=pause --filter event=unpause --format '{{.Action}}' | tr '\n' ' ')" "pause unpause "
check "  nothing changed, so the API was kept" equals "$(container api)" "$api_before"
check "  kept an unused image pulled by digest alone" quiet "$work/canary.log" docker image inspect "$canary"

echo "A deploy whose migration fails"
COMPOSE_FILE="$COMPOSE_FILE:$here/compose.failing-migration.yml" "$deploy/deploy.sh" --no-pull > "$work/deploy3.log" 2>&1
status=$?
check "deploy.sh: fails" test "$status" -ne 0
check "  at the migration" grep -q "migration failed on purpose" "$work/deploy3.log"
check "  the old API is still the one running" equals "$(container api)" "$api_before"
check "  and healthy" equals "$(inspect api '{{.State.Health.Status}}')" healthy
check "  and the site still answers" equals "$(curl -sS -o /dev/null -w '%{http_code}' --cacert "$work/public/root.crt" \
  --resolve api.hopsnop.localhost:443:127.0.0.1 https://api.hopsnop.localhost/health)" 200

echo "Backup"
mkdir "$BACKUP_ROOT/2026-10-20T033000Z" "$BACKUP_ROOT/2026-11-05T033000Z" "$BACKUP_ROOT/notes"
touch -t 202610200330 "$BACKUP_ROOT/2026-10-20T033000Z"
touch -t "$(date -v-2d +%Y%m%d%H%M 2> /dev/null || date -d '2 days ago' +%Y%m%d%H%M)" "$BACKUP_ROOT/2026-11-05T033000Z"
check "backup.sh: exit 0" quiet "$work/backup.log" "$deploy/backup.sh"
latest=$(sed -n 's/^Backup written to //p' "$work/backup.log")
check "  database.dump, images.tar.gz, SHA256SUMS" equals "$(cd "$latest" && find . -type f | LC_ALL=C sort | tr '\n' ' ')" "./SHA256SUMS ./database.dump ./images.tar.gz "
check "  checksums match" sh -c "cd '$latest' && sha256sum --check --quiet SHA256SUMS"
check "  folder readable by its owner only" equals "$(stat -f %Lp "$latest" 2> /dev/null || stat -c %a "$latest")" 700
check "  files too" equals "$(stat -f %Lp "$latest/database.dump" 2> /dev/null || stat -c %a "$latest/database.dump")" 600
check "  a backup older than 7 days removed" test ! -e "$BACKUP_ROOT/2026-10-20T033000Z"
check "  a recent one kept" test -d "$BACKUP_ROOT/2026-11-05T033000Z"
check "  a folder that isn't a backup kept" test -d "$BACKUP_ROOT/notes"
rows() {
  docker compose exec -T postgres psql --username=hopsnop --dbname=hopsnop --tuples-only --no-align --command="
    SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text
    FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
}
pictures() { docker compose run --rm --no-deps -T --entrypoint sh backup-images -c 'cd /data/media && find . -type f | sort | xargs -r sha256sum'; }
rows > "$work/rows-before"
pictures > "$work/pictures-before"
check "  the stack had pictures to back up" test -s "$work/pictures-before"

echo "Restore into a new stack ($restored)"
docker compose down > /dev/null 2>&1
export COMPOSE_PROJECT_NAME=$restored
check "restore.sh: exit 0" quiet "$work/restore.log" "$deploy/restore.sh" "$latest"
export_root_ca
rows > "$work/rows-after"
pictures > "$work/pictures-after"
check "every table has the same number of rows" diff "$work/rows-before" "$work/rows-after"
check "every picture is back, byte for byte" diff "$work/pictures-before" "$work/pictures-after"
"$here/e2e.sh" "$work" restored || failures=$((failures + 1))
"$deploy/restore.sh" "$latest" > "$work/restore2.log" 2>&1
status=$?
check "a second restore over it is refused (exit 2)" equals "$status" 2
check "  saying why" grep -q "Refused: the database already has" "$work/restore2.log"

echo
echo "Proof: $failures failed"
[ "$failures" -eq 0 ]
