# project-agi

> Open-source, self-hosted, configuration-driven Agent Intelligence stack. **Vertical-agnostic** — works for telco, banking, retail, healthcare, energy, fleet, education, gov, and anything else with an OpenAPI surface and a need for agent tooling. The SDK is the product; reference runtime + UI + chart are the supported distribution. Apache-2.0.

## What this is

Two-band architecture:

| Band | Packages | Posture |
|---|---|---|
| **Band 1 — Product** | `agi-sdk`, `agi-core`, `agi-mcpfyer`, `agi-packs` | Python library you embed. Roles-not-providers, MCP-only tools, OpenLLMetry auto-instrumented. |
| **Band 2 — Reference Distribution** | `agi-runtime`, `agi-ui`, `agi-auth`, `agi-chart` | FastAPI + Next.js + Keycloak + Helm. What field teams deploy. Optional. |

Band 2 depends on Band 1. Band 1 never imports from Band 2.

## Two ways to use it

### Embed (library)

```bash
pip install agi-sdk
```

```python
import litellm
from agi_sdk import use_case, serve

@use_case("bill_explainer", version="0.3.0")
class BillExplainer:
    def __init__(self, sdk):
        self.sdk       = sdk
        self.reasoning = sdk.models.binding("reasoning")
        self.billing   = sdk.mcp.tool("billing.adjust_charge")

    async def handle(self, request, ctx):
        prompt   = self.sdk.prompts.get("explain_bill").render(...)
        response = await litellm.acompletion(
            messages=[{"role": "user", "content": prompt}],
            **self.reasoning.kwargs(),
        )
        return response

if __name__ == "__main__":
    serve(BillExplainer, http=True, mcp=True)
```

### Deploy (turnkey stack)

```bash
git clone https://github.com/<org>/project-agi
cd project-agi
docker compose up -d
open http://localhost:8080
```

## Status

**Currently in development (Phase 0–1).** Not yet ready for production. See `EXECUTION_PLAN.html` for the 14-week plan to v1.0.

| Phase | Scope | Status |
|---|---|---|
| P0 | Public repo scaffold | In progress |
| P1 | agi-sdk shell port from v0 | In progress |
| P1.5 | Orchestrator adapters (LangGraph, Pydantic-AI) | Not started |
| P2 | agi-mcpfyer (OpenAPI → MCP) | Not started |
| P3 | agi-runtime FastAPI shell | Not started |
| P4 | agi-ui admin console | Not started |
| P5 | Reference packs + Helm chart | Not started |
| P6 | care-intelligence retrofit + v1.0 | Not started |

## The design

The full design lives in HTML companions in this folder:

- **`DESIGN.html`** — Visual architecture with diagrams (start here).
- **`PLAN.html`** — Phased plan, v3 post-debate.
- **`DEBATE.md`** — How the architecture was argued and resolved.
- **`RESOLVED_STACK.md`** — Eight ratified decisions + three open.
- **`EXECUTION_PLAN.html`** — 14-week execution with Gantt, gates, RACI.
- **`ADMIN_CONSOLE.md`** + **`CONSOLE_REQUIREMENTS.html`** — Admin UI design and requirements.

## Three guarantees of the design

1. **Library-first.** `pip install agi-sdk` works without any Band 2 component. The reference runtime is supported but optional.
2. **Multi-tenant by YAML.** A pack is a folder. Adding a tenant is dropping a folder. Header dispatch is claims-validated at every request — no possible header-based tenancy bypass.
3. **Auto-MCP from any OpenAPI.** Point `agi-mcpfyer` at any OpenAPI 3.0+ spec — Stripe, GitHub, Twilio, Salesforce, TMF Open API, your internal services — and get a runnable MCP server with the operations exposed as tools.

## Verticals & example use cases

The reference packs ship two verticals (`telco-demo`, `fleet-demo`) only as demonstrators. The framework is industry-neutral. The orchestrator + pack model has been validated across these shapes:

| Vertical | Example use case | Orchestrator pick |
|---|---|---|
| **Telco / BSS** | Bill explainer, eSIM activation, refund agent, tier-2 escalation | Plain async / LangGraph |
| **Banking & fintech** | Loan triage, transaction-dispute resolver, KYC pre-check | Pydantic-AI |
| **Retail** | Returns assistant, order-status agent, refund flow | Plain async |
| **Healthcare** | Patient pre-triage, claim-form assistant | Pydantic-AI |
| **Energy & utilities** | Meter-read explainer, outage explainer, tariff comparison | Plain async |
| **Insurance** | Claim resolver with retries + human approval | LangGraph |
| **Fleet & logistics** | Delivery-exception triage, route-incident explainer | Plain async |
| **Education** | Tutor session, student-onboarding flow | Pydantic-AI |
| **Public sector** | Form-fill helper, eligibility explainer | Plain async |

See `ORCHESTRATOR_RESEARCH.md` for the orchestrator-by-use-case-shape decision tree. Choose by shape, not by industry.

## Contributing

See `CONTRIBUTING.md`.

## License

Apache-2.0. See `LICENSE`.
