# agi-core

> Intelligence Core — registry, hub proxy, shared HTTP surface for project-agi.

Generalised from the v0 `bm_core`. Renamed namespace, no TMF assumptions, no `bm_` identifiers. Operates against **any** MCP tool bundle produced by `agi-mcpfyer`.

## What's here

| Module | Role |
|---|---|
| `agi_core.registry` | `ToolDescriptor`, `UseCaseDescriptor`, in-memory `Registry` (with optional JSON persistence) |
| `agi_core.hub` | `HubProxy` — forwards MCP tool calls to a per-domain backend (mcpfyer-generated MCP server in Phase 3) |
| `agi_core.http_routes` | FastAPI router with `/registry/tools`, `/registry/use-cases`, `/hub/*` |
| `agi_core.settings` | Pydantic settings — hub endpoints, registry storage path, log level (`AGI_CORE_*` env) |
| `agi_core.main` | Uvicorn-launchable FastAPI app wiring everything together, healthcheck at `/healthz` |

## Run

```bash
uvicorn agi_core.main:app --port 9000
# → http://localhost:9000/healthz
# → http://localhost:9000/registry/tools
```

## Status

- Registry + HTTP surface: working in-memory; JSON file persistence opt-in.
- Hub proxy: pluggable per logical domain; uses `httpx` against configured endpoints. Hub backends in Phase 2 are stubs that echo the request — real MCP forwarding to mcpfyer servers lands in Phase 3.
- License: Apache-2.0.
