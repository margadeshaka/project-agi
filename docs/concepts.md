# Concepts

A guided tour through the load-bearing concepts in `project-agi`. Read this
once and the rest of the docs make sense without backtracking. Each section
ends with a short example you can copy.

---

## Pack

A **pack** is a folder. It is the unit of multi-tenancy: one tenant ↔ one
pack ↔ one slug. The pack holds everything that varies between tenants —
identity, theme, prompts, knowledge-base content, tool allow-list,
scenarios — as YAML/Jinja/JSON. **No Python in a pack.**

```
packs/<slug>/
├── pack.yaml          # identity, theme, role bindings, tool allow-list
├── tools.yaml         # MCP tool allow-list (enforced at dispatch)
├── prompts/           # *.j2 Jinja templates
│   ├── system.j2
│   ├── deflect.j2
│   ├── resolve.j2
│   └── escalate.j2
├── kb/                # *.md / *.json knowledge-base seeds
└── scenarios/         # *.scenario.json — e2e + UI walkthroughs
```

A new tenant = drop a folder + restart the runtime (or
`POST /admin/packs/{slug}/reload`). YAML on disk is the source of truth;
the database may mirror packs for performance.

```python
from agi.packs import load_pack

pack = load_pack("packs/care-demo")
print(pack.slug, pack.version, pack.tool_allowlist)
```

See [`docs/packs/authoring.md`](packs/authoring.md) for the full pack
authoring guide.

---

## Use case

A **use case** is a Python class decorated with `@use_case(slug, version)`.
It owns one agentic flow — one prompt template, one model role, one set of
tools — and it is *the* unit the SDK runs.

```python
from agi_sdk import use_case

@use_case("bill_explainer", version="0.1.0")
class BillExplainer:
    def __init__(self, sdk):
        self.sdk       = sdk
        self.reasoning = sdk.models.binding("reasoning")
        self.billing   = sdk.mcp.tool("billing.get_invoice")

    async def handle(self, request, ctx):
        ...
```

The `@use_case` decorator stamps two sentinel attributes on the class
(`_agi_use_case_slug` and `_agi_use_case_version`). The dispatch seam
reads them when invoking. **Undecorated classes are rejected** — this is
the SDK's primary identity contract.

A use case is single-process and single-pack at the SDK level. To serve
multiple use cases or multiple packs in one process, use the runtime
(Band 2). See ADR-0002.

---

## Dispatch seam

The **dispatch seam** is the single function both `serve()` and
`agi-runtime`'s `/chat` route call into:

```python
# packages/agi-sdk/agi/dispatch.py

class InvokeRequest(BaseModel):
    messages: list[InvokeMessage]
    session_id: str | None = None
    ...

class InvokeResponse(BaseModel):
    reply: str
    tool_calls: list[InvokeToolCall]
    correlation_id: str
    ...

async def invoke_use_case(
    *,
    use_case_cls: type,
    pack: Pack,
    request: InvokeRequest,
    model_binding: ModelBinding,
    available_tools: Mapping[str, Any],
    trail_sink: TrailSink,
    correlation_id: str,
    tenant_id: str,
    session_id: str | None = None,
    checkpoint_store: Any | None = None,
) -> InvokeResponse: ...
```

It is **transport-agnostic** — no FastAPI types in `dispatch.py`. The seam
exists so:

1. `serve()` (Band 1, embedded) can drive the orchestrator end-to-end
   without spinning up the runtime.
2. `agi-runtime`'s `/chat` route (Band 2) can do exactly the same call
   after its claims-validated X-Pack middleware runs.

Both transports produce identical `InvokeResponse` payloads for identical
inputs. ADR-0002 captures the boundary.

---

## Orchestrators

A use case is driven by an **orchestrator**. The SDK ships three:

| Orchestrator | When to pick it | LOC |
|--------------|-----------------|-----|
| **Native** (default) | Most use cases. Plain `async def` + Pydantic state. No framework gravity. | `agi.orchestrators.native` |
| **LangGraph** (opt-in) | Durable runs, checkpointing, HITL, streaming with branching. | `agi.orchestrators.langgraph` (extra: `agi-sdk[langgraph]`) |
| **Pydantic-AI** (opt-in) | Type-first, Pydantic-native. Use when the use case is mostly schema validation around an LLM call. | `agi.orchestrators.pydantic_ai` (extra: `agi-sdk[pydantic-ai]`) |

Each non-native adapter is ~150 LOC. Their only job is to **set
OpenLLMetry baggage** (`bm.pack`, `bm.use_case`, `bm.tenant_id`) and
**resolve the pack's tool allow-list**. They do not wrap orchestration.
The choice is per use case, not per project — mix freely.

```python
@use_case("hello", version="0.1.0")
class Hello:
    orchestrator = "native"        # or "langgraph", "pydantic_ai"
    ...
```

---

## MCP tools

Every tool is an **MCP tool** (Model Context Protocol). No parallel tool
abstractions, no `@tool` decorators on Python functions. This makes tools
inter-operable across SDKs and clients — the same `billing.get_invoice`
tool defined here is callable by Claude Desktop, mcp-cli, or any future
MCP host.

To create tools, use the `agi-mcpfyer` CLI:

```bash
pip install agi-mcpfyer
agi-mcpfyer build path/to/openapi.yaml -o bundles/billing/
```

The CLI takes any OpenAPI 3.0+ spec — Stripe, GitHub, Twilio, your
internal microservice — and produces a runnable MCP server with the
operations exposed as tools. Drop the bundle into your pack's
`tools.yaml` allow-list and you're done.

The runtime enforces the allow-list at dispatch — a tool call to anything
outside the pack's allow-list returns a permission-denied trail event
without ever hitting the tool transport.

See [`docs/tools/authoring.md`](tools/authoring.md) for the full bundle
authoring guide.

---

## AI-Trail

The **AI-Trail** is an append-only audit log of every agent step. Every
event carries:

```json
{
  "ts":             "2026-05-23T13:14:15.123Z",
  "correlation_id": "run-abc",
  "pack_slug":      "care-demo",
  "session_id":     "sess-xyz",
  "event_type":     "llm.call | llm.response | tool.call | tool.result | invoke.start | invoke.end | error",
  "payload":        { ... }
}
```

Use cases **do not call AI-Trail directly.** Events are emitted by the
orchestrator and the dispatch seam. In Band 2, the OTel collector
overlays the regulator-grade schema on top of OpenLLMetry spans and pipes
into the configured sink (`MemoryTrailSink` for dev, `FileJsonlTrailSink`
for single-pod, Mongo / Postgres for production — see the trail-sink
config in your operator YAML).

To read events for one run:

```bash
curl http://localhost:9000/trail/run-abc
# or in the admin UI: /audit/run-abc
```

---

## X-Pack header & claims validation

**Multi-tenancy is header-dispatched.** Every request to `agi-runtime`
must carry `X-Pack: <slug>`. Missing → `400`. Unknown → `404`. No
default-pack fallback in production paths.

Crucially, the pack is **claims-resolved from the auth token**, then
**consistency-checked against the header**. Header trust alone is a
multi-tenant leak — the runtime treats the auth token as authoritative
and uses `X-Pack` as a sanity check. Mismatch → `401`.

This means `agi-runtime` is safe to deploy as **one container hosting
many tenants' packs** (the default) — the multi-tenant boundary lives in
the token, not the deployment topology.

For tenants that buy hardening (one-pod-per-pack), flip the chart's
`global.hardening.mode=single` and pin the pack via
`global.hardening.pack=<slug>`. Same chart, same image, stricter
deployment.

---

## Configuration precedence

Highest wins:

1. **Per-request headers** — `X-Pack`, `X-Correlation-Id`, `X-Session-Id`,
   `X-LLM-Override`.
2. **Environment variables** — `AGI_LLM_PROVIDER`, `AGI_TRAIL_SINK`,
   `AGI_AUTH`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LANGFUSE_HOST`, ...
3. **Active pack's `pack.yaml`** — role bindings, theme, scenarios.
4. **Operator config** (`operator.yaml`) — runtime-wide model role →
   model-id mappings, credit caps, etc.
5. **Built-in defaults** — SQLite storage, dev-noop auth, fake LLM in
   tests.

---

## Identity model

Three roles, claims-driven, enforced centrally at the dispatch middleware:

| Scope | Capability |
|-------|------------|
| `agi:admin` | Full read + write on every pack + global admin endpoints |
| `agi:viewer` | Read-only on every pack |
| `agi:operator:<slug>` | Read + write on the one pack `<slug>` only |
| `agi:dev` | Diagnostic endpoints (use-case + tool catalogue) |

The runtime ships four auth adapters in `agi-auth`:

- **dev-noop** — accepts every request, synthesises `tenant_id="dev"`.
  Tests + local dev only.
- **static-token** — single shared bearer via `AGI_STATIC_TOKEN`. Local
  Docker, demos.
- **keycloak** — reference OIDC adapter; reads `realm_access.roles` and
  filters to `agi:*`.
- **generic OIDC** — any conformant OIDC provider.

The Next.js admin console uses **NextAuth v5 + Keycloak** with PKCE,
state, and refresh-token flow. See `distribution/agi-ui/auth.ts`.

---

## What this architecture intentionally does *not* include

- **A workflow scheduler.** Use Temporal / Airflow / Inngest if you need
  one. `agi-core` stays request-scoped.
- **A built-in feedback / RLHF loop.** Out of scope.
- **A built-in eval harness.** The AI-Trail makes one possible —
  Promptfoo against trail events is the recommended pattern.
- **A built-in billing / metering subsystem.** Tenant-level concern; hook
  the trail sink.
- **Runtime-editable prompts.** Prompts live in packs as YAML/J2, baked
  into the image, PR-reviewed. The hotfix lane (≤15-min merge-to-live)
  is the answer to "I need to ship a prompt change right now."
