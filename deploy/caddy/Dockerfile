# Caddy 2.11.7; the digest pins the exact build. Move to 2.11.8 from 2026-11-18 (deploy/README.md).
FROM caddy:2.11.7-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5

# A plain copy drops the binary's file capability, which would make exec fail with
# every capability dropped; Docker lets an unprivileged process bind 80 and 443 anyway.
RUN cp /usr/bin/caddy /tmp/caddy && mv /tmp/caddy /usr/bin/caddy \
    && addgroup -S -g 10002 caddy \
    && adduser -S -D -H -u 10002 -G caddy -s /sbin/nologin caddy \
    && chown -R caddy:caddy /data /config

COPY Caddyfile /etc/caddy/Caddyfile

USER caddy

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
