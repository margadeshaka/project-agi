# agi-mcpfyer

> OpenAPI 3 → MCP tool bundle generator. **First-class repo**, not a utility buried in core.

Points at any OpenAPI 3.0/3.1 spec and emits a versioned bundle of MCP tool descriptors plus an MCP server stub that exposes them. TMF is one example consumer — there is no TMF-specific code in here.

## Quickstart

```bash
# Build a bundle from a spec on disk
agi-mcpfyer build ./openapi/billing.yaml --out ./build/billing-bundle

# Or from a URL
agi-mcpfyer build https://example.com/openapi.json --out ./build/foo-bundle

# Inspect what was emitted
agi-mcpfyer inspect ./build/billing-bundle
```

## Library use

```python
from agi_mcpfyer import build_bundle

bundle = await build_bundle(
    source="https://example.com/openapi.json",
    domain_resolver=lambda spec, op_id: spec.get("info", {}).get("title", "default"),
)
bundle.to_disk("./build/bundle")
```

## What the generator emits per OpenAPI operation

| Field | Source | Notes |
|---|---|---|
| `name` | `operationId` (cleaned) or `<method>_<path>` | Slugified |
| `domain` | configurable `domain_resolver` | Defaults to first path segment |
| `input_schema` | OpenAPI parameters + requestBody | Merged, `$ref`s resolved one level |
| `output_schema` | first 2xx response schema | Optional |
| `side_effecting` | `True` for POST/PUT/PATCH/DELETE | Overridable via `x-side-effecting: false` |
| `rate_limit_class` | `write_high` for mutating, else `read` | Tunable |
| `dry_run_supported` | from `x-dry-run: true` | Default `False` |

## Status

- Generator: ported + generalised from v0.
- MCP server: **stub** in this phase — emits the right tool surface, returns fixture responses. Real upstream HTTP forwarding lands in Phase 3 (agi-core hub).
- License: Apache-2.0.
