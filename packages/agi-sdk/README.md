# agi-sdk

> The library you embed to build agentic use-cases against the project-agi stack.
> Roles-not-providers · MCP-only tools · OpenLLMetry auto-instrumented · Apache-2.0.

`agi-sdk` is **Band 1** of project-agi — pure library code, no FastAPI runtime,
no admin UI, no auth shell. Everything in Band 2 (`agi-runtime`, `agi-ui`,
`agi-auth`, `agi-chart`) depends on this package; this package never depends
on them. The isolation gate test enforces it.

See the top-level [README](../../README.md) for the wider architecture, and
[`PLAN.html`](../../PLAN.html) / [`RESOLVED_STACK.md`](../../RESOLVED_STACK.md)
for the design rationale.

## Status

**Phase 1 scaffold.** Public surface is stable; most internals are stubbed
(`raise NotImplementedError("TODO: …")`) until Phase 1.5 / Phase 3 wire the
real LiteLLM / MCP / vector backends. Don't depend on this in production yet.

## Install

```bash
pip install agi-sdk                      # core
pip install 'agi-sdk[langgraph]'         # + LangGraph adapter
pip install 'agi-sdk[pydantic-ai]'       # + Pydantic-AI adapter
pip install 'agi-sdk[mongo,postgres,qdrant]'  # + vector / state backends
```

Python ≥ 3.11.

## Use-case example — BillExplainer

```python
import litellm
from agi import use_case, serve

@use_case("bill_explainer", version="0.3.0")
class BillExplainer:
    def __init__(self, sdk):
        self.sdk       = sdk
        self.reasoning = sdk.models.binding("reasoning")
        self.billing   = sdk.mcp.tool("billing.adjust_charge")

    async def handle(self, request, ctx):
        prompt   = self.sdk.prompts.get("explain_bill").render(
            bill_id=request.bill_id,
            customer=request.customer,
        )
        response = await litellm.acompletion(
            messages=[{"role": "user", "content": prompt}],
            **self.reasoning.kwargs(),     # model + default_params + extra
        )
        return response.choices[0].message.content

if __name__ == "__main__":
    serve(BillExplainer, http=True, mcp=True)
```

The use-case author never names a model provider. `operator.yaml` binds
`reasoning` to a concrete LiteLLM `model_id`; the SDK resolves it at boot.
Same agent runs over HTTP **and** MCP — `serve()` builds both exposures from
the single class.

## Public surface

| Import | Purpose |
|---|---|
| `agi.use_case` | Class decorator stamping `slug` + `version`. |
| `agi.serve` | Boot FastAPI + MCP server for a `@use_case` class. |
| `agi.load_pack` | Read a pack folder into an immutable `Pack`. |

Primitive APIs (`models`, `mcp`, `rag`, `prompts`, `config`, `trail`) are
attached to the `SDK` instance handed to the use-case at construction —
authors reach them via `self.sdk.models`, `self.sdk.mcp`, etc.

## Hard rules

1. **No native provider SDKs.** `openai`, `anthropic`, `boto3` are banned by
   the isolation gate; call `litellm.acompletion(...)` instead.
2. **Tools are MCP, no exceptions.** Every tool — internal or external —
   goes through `sdk.mcp.tool()`.
3. **No imports of Band 2** (`agi_runtime`, `agi_ui`, `agi_auth`,
   `agi_chart`) — the SDK is the library, not the runtime.
4. **`mypy --strict` is mandatory.** Every public symbol type-annotated.

## Tests

```bash
cd packages/agi-sdk
pytest                                   # all
pytest tests/test_isolation_gate.py      # MUST pass — no banned imports
pytest tests/test_models.py              # binding kwargs semantics
pytest tests/test_packs.py               # pack loader smoke
```

## License

Apache-2.0. See [LICENSE](../../LICENSE) in the repo root.
