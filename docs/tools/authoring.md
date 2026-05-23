# Authoring an MCP tool bundle

In `project-agi`, **every tool is an MCP tool**. There are no `@tool`
decorators on Python functions, no parallel tool abstractions. This
keeps the tool plane inter-operable across SDKs and MCP hosts.

Two paths to ship a tool:

1. **Auto-generate** from an OpenAPI 3.0+ spec via `agi-mcpfyer` (the
   bundled CLI). Best for wrapping existing HTTP APIs.
2. **Hand-author** a bundle directory by writing the manifest and tool
   schemas yourself. Best for tools without an HTTP API (local-only ops,
   custom logic).

This guide covers both.

---

## Bundle layout

```
bundles/<bundle-name>/
├── bundle.yaml          # bundle manifest (version, tool list, transport)
├── openapi.yaml         # optional — present if auto-generated
└── tools/
    ├── <tool-1>.json    # JSON schema + side-effect metadata
    └── <tool-2>.json
```

The bundle is loaded by the runtime's `BundleLoader` at startup. The
pack's `tools.yaml` references tools by **bare name** (not bundle-name);
the BundleLoader resolves the mapping.

---

## Path 1: auto-generate from OpenAPI

```bash
pip install agi-mcpfyer
agi-mcpfyer build path/to/openapi.yaml -o bundles/billing/
agi-mcpfyer inspect bundles/billing/        # show the tools that landed
```

`agi-mcpfyer` walks every operation in the OpenAPI spec and produces one
MCP tool per operation, with:

- `name = <tag>.<operationId>` (e.g. `billing.get_invoice`)
- `input_schema` = combined query / path / header / body schema
- `side_effect = "read" | "write"` derived from the HTTP method
- `dry_run_supported = True` for `write` tools that accept a
  `dry_run=true` query param

The generated bundle wraps the HTTP API at runtime — each tool call
becomes an `httpx.AsyncClient` request with bearer/token auth pulled
from the operator config.

---

## Path 2: hand-author a bundle

For tools that don't wrap HTTP (e.g. a local computation, a feature
flag, an embedded calculator), create the bundle by hand.

### bundle.yaml

```yaml
# bundles/local-tools/bundle.yaml
schema_version: 1
bundle: local-tools
version: 0.1.0
transport: in-process       # alternative: http (proxied via mcpfyer-generated runtime)
tools:
  - feature.is_enabled
  - date.parse
```

### tools/feature.is_enabled.json

```json
{
  "name": "feature.is_enabled",
  "description": "Check whether a feature flag is enabled for the active tenant.",
  "input_schema": {
    "type": "object",
    "properties": {
      "feature_name": {"type": "string"}
    },
    "required": ["feature_name"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "enabled": {"type": "boolean"},
      "reason":  {"type": "string"}
    }
  },
  "side_effect": "read",
  "dry_run_supported": false
}
```

### tools/feature.is_enabled.py

In-process tools need a Python handler colocated with the schema.

```python
# bundles/local-tools/tools/feature_is_enabled.py
from typing import Any

async def call(*, feature_name: str, ctx: Any) -> dict[str, Any]:
    enabled = ctx.flags.is_on(feature_name, tenant=ctx.tenant_id)
    return {"enabled": enabled, "reason": "feature-flag-store"}
```

The runtime's BundleLoader imports the handler module and registers the
`call` coroutine against the tool schema.

---

## tools.yaml — pack-side allow-list

Tools are not callable until a pack allow-lists them. From the
`care-demo` pack:

```yaml
# packs/care-demo/tools.yaml
allow:
  - kb.search
  - customer.lookup
  - billing.get_invoice
  - billing.issue_credit
  - ticket.create
  - ticket.escalate
  - subscription.change_plan
```

A tool call to any name **outside** this list is rejected at dispatch
without ever hitting the tool transport. The rejection writes a
permission-denied trail event so operators can spot misconfigurations
or attempted scope creep.

---

## Side-effect semantics

| `side_effect` | When the runtime considers the tool side-effecting |
|---------------|----------------------------------------------------|
| `read` | Never. Safe to call freely. |
| `write` | The dispatch path requires either the orchestrator to set `dry_run=True` (if `dry_run_supported`) or an explicit user confirmation. |

In the admin console's tool inspector, write tools require a
**confirm-for-write** step before invocation. Dry-run is the default
for write tools that support it.

```python
# In a use case:
result = await self.billing_issue_credit.call(
    customer_id="cust-1002",
    amount=18.00,
    reason="duplicate-charge",
    dry_run=False,     # explicit — orchestrator passes False after user confirmation
)
```

---

## OpenLLMetry instrumentation

The bundle's transport layer (`httpx` for OpenAPI-generated, or whatever
the in-process handler does) is auto-instrumented by OpenLLMetry. Every
tool call produces a `tool.call` span and a matching `tool.result` event.
The trail sees the same payloads.

You **never** hand-write `with tracer.start_span("tool.something"):` —
the SDK boot has already wired it up.

---

## Bundle versioning

`bundle.yaml` carries a `version` field. The runtime exposes it as
`bundle_version` on the tool catalogue (`GET /tools`), so the admin UI
can show "you are calling `billing.get_invoice` from bundle
`billing@1.2.0`".

When a tool's input schema changes in a breaking way, bump the bundle
major. The pack-side `tools.yaml` does not pin versions today; the
runtime loads the highest version of each bundle it finds. (Pinned-
version allow-lists are a v1.1 candidate.)

---

## Inspecting installed bundles

```bash
# CLI
agi-mcpfyer inspect bundles/billing/

# Runtime
curl http://localhost:9000/tools | jq
# returns {tools: [{name, bundle_version, consuming_pack_count, side_effect, dry_run_supported}, ...]}
```

The admin UI's tool catalogue (`/tools`) renders the same data with
search, filters, and a one-click "Test invoke" panel that builds a form
from the tool's `input_schema` (including `oneOf` discriminator
variants and nested `array<object>` shapes — see `app/components/form-from-schema.tsx`).

---

## What NOT to do

- **Don't write `agi.tools.register()` decorators.** They don't exist.
  Tools are always MCP tools.
- **Don't bypass the allow-list in tests.** The runtime's pre-dispatch
  allow-list check is the only thing standing between a buggy
  orchestrator and a billing API in production.
- **Don't hand-write OTel spans inside a tool handler.** The transport
  layer is already instrumented; double-instrumenting creates noisy
  duplicate spans in Langfuse.
- **Don't return non-JSON-serialisable values from a tool.** The
  dispatch seam serialises the result for the trail; non-JSON values
  raise during the trail-write.
