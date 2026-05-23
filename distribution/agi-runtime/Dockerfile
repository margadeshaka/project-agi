# SPDX-License-Identifier: Apache-2.0
# syntax=docker/dockerfile:1.7
#
# agi-runtime — multi-stage uv build. Image size budget < 200 MB.

ARG PYTHON_VERSION=3.13

# ---------- builder ----------
FROM python:${PYTHON_VERSION}-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /build

# Workspace metadata first for layer caching.
COPY pyproject.toml /build/pyproject.toml
COPY distribution/agi-runtime/pyproject.toml /build/distribution/agi-runtime/pyproject.toml
COPY distribution/agi-auth/pyproject.toml /build/distribution/agi-auth/pyproject.toml
COPY packages/agi-sdk/pyproject.toml /build/packages/agi-sdk/pyproject.toml
COPY packages/agi-core/pyproject.toml /build/packages/agi-core/pyproject.toml

# Sources.
COPY distribution/agi-runtime /build/distribution/agi-runtime
COPY distribution/agi-auth /build/distribution/agi-auth
COPY packages/agi-sdk /build/packages/agi-sdk
COPY packages/agi-core /build/packages/agi-core

RUN uv sync --package agi-runtime --frozen --no-dev || \
    uv sync --package agi-runtime --no-dev

# ---------- runtime ----------
FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AGI_PORT=9000 \
    PATH="/app/.venv/bin:$PATH"

RUN groupadd -r agi && useradd -r -g agi -d /app -s /sbin/nologin agi

WORKDIR /app

COPY --from=builder /build/.venv /app/.venv
COPY --from=builder /build/distribution/agi-runtime /app/distribution/agi-runtime
COPY --from=builder /build/distribution/agi-auth /app/distribution/agi-auth
COPY --from=builder /build/packages /app/packages

USER agi
EXPOSE 9000

HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD python -c "import httpx; httpx.get('http://localhost:9000/healthz').raise_for_status()" || exit 1

CMD ["agi-runtime"]
