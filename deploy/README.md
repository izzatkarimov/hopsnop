# Deploying Hopsnop

One Linux server (Ubuntu 24.04 LTS, x86_64, 4 GB RAM, in the EU) running
Docker Compose. Every command below is run on the server unless it says
otherwise. `deploy/test/` proves all of this on a laptop first
([deploy/test/README.md](test/README.md)).

```
internet ──► Caddy :80 :443 ──┬──► frontend (Next.js)       hopsnop.com
             TLS, HSTS         └──► api (FastAPI) ──► postgres   api.hopsnop.com
                                      └──► Resend (email)
```

| File | What it is |
| --- | --- |
| `compose.yml` | The services. Only Caddy publishes ports (80 and 443). PostgreSQL is on an internal network with no port; the frontend can't reach anything but Caddy |
| `caddy/` | Caddy's image and its `Caddyfile`: certificates, HSTS, the `www` redirect |
| `.env.example` | Every setting and secret, with how to make each. Copied to `.env` (never committed) |
| `deploy.sh` | A deploy: backup, `git pull`, build, migrations, new containers |
| `backup.sh`, `restore.sh` | The database and the pictures, out and back in |
| `systemd/` | Timers for the hourly purge dry run and the nightly backup |
| `../backend/Dockerfile`, `../frontend/Dockerfile` | The images: pinned base images, non-root users, no secrets in any layer |

Every container runs as a user other than root, with a read-only file system,
every Linux capability dropped and `no-new-privileges`.

## Why `api.hopsnop.com`

The security design already assumes it ([Cookie and
CSRF](../backend/README.md#cookie-and-csrf)): the pages and the API on one site
but two hosts. The session cookie (`__Host-hopsnop_session`) then belongs to
`api.hopsnop.com` alone and never reaches the Next.js server; `SameSite=Lax`,
the Origin check and CORS work as written, with `FRONTEND_URL=https://hopsnop.com`.
A path such as `hopsnop.com/api` would put both on one origin: the cookie would
go with every page request, and the proxy would have to strip the prefix.

## DNS at Namecheap

Domain List → hopsnop.com → Advanced DNS. Add, with TTL Automatic:

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | the server's IPv4 address |
| A | `www` | the server's IPv4 address |
| A | `api` | the server's IPv4 address |
| CAA | `@` | `0 issue "letsencrypt.org"` |

- **Leave every Resend record as it is** (`resend._domainkey`, `send` MX and
  TXT, `_dmarc`) and any MX record. None of the records above touches them.
- Delete Namecheap's parking records if they are there: `CNAME www
  parkingpage.namecheap.com` and the `URL Redirect` on `@`.
- AAAA records (IPv6), for the same three hosts, only if the server really
  answers on IPv6 (`curl -6 https://hopsnop.com` works from elsewhere). Let's
  Encrypt tries IPv6 first, so a wrong AAAA record stops certificates.
- The CAA record lets only Let's Encrypt issue certificates for the domain;
  Caddy is set to use it alone.

`dig +short hopsnop.com api.hopsnop.com www.hopsnop.com` (on your own
computer) shows the address three times once the records are live.

## First setup of the server

Log in as root with what the provider gave you, then:

```bash
apt update && apt full-upgrade -y
timedatectl set-timezone UTC

# A user of your own; root won't log in any more.
adduser deploy                    # asks for a password, which sudo will ask for
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # the provider's key, if root has one
```

If root had no key: on your computer, `ssh-copy-id deploy@SERVER`. Then log in
as `deploy` **in a second terminal** and keep the first one open until the
next step works.

**SSH keys only**, no passwords and no root:

```bash
sudo tee /etc/ssh/sshd_config.d/10-hopsnop.conf << 'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sudo sshd -t && sudo systemctl restart ssh
```

**Firewall**, SSH, HTTP and HTTPS only:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable
```

Docker writes its own firewall rules for published ports, past `ufw`. That is
why `compose.yml` publishes 80 and 443 and nothing else: never add a `ports:`
anywhere else.

**Security updates**, installed every day, with a reboot at 04:30 UTC when one
needs it (after the 03:30 backup; the containers start again by themselves):

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades      # answer Yes
sudo tee /etc/apt/apt.conf.d/52hopsnop << 'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
```

**Docker**, from Docker's own repository
([docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/)):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
  sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy    # log out and in again
```

Membership of the `docker` group is as good as root on this machine: keep it
to `deploy`.

**Folders**:

```bash
sudo install -d -o deploy -g deploy -m 755 /srv/hopsnop
sudo install -d -o deploy -g deploy -m 700 /srv/hopsnop-backups
```

## First deploy

```bash
git clone https://github.com/izzatkarimov/hopsnop.git /srv/hopsnop   # a read-only deploy key if it is private
cd /srv/hopsnop/deploy
cp .env.example .env && chmod 600 .env
nano .env       # fill in every empty value; each says how to make it
```

Keep a copy of `.env` in a password manager. `TWO_FACTOR_KEY` cannot be made
again: without it a restored database has no usable two-factor secret.

```bash
./deploy.sh --no-pull
docker compose ps          # postgres, api, frontend, caddy: healthy
```

Caddy gets the certificates within a minute of starting. Open
<https://hopsnop.com>, register, and check that the email arrives. Then the
timers:

```bash
sudo cp systemd/hopsnop-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hopsnop-purge.timer hopsnop-backup.timer
systemctl list-timers 'hopsnop-*'
sudo systemctl start hopsnop-purge.service && journalctl -u hopsnop-purge -n 30
```

Read the periods that last command prints ([Retention purge](#retention-purge)).

## Later deploys

```bash
cd /srv/hopsnop/deploy && ./deploy.sh
```

It takes a lock that the purge and the backup also take, backs up, pulls
`main`, builds, runs the migrations **on their own**, and only if they succeed
replaces the containers (`up --wait` returns once they are healthy). If a
migration fails, nothing is replaced and the running API stays. While a
migration runs, the previous API is still serving, so a migration must keep
working with the code of the release before it (add a column, then use it a
release later; drop it a release after it is unused).

## Logs

```bash
docker compose logs --tail 100 api        # or frontend, caddy, postgres
journalctl -u hopsnop-purge -u hopsnop-backup --since today
```

Each container's log is rotated at 10 MB, three files kept.

**No access logs, on purpose.** Neither Caddy nor uvicorn (`--no-access-log`)
writes a line per request, so no client address and no path (`/users/NAME/…`)
is written anywhere: data minimisation, in line with the application storing
no address ([Data protection](../backend/README.md#data-protection)). Errors and
warnings are still logged. What it costs: after an incident the logs can't
say who sent which requests, from where, or in what order. If that is ever
needed, add Caddy's `log` directive to a site for a limited time, note why,
and remove it again.

## Rollback

1. Find the last good commit: `git log --oneline`.
2. If the release you are leaving added migrations, undo them first, with
   the current image, which knows how:
   `docker compose run --rm migrate alembic downgrade REVISION`, where
   REVISION is the newest file of `backend/alembic/versions/` at the good
   commit (`git show GOOD:backend/alembic/versions`). If a downgrade would
   lose data, restore the backup that `deploy.sh` took before the deploy
   instead ([Restoring](#restoring)).
3. `git checkout GOOD && ./deploy.sh --no-pull`.
4. Fix forward on `main`, then `git checkout main && ./deploy.sh`.

## Backups

`backup.sh` runs every night at 03:30 UTC and before every deploy. It writes
`/srv/hopsnop-backups/<UTC time>/` with `database.dump` (`pg_dump`, custom
format), `images.tar.gz` (the pictures) and `SHA256SUMS`, readable by `deploy`
only, and removes folders older than 7 days. The API is paused for the few
seconds it takes, so requests wait rather than fail, and no row can lose its
picture between the dump and the archive. Docker then reports the API
unhealthy until its next healthcheck, up to 30 seconds later, and the script
waits for that before it ends, so a deploy after it finds a healthy API. A
dump that `pg_restore` can't read fails the backup.

**An off-server copy is needed as well**: a backup on the same disk goes with
the server, the provider account or an intruder. Copy each night's folder to
storage in the EU at a different provider (an S3-compatible bucket or a
storage box), encrypted on the server before it leaves (restic, for one), with
the encryption key kept off the server and the storage append-only or with
object lock, so that someone on the server can't delete the copies. In the EU,
the personal data in it stays under the GDPR without a transfer abroad.

Not in the backup, on purpose: `deploy/.env`. Keep it in a password manager.
A stolen backup without it leaves the two-factor secrets encrypted.

A deleted account stays in the backups until they age out: 7 days here,
however long the off-server copies are kept. Say so in the privacy notice.

## Restoring

`restore.sh FOLDER` checks `SHA256SUMS`, restores into an **empty** database
and picture volume, then runs the migrations and starts everything. It
refuses anything else. Tested end to end by `deploy/test/run.sh`.

**On a new server:** the first setup above, `git clone`, and a `.env` with the
**same** `TWO_FACTOR_KEY` and `RATE_LIMIT_SECRET` (the rest may be new). Copy
the backup folder over, then:

```bash
cd /srv/hopsnop/deploy
docker compose build
./restore.sh /srv/hopsnop-backups/2026-11-07T033000Z
```

**Over the data of this server** (going back in time), which destroys what is
there now:

```bash
./backup.sh                                   # what there is now, just in case
docker compose down
docker volume rm hopsnop_postgres_data hopsnop_images
./restore.sh /srv/hopsnop-backups/2026-11-07T033000Z
```

## Retention purge

`hopsnop-purge.timer` runs the [retention purge](../backend/README.md#retention)
at 15 minutes past every hour as a **dry run**: it prints what it would remove
and removes nothing (`journalctl -u hopsnop-purge`). It runs in the API's image
with the API's `.env`, so `TWO_FACTOR_KEY`, `RATE_LIMIT_SECRET`,
`RATE_LIMIT_WINDOW_MINUTES` and the rest are the same, and the pictures are
mounted read-only for it.

To let it remove, which is a decision of its own:

1. Decide `PURGE_UNVERIFIED_ACCOUNTS` in `.env`. On only once verification
   emails are known to arrive: on, every account not verified within
   `UNVERIFIED_ACCOUNT_RETENTION_DAYS` is removed.
2. In `compose.yml`, service `purge`: mount `images:/data/media` without
   `:ro`, and make the command
   `["python", "-m", "app.purge", "--execute", "--database", "hopsnop", "--host", "postgres:5432", "--images", "/data/media"]`.
   The three values must name this stack's database, server and folder, or it
   refuses (exit `2`).
3. Run it once by hand, `docker compose run --rm --no-deps purge`, and read
   what it printed. The timer then does the same every hour.

## Upkeep

- **Base images** are pinned by version and digest in the Dockerfiles and in
  `compose.yml`. Move to a newer version once it has been out for 14 days, as
  for every other dependency, and deploy.
- **Caddy 2.11.7 → 2.11.8, from 2026-11-18.** 2.11.8 fixes five advisories:
  [GHSA-f278-mgc7-46j3](https://github.com/advisories/GHSA-f278-mgc7-46j3)
  (`php_fastcgi`),
  [GHSA-jf74-f69g-hcj9](https://github.com/advisories/GHSA-jf74-f69g-hcj9)
  (`file_server` when the data directory falls back to `./caddy`),
  [GHSA-69hv-5jfc-mvmv](https://github.com/advisories/GHSA-69hv-5jfc-mvmv)
  (`rewrite`),
  [GHSA-25cw-38mq-q7m6](https://github.com/advisories/GHSA-25cw-38mq-q7m6)
  (the `file` matcher) and
  [GHSA-r766-rf9f-588h](https://github.com/advisories/GHSA-r766-rf9f-588h)
  (a `{host}`-based root). None applies here: this Caddyfile uses only
  `reverse_proxy`, `redir`, `header` and `respond`, and the data directory is
  `/data`.
- **Changing `POSTGRES_PASSWORD`** later takes `docker compose exec postgres
  psql -U hopsnop -c "ALTER USER hopsnop PASSWORD '…'"` as well: the variable is
  only read when the database is first created.
- **Disk**: `docker system df`; old build cache goes with
  `docker builder prune --filter until=720h`.
