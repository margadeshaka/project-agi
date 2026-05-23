# SPDX-License-Identifier: Apache-2.0
# syntax=docker/dockerfile:1.7
#
# agi-ui — Next.js 14 standalone build. Compressed image budget < 60 MB.

ARG NODE_VERSION=20

# ---------- deps ----------
FROM node:${NODE_VERSION}-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
# Don't pass --omit=optional: tailwind v4-alpha pulls in lightningcss,
# whose musl native binary (lightningcss-linux-x64-musl) is registered as
# an optional dependency. Without it `npm run build` crashes with
# "Cannot find module '../lightningcss.linux-x64-musl.node'" on alpine.
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install --no-audit --no-fund; \
    fi

# ---------- builder ----------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm run build

# ---------- runner ----------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

RUN addgroup -S agi && adduser -S agi -G agi

# Next.js standalone output keeps the image lean.
COPY --from=builder --chown=agi:agi /app/public ./public
COPY --from=builder --chown=agi:agi /app/.next/standalone ./
COPY --from=builder --chown=agi:agi /app/.next/static ./.next/static

USER agi
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget --quiet --spider http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
