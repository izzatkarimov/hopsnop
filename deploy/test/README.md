# Local proof of the deployment

`run.sh` runs the production stack of `deploy/` on this machine and checks it:
the same `compose.yml`, `Caddyfile`, images and scripts, under test names.

```bash
./deploy/test/run.sh                       # from the repository root; prints ok/FAIL per check
HOPSNOP_PROOF_KEEP=1 ./deploy/test/run.sh  # keeps the stacks and the work folder to look at
```

It needs Docker, `curl`, `python3`, and ports 80 and 443 free. A run takes a
few minutes and ends with `Proof: 0 failed`, or with the number that failed.

What differs from production, and why:

| | Production | Here |
| --- | --- | --- |
| Domains | `hopsnop.com`, `www.`, `api.` | `hopsnop.localhost`, `www.`, `api.` |
| Certificates | Let's Encrypt | Caddy's own CA, which it uses for `*.localhost` by itself; `curl` is given its root |
| Secrets | `deploy/.env` | Generated for the run into a temporary folder (mode 600), never printed, deleted at the end |
| Email | Resend | `fake_resend.py` at `api.resend.com` inside the stack (`compose.test.yml`), so the verification link really is emailed and nothing leaves the machine |
| Compose projects | `hopsnop` | `hopsnop-localtest`, then `hopsnop-restoretest` for the restore, each with its own volumes, removed at the end |

What it checks, in order:

1. **First deploy** with `deploy.sh --no-pull`: every container healthy, not
   root, read-only, no capabilities, `no-new-privileges`; migrations done
   before the API started; only Caddy publishing ports, TCP 80 and 443;
   PostgreSQL unreachable from the host, from Caddy and from the frontend; the
   frontend with no way out; no `.env` file and no secret in any image layer.
2. **End to end** (`e2e.sh`), through Caddy: the pages' headers and CSP nonce,
   the `www` and `http://` redirects, the API's headers and CORS; register,
   the emailed link, verify, log in (the `__Host-` cookie), a post, an avatar;
   a write from another origin refused; forged `X-Forwarded-For` ignored, and
   another client counted by its own address.
3. **The purge dry run**, as the timer runs it.
4. **A second deploy**: backed up first, with the API paused and resumed; and
   **a deploy whose migration fails** (`compose.failing-migration.yml`): it
   stops there and the old API keeps serving.
5. **A backup** (and that folders older than 7 days go), then **a restore**
   into a new, empty stack: the same rows in every table, the same pictures,
   the same account, post and avatar; and a second restore refused.
