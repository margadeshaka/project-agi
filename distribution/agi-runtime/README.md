# agi-runtime

Reference FastAPI runtime for project-agi. Hosts one or more packs per pod
and dispatches requests with claims-validated `X-Pack` routing.

## Routes

| Path | Purpose |
|------|---------|
| `GET /healthz` | Liveness |
| `GET /readyz` | Readiness (graceful degradation) |
| `POST /chat` | Agent chat — drives the native orchestrator end-to-end |
| `GET /tools` | Cross-pack tool catalogue (bundle-backed) |
| `GET /packs/{slug}/tools` | Pack-scoped, post-allowlist tool catalogue |
| `GET /tools/{name}` | Tool descriptor detail |
| `POST /tools/{name}` | Tool dispatch (requires `agi:dev` scope; stub envelope) |
| `GET /trail` | AI Trail audit log (filters: `pack`, `event`, `from`, `to`) |
| `GET /trail/{cid}` | Trail events for one correlation id |
| `POST /admin/packs/{slug}/reload` | Reload one pack from disk |
| `GET /admin/llm/bindings` | Read-only role-to-model bindings |
| `GET /admin/use-cases` | Use-case registry per pack |
| `GET /admin/log` | Append-only admin action log |
| `GET /admin/status` | Process status (uptime, active packs, bundles) |

## Run

```bash
uv run --package agi-runtime agi-runtime
# or
docker compose -f deploy/docker/docker-compose.yml up agi-runtime
```

Required headers on every non-health request:
- `Authorization: Bearer <token>` — verified by configured auth adapter
- `X-Pack: <slug>` — must equal the token's `tenant_id` claim

Missing header → 400. Claim mismatch → 401. **No header-only trust.**

## Configuration

The runtime resolves config from four layers (highest precedence first):

  1. Per-request headers (`X-Max-Steps`, …)
  2. Environment variables (`AGI_*`)
  3. Operator YAML at `$AGI_OPERATOR_CONFIG` (default `/etc/agi/operator.yaml`)
  4. Built-in defaults

Key environment variables:

| Var | Default | Purpose |
|-----|---------|---------|
| `AGI_OPERATOR_CONFIG` | `/etc/agi/operator.yaml` | Path to operator YAML |
| `AGI_PACKS_DIR` | `/etc/agi/packs` | Where `PackLoader` scans |
| `AGI_BUNDLES_DIR` | `/etc/agi/bundles` | Where `BundleLoader` scans |
| `AGI_TRAIL_FILE` | _(memory)_ | Switch trail sink to JSONL on disk |
| `AGI_MAX_STEPS` | `50` | Orchestrator step budget |
| `AGI_DEFAULT_MODEL_ID` | — | Single-binding fallback for `make dev` smoke tests |
| `AGI_OTEL_DISABLED` | _(off)_ | Skip Traceloop init (set in unit tests) |

## OpenTelemetry / Langfuse

The runtime initialises Traceloop at startup (skipped when
`AGI_OTEL_DISABLED=1`). Set `OTEL_EXPORTER_OTLP_ENDPOINT` to ship spans
direct to Langfuse v3:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://langfuse:3000/api/public/otel
```

OTel baggage is set on every orchestrator step (`bm.pack`, `bm.use_case`,
`bm.use_case.version`, `bm.run_id`, `bm.tenant_id`) — the wire-format prefix
is `bm.*` so Langfuse-side dashboards built against earlier releases keep
working.

## Pack & bundle layout on disk

```
/etc/agi/packs/
  acme/
    pack.yaml           # slug, version, name, declared model roles
    tools.yaml          # tool allowlist
    prompts/
    kb/

/etc/agi/bundles/
  billing-v4/           # one subdir per MCPfyer-built bundle
    manifest.json
    tools.json
```

The runtime loads both directories once at startup. Use
`POST /admin/packs/{slug}/reload` to pick up edits without a restart.
