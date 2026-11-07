# The API, for production (deploy/compose.yml). Settings come from the
# environment at run time; nothing secret is in any layer.

# Python 3.12.15, Debian 13; the digest pins the exact build.
FROM python:3.12.15-slim-trixie@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704 AS build

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN python -m venv /opt/venv
COPY requirements.txt /tmp/requirements.txt
# Every package at its locked version and hash, indirect ones too.
RUN /opt/venv/bin/pip install --require-hashes -r /tmp/requirements.txt \
    && /opt/venv/bin/pip check


FROM python:3.12.15-slim-trixie@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    IMAGE_STORAGE_PATH=/data/media

RUN useradd --system --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin hopsnop \
    && mkdir -p /data/media \
    && chown hopsnop:hopsnop /data/media

COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

USER hopsnop
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

# Client addresses come from X-Forwarded-For only when FORWARDED_ALLOW_IPS names the sender.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
