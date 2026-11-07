#!/usr/bin/env bash
# HTTP checks through Caddy against the stack run.sh started (deploy/test/README.md).
#   e2e.sh WORK full       headers; register, verify, log in, post, avatar; client addresses
#   e2e.sh WORK restored   after a restore: the same account, post and avatar
set -uo pipefail

work=${1:?usage: e2e.sh WORK_DIR full|restored}
mode=${2:?usage: e2e.sh WORK_DIR full|restored}
site=https://hopsnop.localhost
api=https://api.hopsnop.localhost
failures=0

ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
check() {
  local name=$1
  shift
  if "$@"; then ok "$name"; else fail "$name"; fi
}
equals() { [ "$1" = "$2" ] || { printf '        got: %s\n        expected: %s\n' "$1" "$2"; return 1; }; }
contains() { case "$1" in *"$2"*) return 0 ;; *) printf '        %s\n        lacks: %s\n' "$1" "$2"; return 1 ;; esac; }

# req NAME CURL_ARGS...: headers to NAME.h, body to NAME.b; prints the status.
req() {
  local name=$1
  shift
  curl -sS --cacert "$work/public/root.crt" \
    --resolve hopsnop.localhost:443:127.0.0.1 --resolve www.hopsnop.localhost:443:127.0.0.1 \
    --resolve api.hopsnop.localhost:443:127.0.0.1 --resolve hopsnop.localhost:80:127.0.0.1 \
    -o "$work/$name.b" -D "$work/$name.h" -w '%{http_code}' "$@"
}
header() { grep -i "^$2:" "$work/$1.h" | head -1 | cut -d' ' -f2- | tr -d '\r'; }
field() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$work/$1.b" "$2"; }
nonce_of() { header "$1" content-security-policy | sed -n "s/.*'nonce-\([^']*\)'.*/\1/p"; }
json_body() { python3 -c 'import json, sys; it = iter(sys.argv[1:]); print(json.dumps(dict(zip(it, it))))' "$@"; }
post_json() { local name=$1 url=$2 body=$3; shift 3; req "$name" -X POST -H "Origin: $site" -H 'Content-Type: application/json' --data "$body" "$@" "$url"; }
random() { python3 -c "import secrets; print(secrets.token_$1($2))"; }

log_in() {
  equals "$(post_json login "$api/auth/login" "$(json_body identifier "$1" password "$2")" -c "$work/cookies")" 200
}

if [ "$mode" = full ]; then
  echo "Pages (hopsnop.localhost)"
  check "a page answers 200" equals "$(req page1 "$site/login")" 200
  csp=$(header page1 content-security-policy)
  nonce1=$(nonce_of page1)
  check "the CSP has a nonce" test -n "$nonce1"
  check "the page's scripts carry it" grep -q "nonce=\"$nonce1\"" "$work/page1.b"
  req page2 "$site/login" > /dev/null
  check "each response has a new nonce" test "$nonce1" != "$(nonce_of page2)"
  check "connect-src: self and the API" contains "$csp" "connect-src 'self' $api"
  check "img-src: self, data:, blob: and the API" contains "$csp" "img-src 'self' data: blob: $api"
  check "frame-ancestors 'none'" contains "$csp" "frame-ancestors 'none'"
  check "upgrade-insecure-requests (API on HTTPS)" contains "$csp" "upgrade-insecure-requests"
  check "HSTS from Caddy" equals "$(header page1 strict-transport-security)" "max-age=31536000; includeSubDomains"
  check "X-Content-Type-Options" equals "$(header page1 x-content-type-options)" nosniff
  check "Referrer-Policy" equals "$(header page1 referrer-policy)" no-referrer
  check "X-Frame-Options" equals "$(header page1 x-frame-options)" DENY
  check "Cross-Origin-Opener-Policy" equals "$(header page1 cross-origin-opener-policy)" same-origin
  check "Permissions-Policy" contains "$(header page1 permissions-policy)" "camera=()"
  check "no X-Powered-By" test -z "$(header page1 x-powered-by)"
  check "/_next/image is 404" equals "$(req image "$site/_next/image?url=%2Ffavicon.ico&w=64&q=75")" 404
  check "www redirects permanently" equals "$(req www "https://www.hopsnop.localhost/login?from=www")" 301
  check "  to the same path on the site" equals "$(header www location)" "$site/login?from=www"
  check "  with HSTS" equals "$(header www strict-transport-security)" "max-age=31536000; includeSubDomains"
  check "http:// redirects to https://" equals "$(req http "http://hopsnop.localhost/login")" 308
  check "  to the same path" equals "$(header http location)" "$site/login"

  echo "API (api.hopsnop.localhost)"
  check "/health answers 200" equals "$(req health "$api/health")" 200
  check "Content-Security-Policy" equals "$(header health content-security-policy)" "default-src 'none'; frame-ancestors 'none'"
  check "X-Content-Type-Options" equals "$(header health x-content-type-options)" nosniff
  check "Referrer-Policy" equals "$(header health referrer-policy)" no-referrer
  check "Cache-Control" equals "$(header health cache-control)" no-store
  check "HSTS from Caddy" equals "$(header health strict-transport-security)" "max-age=31536000; includeSubDomains"
  check "no documentation in production" equals "$(req docs "$api/docs")" 404
  check "CORS preflight from the site" equals "$(req preflight -X OPTIONS -H "Origin: $site" \
    -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' \
    "$api/auth/register")" 200
  check "  allows exactly the site" equals "$(header preflight access-control-allow-origin)" "$site"
  check "  with credentials" equals "$(header preflight access-control-allow-credentials)" true
  check "  and refuses another origin: 400" equals "$(req evil-preflight -X OPTIONS -H 'Origin: https://evil.example' \
    -H 'Access-Control-Request-Method: POST' "$api/auth/register")" 400
  check "  without allowing it" test -z "$(header evil-preflight access-control-allow-origin)"

  echo "An account, end to end through the proxy"
  user="proof_$(random hex 4)"
  password=$(random urlsafe 18)
  email="$user@example.com"
  check "register: 202" equals "$(post_json register "$api/auth/register" \
    "$(json_body username "$user" email "$email" password "$password" display_name Proof)")" 202
  mail=""
  for _ in $(seq 1 20); do
    mail=$(docker compose logs --no-log-prefix fake-resend 2>/dev/null | grep -F "\"$email\"" | tail -1)
    [ -n "$mail" ] && break
    sleep 0.5
  done
  check "the verification email went to Resend's API" test -n "$mail"
  check "  with the API key" contains "$mail" '"authorized": true'
  check "  from EMAIL_FROM" contains "$mail" '"from": "Hopsnop <no-reply@hopsnop.localhost>"'
  token=$(printf '%s' "$mail" | python3 -c 'import json, re, sys; print(re.search(r"/verify-email\?token=([A-Za-z0-9_\-]+)", json.load(sys.stdin)["text"]).group(1))')
  check "  with a link to the site" test -n "$token"
  check "verify the address: 200" equals "$(post_json verify "$api/auth/verify-email" "$(json_body token "$token")")" 200
  check "log in: 200" log_in "$user" "$password"
  cookie=$(header login set-cookie)
  check "cookie: __Host- prefix" contains "$cookie" "__Host-hopsnop_session="
  check "cookie: Secure" contains "$cookie" "Secure"
  check "cookie: HttpOnly" contains "$cookie" "HttpOnly"
  check "cookie: SameSite=lax" contains "$cookie" "SameSite=lax"
  check "cookie: Path=/" contains "$cookie" "Path=/"
  check "cookie: no Domain" test -z "$(printf '%s' "$cookie" | grep -i 'domain=')"
  check "GET /auth/me with it: 200" equals "$(req me -b "$work/cookies" "$api/auth/me")" 200
  check "  is that account" equals "$(field me username)" "$user"
  check "a write from another origin: 403" equals "$(req evil -X POST -b "$work/cookies" \
    -H 'Origin: https://evil.example' -H 'Content-Type: application/json' \
    --data '{"content": "should not be posted"}' "$api/posts")" 403
  content="Posted through Caddy at $(date -u +%H:%M:%S)"
  check "post: 201" equals "$(post_json post "$api/posts" "$(json_body content "$content")" -b "$work/cookies")" 201
  post_id=$(field post id)
  check "read it back: 200" equals "$(req post-get "$api/posts/$post_id")" 200
  check "  same text" equals "$(field post-get content)" "$content"
  python3 - "$work/avatar.png" << 'PNG'
import struct, sys, zlib
w = h = 64
rows = b"".join(b"\x00" + bytes((200, 80, 40)) * w for _ in range(h))
chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
PNG
  check "upload an avatar: 200" equals "$(req avatar -X PUT -b "$work/cookies" -H "Origin: $site" \
    -F "image=@$work/avatar.png;type=image/png" "$api/users/me/avatar")" 200
  avatar_url=$(field avatar avatar_url)
  check "the avatar is served: 200" equals "$(req avatar-get "$api$avatar_url")" 200
  check "  as WebP" equals "$(header avatar-get content-type)" image/webp
  check "  only to the same site" equals "$(header avatar-get cross-origin-resource-policy)" same-site
  etag=$(header avatar-get etag)
  check "  with an ETag" test -n "$etag"
  json_body user "$user" password "$password" post_id "$post_id" content "$content" \
    avatar_url "$avatar_url" etag "$etag" > "$work/account.json"

  echo "Client addresses (5 registrations per address per 15 minutes)"
  for n in 2 3 4 5; do
    status=$(post_json "reg$n" "$api/auth/register" \
      "$(json_body username "${user}_$n" email "${user}_$n@example.com" password "$password" display_name Proof)" \
      -H "X-Forwarded-For: 203.0.113.$n")
    check "registration $n of 5, X-Forwarded-For forged: 202" equals "$status" 202
  done
  check "the 6th, forged as yet another address: 429" equals "$(post_json reg6 "$api/auth/register" \
    "$(json_body username "${user}_6" email "${user}_6@example.com" password "$password" display_name Proof)" \
    -H 'X-Forwarded-For: 198.51.100.6')" 429
  other=$(docker run --rm --network "${COMPOSE_PROJECT_NAME}_edge" \
    --add-host api.hopsnop.localhost:172.31.253.2 --volume "$work/public:/proof:ro" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true --entrypoint python hopsnop-api:latest -c '
import json, ssl, sys, urllib.error, urllib.request
body = json.dumps({"username": sys.argv[1], "email": sys.argv[1] + "@example.com", "password": sys.argv[2], "display_name": "Proof"}).encode()
request = urllib.request.Request("https://api.hopsnop.localhost/auth/register", body, method="POST",
    headers={"Origin": "https://hopsnop.localhost", "Content-Type": "application/json"})
try:
    print(urllib.request.urlopen(request, context=ssl.create_default_context(cafile="/proof/root.crt")).status)
except urllib.error.HTTPError as error:
    print(error.code)' "${user}_7" "$password")
  check "another client, from its own address: 202" equals "$other" 202
fi

if [ "$mode" = restored ]; then
  read_saved() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$work/account.json" "$1"; }
  echo "After the restore"
  check "log in with the same password: 200" log_in "$(read_saved user)" "$(read_saved password)"
  check "GET /auth/me: 200" equals "$(req me -b "$work/cookies" "$api/auth/me")" 200
  check "the post: 200" equals "$(req post-get "$api/posts/$(read_saved post_id)")" 200
  check "  same text" equals "$(field post-get content)" "$(read_saved content)"
  check "the avatar: 200" equals "$(req avatar-get "$api$(read_saved avatar_url)")" 200
  saved_etag=$(read_saved etag)
  check "  an ETag was saved before the backup" test -n "$saved_etag"
  check "  same picture (ETag)" equals "$(header avatar-get etag)" "$saved_etag"
fi

echo "e2e $mode: $failures failed"
[ "$failures" -eq 0 ]
