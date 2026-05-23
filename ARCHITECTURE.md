# project-agi — architecture

Three layers, one repo, two distributions. Borrowed shape from `care-intelligence` and refined for an open-source audience.

```
┌─────────────────────────────────────────────────────────────────┐
│                          packs/  (tenants)                       │
│  blank · telco-demo · fleet-demo · <your-pack>                   │
│  YAML/JSON only — no code                                        │
└────────────────────────────────┬────────────────────────────────┘
                                 │ loaded at runtime
┌────────────────────────────────┴────────────────────────────────┐
│                       agi-runtime  (server)                      │
│  FastAPI HTTP + MCP server. Optional. Hosts agi-ui.              │
│  Routes: /chat /tools /kb /trail /mcp                            │
│  Header-dispatched per-tenant (X-Pack).                          │
└────────────────────────────────┬────────────────────────────────┘
                                 │ depends on
┌────────────────────────────────┴────────────────────────────────┐
│                     agi-core  (the framework)                    │
│  AgentRuntime · LLM registry · Tool registry · KB · Trail        │
│  Pack loader · Storage adapter · Auth adapter                    │
│  Pure Python lib. Embeddable. No mandatory server.               │
└─────────────────────────────────────────────────────────────────┘
```

## Layer 1 — agi-core (the framework)

Pure Python. No HTTP, no React. You can import it from a Lambda, a CLI, a Jupyter notebook, a Django app.

### Modules

| Module | Responsibility |
|---|---|
| `agi.agent` | LangGraph state-machine agent loop, prompt assembly, message history. |
| `agi.llm` | Provider registry. Built-ins: `openai`, `anthropic`, `bedrock`, `ollama`, `fake`. Each implements a thin `LLMProvider` protocol. Failover order configured per-pack. |
| `agi.tools` | Tool registry. Tools declare a JSON Schema for arguments and a Python handler. Allow-list resolved per-pack at dispatch. |
| `agi.kb` | Knowledge-base retriever. Pluggable vector store: `inmem`, `qdrant`, `mongo-atlas-search`, `pgvector`. |
| `agi.packs` | Pack loader and validator. Reads `pack.yaml`, resolves references, returns an immutable `Pack` object. |
| `agi.trail` | Append-only AI-Trail. Pluggable sink: `memory`, `file-jsonl`, `mongo`. Every event carries a `correlation_id`, `pack_slug`, `event_type`, `payload`, `ts`. |
| `agi.adapters.storage` | KV/document storage. Built-ins: `sqlite` (default), `mongo`, `postgres`, `memory`. |
| `agi.adapters.auth` | Auth verification. Built-ins: `static-token`, `oidc`, `dev-noop`. |

### Public surface

```python
from agi_core import AgentRuntime, load_pack

pack    = load_pack("packs/telco-demo")
runtime = AgentRuntime(pack=pack)

reply = runtime.chat(
    user_message="My eSIM isn't activating",
    session_id="abc",
    correlation_id="run-1",
)
```

That's it. Everything else (which LLM, which tools, which KB, which storage, which auth) comes from the pack and from env-driven config.

### Isolation rule

`agi-core` imports nothing from `agi_runtime`, `agi_ui`, or any external orchestration. Tests enforce this — same gate idea care-intelligence uses against `crm_*` imports.

## Layer 2 — agi-runtime (the platform server)

Thin FastAPI shell around `agi-core`. The "platform" part of the proposition.

### Why it's separate

- A consumer who wants only the lib does not pay the FastAPI + uvicorn + MCP-server tax.
- A consumer who wants the turnkey stack gets a clean container image.
- The boundary forces `agi-core` to stay UI/transport-agnostic.

### Endpoints

| Route | Purpose |
|---|---|
| `POST /chat` | Stateless or session-keyed chat against the active pack. |
| `GET /tools` | List of tools available in the active pack (post-allowlist). |
| `POST /tools/{name}` | Direct tool invocation (useful for debugging and for the UI inspector). |
| `GET /kb/search?q=` | KB retrieval against the active pack's KB. |
| `GET /trail/{correlation_id}` | Read AI-Trail events for one agent run. |
| `POST /mcp` | MCP-protocol endpoint (so MCP clients can use agi-runtime directly). |
| `GET /healthz`, `GET /readyz` | Standard liveness/readiness. |
| `GET /admin/llm` | Active provider + last-known health. |

### Pack dispatch

Every request reads `X-Pack: <slug>`. Missing header → 400. Unknown pack → 404. No default-pack fallback. (Same rule care-intelligence enforces with `X-Brand`.)

### Deployment topology

```
                  ┌────────────────────────────┐
        ┌─────────┤        agi-ui (opt)        │ Next.js
        │         └────────────┬───────────────┘
        │                      │ HTTP
        │         ┌────────────┴───────────────┐
        │         │        agi-runtime         │ FastAPI :9000
        │         └────────────┬───────────────┘
        │                      │
HTTP   ─┤        ┌─────────────┼─────────────┐
        │        │             │             │
        │ ┌──────┴─────┐ ┌─────┴────┐ ┌──────┴──────┐
        └─┤ MongoDB    │ │ Vector   │ │  LLM        │
          │ (storage   │ │ store    │ │  provider   │
          │  + trail)  │ │ (qdrant) │ │ (openai /   │
          └────────────┘ └──────────┘ │  ollama)    │
                                      └─────────────┘
```

All four backing services are pluggable; the only one that's mandatory is **a** storage adapter and **a** LLM provider.

## Layer 3 — agi-ui (optional)

Next.js 14+ app, Tailwind + shadcn/ui. Talks to `agi-runtime` via `fetch`. Reads theme tokens from the active pack — no hex literals in components.

Screens:

| Screen | Purpose |
|---|---|
| Pack switcher | Pick the active pack (sets `X-Pack` header for subsequent requests). |
| Agent chat | The demo surface. |
| Tool inspector | List of tools in the active pack; lets you invoke one with JSON args. |
| AI-Trail viewer | Tree of events for one `correlation_id`. |
| KB browser | Read-only browser of the pack's KB. |
| Admin · LLM | Active provider, last health-check, switch primary. |

The UI is **strictly optional**. The Docker stack runs without it; embedded use-cases never see it.

## The pack model

A pack is a folder. Loading one is a function call. Replacing the active pack is a header change.

```
packs/<slug>/
├── pack.yaml          # identity, theme, tool allow-list, LLM preference
├── tools.yaml         # declarative tool definitions
├── prompts/           # j2 templates — system prompt, scenario overrides
├── kb/                # markdown / JSON KB seeds; loaded into the active KB store
├── scenarios/         # optional demo scenarios (drives e2e tests + UI walkthroughs)
└── assets/            # logos, favicons (served by agi-ui)
```

### Why packs and not a database table

- A pack is reviewable in PR. A row in a DB isn't.
- A pack is portable across deployments without an export script.
- Theme + tools + KB + prompts live together, so a brand refresh is one folder change.

The runtime *can* mirror packs to the DB for performance, but the YAML on disk is the source of truth. Cache invalidation = restart, or `POST /admin/packs/reload`.

## Audit (AI-Trail)

One append-only stream, scoped by `correlation_id`. Every event carries:

```json
{
  "ts":             "2026-05-22T13:14:15.123Z",
  "correlation_id": "run-abc",
  "pack_slug":      "telco-demo",
  "session_id":     "sess-xyz",
  "event_type":     "llm_request | llm_response | tool_call | tool_result | error | handoff",
  "payload":        { ... }
}
```

This is the same shape care-intelligence's `ai_trail` collection uses, generalised. It's what lets a reviewer reconstruct "why did the agent do X" without reading the LLM provider's logs.

## Config precedence

Highest wins:

1. Per-request headers (`X-Pack`, `X-LLM-Override`).
2. Env vars (`AGI_LLM_DEFAULT`, `AGI_STORAGE_URL`, `AGI_AUTH_MODE`).
3. Active pack's `pack.yaml`.
4. Built-in defaults (SQLite storage, dev-noop auth, fake LLM in tests).

## What this architecture intentionally does *not* include

- A scheduler / workflow engine. Use Temporal/Airflow if you need one; agi-core stays request-scoped.
- A built-in feedback / RLHF loop. Out of scope for v1.
- A built-in evals harness. The AI-Trail makes one possible, but the harness itself ships separately if at all.
- A built-in billing / metering subsystem. Tenant-level. Hook the trail sink.

## Comparison table

> **Framing note.** care-intelligence is the *prior internal stack* whose patterns informed the open-source design here — it is **not** a retrofit target for project-agi. The table below is kept as historical lineage so a reader can see which architectural moves are new and which were ratified by an earlier production system. The final paragraph below this table records the intended direction: care-intelligence eventually becomes a *consumer* of project-agi, validating that the framework survives contact with a real solution module.

| Concern | care-intelligence (today) | project-agi (target) |
|---|---|---|
| Coupling to a CRM | Yes (customer/ticket/case/billing domains) | None. Domains live in packs, not core. |
| Brand | `brand_slug`, `X-Brand` | `pack_slug`, `X-Pack` (same idea, generalised). |
| Solution module location | `app/solutions/care_intelligence/` inside a larger backend | Standalone repo. |
| Audience | Comviva demo + internal solutions | Anyone with Docker. |
| LLM defaults | Bedrock + Ollama | OpenAI / Anthropic + Ollama; Bedrock optional. |
| Auth | Keycloak realm `bm-demo5` | OIDC pluggable; static-token default for self-host. |

The intent is that care-intelligence eventually becomes a *consumer* of project-agi — its three-layer pattern is the validation that this architecture survives contact with real solution modules.
