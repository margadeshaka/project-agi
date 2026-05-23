# Authoring a use case

This guide walks through writing a use case from scratch — what to
write, where to put it, how to test it, and how to ship it.

A **use case** is the unit the SDK runs: one Python class, decorated
with `@use_case(slug, version)`, that owns one agentic flow.

---

## The minimum viable use case

```python
# bill_explainer.py
from agi_sdk import use_case, serve

@use_case("bill_explainer", version="0.1.0")
class BillExplainer:
    def __init__(self, sdk):
        self.sdk = sdk

    async def handle(self, request, ctx):
        return {"reply": "I am a stub. Replace me."}

if __name__ == "__main__":
    serve(BillExplainer, http=True)
```

That is the whole shape. Run it:

```bash
pip install agi-sdk
export AGI_PACK_PATH=packages/agi-packs/blank
python bill_explainer.py
```

`serve()` mounts `/v1/invoke`, `/v1/invoke/stream`, `/v1/tools`,
`/v1/trail/{cid}`, plus `/healthz` and `/readyz` on `:9000`.

```bash
curl -X POST http://localhost:9000/v1/invoke \
  -H 'Content-Type: application/json' \
  -d '{"messages": [{"role": "user", "content": "Hi"}]}'
```

---

## The `@use_case` decorator

```python
@use_case(slug: str, version: str)
class YourClass: ...
```

| Argument | What it does |
|----------|--------------|
| `slug` | Identity for AI-Trail events, OTel baggage (`bm.use_case`), and MCP tool registration. Must be a non-empty string. Convention: `snake_case`, no version suffix. |
| `version` | Real semver. Bumped on any non-additive change to the wire response or any new tool call you add. |

Behind the scenes the decorator stamps `_agi_use_case_slug` and
`_agi_use_case_version` on the class. The dispatch seam **rejects
undecorated classes** with a `TypeError`. If you forget the decorator,
`serve()` raises at startup.

---

## `__init__(self, sdk)` — what to do here

`sdk` is the SDK facade (an instance of `agi.serve.SDK`, built by
`serve()` from the active pack + operator config). Cache anything you
will reuse across requests here.

```python
def __init__(self, sdk):
    self.sdk = sdk
    self.reasoning = sdk.models.binding("reasoning")    # ModelBinding
    self.fast      = sdk.models.binding("fast")
    self.billing   = sdk.mcp.tool("billing.get_invoice")
    self.kb        = sdk.rag.retriever("knowledge")     # KB retriever
    self.system    = sdk.prompts.get("explain_bill")    # Jinja template
```

The five primitive APIs:

| Facade | Purpose |
|--------|---------|
| `sdk.models.binding(role)` | Resolve a model **role** (`reasoning`, `fast`, `embedding`) to a `ModelBinding`. `.kwargs()` returns `{model, api_base, **default_params}` for `litellm.acompletion`. |
| `sdk.mcp.tool(name)` | Wrap an MCP tool the pack has allow-listed. `.call(**args)` runs it. |
| `sdk.rag.retriever(name)` | Resolve a KB collection (defined by `pack.kb`). Returns a retriever with `.search(query, top_k)`. |
| `sdk.prompts.get(name)` | Jinja template from `pack.prompts`. Returns a Template; call `.render(**vars)`. |
| `sdk.trail` | Read-only access to the in-process trail sink (mostly for tests). |

The SDK is **synchronous-construction, async-call**. Constructors run
once at boot; everything inside `handle()` is awaitable.

---

## `async def handle(self, request, ctx)` — the actual call

```python
async def handle(self, request, ctx):
    # request: InvokeRequest (see agi.dispatch.InvokeRequest)
    #   .messages       list[InvokeMessage]
    #   .session_id     str | None
    #   .correlation_id str
    #   .model_overrides dict[str, str] | None
    # ctx: HandlerContext
    #   .pack           Pack
    #   .tenant_id      str
    #   .correlation_id str
    #   .trail          TrailWriter (for invoke-only events; use sparingly)

    user_question = request.messages[-1].content
    invoice = await self.billing.call(customer_id=ctx.tenant_id)

    prompt = self.system.render(
        invoice=invoice,
        question=user_question,
    )

    import litellm
    response = await litellm.acompletion(
        messages=[
            {"role": "system", "content": prompt},
            *[m.model_dump() for m in request.messages],
        ],
        **self.reasoning.kwargs(),
    )
    reply = response.choices[0].message.content
    return {
        "reply": reply,
        "invoice_id": invoice["id"],
        "tools_called": ["billing.get_invoice"],
    }
```

Return any JSON-serialisable value. The dispatch seam wraps it into an
`InvokeResponse` and pipes the trail-envelope events around it.

---

## Roles, not providers

```python
# Right ✅
self.reasoning = sdk.models.binding("reasoning")
response = await litellm.acompletion(**self.reasoning.kwargs())

# Wrong ❌ — fails the isolation gate in CI
import openai
client = openai.AsyncOpenAI()
response = await client.chat.completions.create(model="gpt-4o", ...)
```

The SDK's isolation gate (`packages/agi-sdk/tests/test_isolation_gate.py`)
forbids `import openai|anthropic|boto3` in SDK source. Use-case code is
not under that gate, but the same rule applies in spirit — if you bind
to a provider directly, you lose the ability to swap providers by
editing `operator.yaml`.

---

## Tools

Tools come from the pack's `tools.yaml` allow-list. You can only call
tools the pack has allow-listed; the runtime enforces this at dispatch.

```python
self.billing = sdk.mcp.tool("billing.get_invoice")
# ...
invoice = await self.billing.call(customer_id="cust-1002")
```

If `billing.get_invoice` is not in the active pack's allow-list, the
call raises `ToolNotAllowed` and writes a permission-denied trail event.

To create a new tool, generate it from an OpenAPI spec:

```bash
agi-mcpfyer build path/to/openapi.yaml -o bundles/billing/
```

Then add `billing.get_invoice` to the pack's `tools.yaml`. See
[`docs/tools/authoring.md`](../tools/authoring.md).

---

## Prompts

Prompts are Jinja templates at `packs/<slug>/prompts/*.j2`. The pack's
`pack.yaml` declares the role bindings:

```yaml
metadata:
  role_bindings:
    system_prompt: prompts/system.j2
    scenarios:
      explain_bill: prompts/explain_bill.j2
```

In code:

```python
template = self.sdk.prompts.get("explain_bill")
text = template.render(invoice=invoice, question=q)
```

Templates have access to standard Jinja filters plus a `kb_excerpt(query,
top_k)` helper if you need to inline KB content into the prompt.

**Prompts are read-only at runtime.** To change a prompt, you change the
file in the pack repo and ship through CI. The hotfix lane gets you
≤15 minutes from merge to live. See [`docs/deploy/hotfix.md`](../deploy/hotfix.md).

---

## Optional: orchestrators

A use case can declare an orchestrator class attribute:

```python
@use_case("hello", version="0.1.0")
class Hello:
    orchestrator = "native"        # default — plain async + Pydantic state
    # orchestrator = "langgraph"   # requires agi-sdk[langgraph]
    # orchestrator = "pydantic_ai" # requires agi-sdk[pydantic-ai]
```

For `native` (the default) the orchestrator runs your `handle()` plus
the standard tool-calling loop. For `langgraph`, you build a `StateGraph`
inside `__init__` and the adapter drives it; you keep the same
`handle()` shape but it returns the graph state.

See `packages/agi-sdk/agi/orchestrators/` for the three adapters. Each
is under ~150 LOC.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `AGI_PACK_PATH` | Path to the active pack folder. Required unless `pack=` kwarg passed to `serve()`. |
| `AGI_TRAIL_SINK` | `memory` (default), `file-jsonl`, `mongo`, `postgres`. |
| `AGI_TRAIL_PATH` | File path for `file-jsonl` sink. |
| `AGI_SERVE_STATIC_TOKEN` | Bearer token for `serve(auth='static-token')`. |
| `AGI_DISABLE_TRACELOOP` | Set to `1` in tests to skip OpenLLMetry boot. |
| `AGI_PORT` | Default `9000`. |
| `AGI_HOST` | Default `0.0.0.0`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector URL. |
| `LANGFUSE_HOST` | Langfuse trace UI URL (also used by `/admin/use-cases`). |

---

## Testing your use case

The SDK ships a `MemoryTrailSink` + a fake LLM patch for tests. Pattern
from `packages/agi-sdk/tests/test_dispatch_seam.py`:

```python
import pytest
from unittest.mock import patch
from agi.config import Pack
from agi.dispatch import InvokeRequest, invoke_use_case
from agi.models import ModelBinding
from agi.trail import MemoryTrailSink
from your_app.bill_explainer import BillExplainer

@pytest.fixture
def fake_llm():
    async def fake(**kwargs):
        from types import SimpleNamespace
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))]
        )
    with patch("litellm.acompletion", fake):
        yield

async def test_bill_explainer_happy_path(fake_llm):
    pack = Pack(slug="care-demo", version="0.1.0", name="Care", ...)
    sink = MemoryTrailSink()
    binding = ModelBinding(role="reasoning", model_id="fake/model")

    resp = await invoke_use_case(
        use_case_cls=BillExplainer,
        pack=pack,
        request=InvokeRequest(messages=[{"role": "user", "content": "Hi"}]),
        model_binding=binding,
        available_tools={},
        trail_sink=sink,
        correlation_id="test-1",
        tenant_id="care-demo",
    )

    assert resp.reply == "ok"
    assert any(e["event_type"] == "invoke.start" for e in sink.events)
    assert any(e["event_type"] == "invoke.end" for e in sink.events)
```

---

## Shipping it

| You want | Do this |
|----------|---------|
| Embed in your own service | `pip install agi-sdk`, write your class, call `serve(YourClass, http=True)`. |
| Run alongside a pack via Docker | Drop your use case as a small package; build a thin image on top of `agi-runtime`. |
| Multi-tenant production | Use `agi-runtime` directly — it loads packs from disk and your code via a separate entrypoint module. Use cases ship as importable packages, not as runtime plugins. |

---

## What NOT to do in a use case

- **Don't write to the AI-Trail directly.** The orchestrator emits
  events. Use cases that hand-roll `trail.write(...)` create
  double-emission and break the regulator-grade schema overlay.
- **Don't reach across packs.** A use case sees one pack, period.
  Cross-pack admin lives in the runtime's `/admin/*` routes.
- **Don't import `openai`, `anthropic`, or `boto3` directly.** Use
  `sdk.models.binding(role)` and let LiteLLM handle the provider.
- **Don't store state in module globals.** Use cases must be safe to
  instantiate per-process. State that needs to outlive a request goes
  to the storage adapter.
- **Don't catch and swallow tool errors.** Let `ToolNotAllowed`,
  `ToolError`, and orchestrator exceptions bubble — the dispatch seam
  maps them to clean trail events and the right HTTP status.
