# deploy/docker — local stack

`docker compose up` quickstart for the project-agi reference distribution.

## Services

| Service | Port | Purpose |
|---------|------|---------|
| `agi-runtime` | 9000 | FastAPI + claims-validated X-Pack dispatch |
| `agi-ui` | 8080 | Next.js admin console |
| `langfuse` | 3000 | Trace UI (OTLP ingestion) |
| `langfuse-postgres` | — | Langfuse backing store |
| `qdrant` | 6333 / 6334 | Vector store |
| `mongodb` | 27017 | Runtime storage (executed actions, ai_trail) |
| `otel-collector` | 4317 / 4318 | OTel ingest, pipes to Langfuse |

## Quickstart

```bash
cp .env.example .env
# edit .env

docker compose up -d

# Verify
curl http://localhost:9000/healthz
open  http://localhost:8080
open  http://localhost:3000   # Langfuse
```

## Mounting your packs

Default mount is `../../packages/agi-packs:/packs:ro`. Drop a pack folder
in there and the runtime will pick it up on next reload.

## Tearing down

```bash
docker compose down            # keep volumes
docker compose down --volumes  # nuke data
```

## Phase 3 phase-gate criteria

This compose file ships with the P3 phase gate. `docker compose up` MUST
result in `/healthz` returning 200 within 30 seconds; `/readyz` reports
degraded components but stays 200. Full agent / chat behavior lands in
P3 proper.
