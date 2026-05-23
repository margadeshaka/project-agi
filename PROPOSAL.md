# project-agi — open-source plan

**Owner:** hitesh.gupta@comviva.com
**Created:** 2026-05-22
**Status:** Draft for review
**Outcome:** A single Apache-2.0 repo that supersedes `bluemarble-ai-framework` (empty) and replaces the externally-non-runnable parts of `bm-ai-platform` with a self-hosted, configuration-driven, multi-tenant agent stack.

---

## 0. Guiding principles

1. **Config beats code.** New tenants, tools, KB sources, agents, LLM providers are declared in YAML/JSON, never by editing source.
2. **Embeddable first, turnkey second.** `agi-core` is a Python package with no mandatory server, DB, UI, or auth. The platform is a thin shell on top.
3. **No internal-only dependencies.** Anything that requires `bm-nexus.comviva.com`, Comviva VPN, internal Keycloak realms, or Comviva-only AWS accounts is either dropped, replaced, or made optional behind a feature flag.
4. **Multi-tenant from day one.** Borrow the brand-pack model from `care-intelligence` (`platform/` ↔ `domains/` ↔ `packs/`). One deployment serves many tenants; each tenant ships a folder of YAML.
5. **Audit everything.** Every LLM call, tool call, tool result, and error is written to an append-only AI-trail with a correlation ID. No exceptions.
6. **Isolation gate.** Code from this repo cannot import from any Comviva-internal package. A pytest check enforces it (mirrors care-intelligence's gate).

## 1. What stays out (hard exclusions)

These will **not** be ported from `bm-ai-platform`. They are either proprietary, customer-specific, or out of scope.

| Excluded | Why |
|---|---|
| `bm-ai-auth`, `bm-ai-logging`, `bm-ai-mongodb` (internal Nexus libs) | Proprietary; replace with PyPI equivalents (`authlib`, stdlib `logging` + `structlog`, `motor`/`pymongo`). |
| Bedrock-specific account ARNs, role names, region defaults | Customer config, not framework concern. Lift into env-driven config. |
| Keycloak realm `bm-demo5` and any hard-coded client IDs | Demo wiring; replace with a generic OIDC adapter that accepts any issuer. |
| BlueMarble / BT / KPN / Verizon-Connect brand seed data | Customer demo content; ships as separate optional packs, not in core. |
| MySQL read-only CRM connection (`10.31.6.149`) | Comviva infra; out of scope. The framework offers a generic SQL data-source adapter instead. |
| `bm-quote-management-v4` and any CPQ wiring | Different solution; out of scope. |
| Helm `charts/bm-ai-platform/` (Comviva-internal values) | Replace with a clean public Helm chart parameterised by tenant pack. |

## 2. What gets extracted (the merge)

What we **do** lift from `bm-ai-platform` and `care-intelligence`, after scrubbing:

| Source | Component | New home |
|---|---|---|
| `bm-ai-platform/src/bm_mcp/llm/` | LLM provider abstraction + failover | `packages/agi-core/agi/llm/` |
| `bm-ai-platform/src/bm_mcp/tools/` | Tool registry + JSON-Schema validation | `packages/agi-core/agi/tools/` |
| `bm-ai-platform/src/bm_mcp/services/` | KB retriever, embedding service | `packages/agi-core/agi/kb/` |
| `bm-ai-platform/src/bm_mcp/protocol/` | MCP server bits | `packages/agi-runtime/agi_runtime/mcp/` |
| `bm-ai-platform/src/ui/` | Next.js shell, agent config screens | `packages/agi-ui/` (stripped of Comviva branding) |
| `care-intelligence` `platform/brand/` | Brand engine + brand-private tools | `packages/agi-core/agi/packs/` |
| `care-intelligence` `domains/` (the shape, not the code) | Three-layer pattern as a documented convention | `ARCHITECTURE.md` + example pack |
| `care-intelligence` AI-Trail | Audit subsystem | `packages/agi-core/agi/trail/` |
| `care-intelligence` isolation-gate test | CI guardrail | `packages/agi-core/tests/test_isolation_gate.py` |

## 3. Distribution model

Two artefacts from one repo:

| Artefact | Audience | How to use |
|---|---|---|
| `agi-core` Python package | Developers embedding agents in their own app | `pip install agi-core` |
| `project-agi` Docker stack | Operators standing up a hosted agent platform | `docker compose up` (or Helm) |

CI publishes both on tag.

## 4. Repository layout (target)

```
project-agi/
├── README.md
├── LICENSE                          # Apache-2.0
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── SECURITY.md
├── pyproject.toml                   # workspace root (uv / hatch)
├── packages/
│   ├── agi-core/                    # the framework — Python lib
│   │   ├── agi/
│   │   │   ├── agent/               # LangGraph-based runtime
│   │   │   ├── llm/                 # provider registry: openai, anthropic, bedrock, ollama, fake
│   │   │   ├── tools/               # registry, JSON-Schema validation, allow-listing
│   │   │   ├── kb/                  # retriever, embeddings, vector-store adapters
│   │   │   ├── packs/               # brand-pack / tenant-pack loader
│   │   │   ├── trail/               # AI-Trail audit
│   │   │   └── adapters/            # storage (Mongo/Postgres/SQLite), auth (OIDC/static/noop)
│   │   ├── tests/
│   │   └── pyproject.toml
│   ├── agi-runtime/                 # FastAPI HTTP + MCP server wrapping agi-core
│   │   └── agi_runtime/
│   └── agi-ui/                      # Next.js — optional UI
│       └── (Next 14+, app router, shadcn/ui)
├── packs/
│   ├── blank/                       # minimal starter pack
│   ├── telco-demo/                  # opinionated reference pack
│   └── fleet-demo/
├── deploy/
│   ├── docker/
│   │   ├── docker-compose.yml
│   │   └── docker-compose.dev.yml
│   └── helm/
│       └── agi/                     # Helm chart, values parameterise pack + LLM
├── docs/
│   ├── getting-started.md
│   ├── packs.md                     # how a brand-pack is structured
│   ├── tools.md
│   ├── llm-providers.md
│   ├── auth.md
│   └── deploy.md
├── examples/
│   ├── embedded/                    # pip-install + 20 lines of Python
│   └── self-hosted/                 # docker-compose walkthrough
└── .github/
    ├── workflows/
    │   ├── ci.yml
    │   ├── publish-pypi.yml
    │   └── publish-images.yml
    └── ISSUE_TEMPLATE/
```

## 5. Configuration model (preview)

A **pack** is a folder of YAML/JSON that fully describes a tenant. No code.

```
packs/telco-demo/
├── pack.yaml                # brand identity, theme, allowed tools, default LLM
├── tools.yaml               # tool declarations (name, schema, handler ref)
├── kb/                      # knowledge-base seed (markdown / JSON)
│   ├── eSIM-install.md
│   └── billing-refund.md
├── scenarios/               # optional demo scenarios
│   └── deflect.scenario.json
└── prompts/                 # optional prompt overrides
    └── system.j2
```

`pack.yaml` example:

```yaml
slug: telco-demo
display_name: Telco Demo
vertical: telco
theme:
  primary: "#0066CC"
  mode_default: light
llm:
  default: openai:gpt-4o-mini
  fallback: ollama:llama3.2
tools:
  allow:
    - kb.search
    - billing.create_refund
    - escalate_to_tier2
  deny: []
auth:
  required_scopes: ["agent:chat"]
```

Loading is a single call: `runtime = AgentRuntime(pack=load_pack("packs/telco-demo"))`. Switching tenants at request time is a header (`X-Pack: telco-demo`), modelled on care-intelligence's `X-Brand`.

## 6. Phased plan

### Phase 0 — Repo scaffold (week 1)
- Decide GitHub org and repo name. **Decision needed.** Default: `github.com/comviva-oss/project-agi`.
- Create empty public repo with Apache-2.0, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, issue templates, branch protection on `main`.
- Push the four planning docs from this folder (`README.md`, `PROPOSAL.md`, `ARCHITECTURE.md`, `CLAUDE.md`) as the first commit.
- Set up GitHub Actions skeleton (lint, type-check, test, build).
- Reserve PyPI name `agi-core` (or the agreed final name).

### Phase 1 — agi-core MVP (weeks 2–4)
- Scaffold `packages/agi-core/` with uv + hatch.
- Port LLM provider abstraction (`openai`, `anthropic`, `bedrock`, `ollama`, `fake`) — scrub Comviva specifics.
- Port tool registry + JSON-Schema validation.
- Implement pack loader (YAML → in-memory pack object).
- Implement AI-Trail (append-only, pluggable sink: memory, file, Mongo).
- Implement `AgentRuntime` facade (LangGraph under the hood).
- Storage adapter: SQLite default, Mongo optional.
- Auth adapter: static-token default, OIDC optional, dev-noop optional.
- Isolation-gate pytest.
- Ship reference `packs/blank/`.
- Tag `v0.1.0`, publish to TestPyPI.

### Phase 2 — agi-runtime + Docker (weeks 5–6)
- FastAPI server wrapping `agi-core`: `/chat`, `/tools`, `/kb`, `/trail`, plus MCP endpoint.
- `X-Pack` header dispatch.
- `docker-compose.yml` with: agi-runtime, MongoDB, optional Ollama.
- One-command quickstart: `docker compose up && curl localhost:9000/chat ...`.
- Tag `v0.2.0`, publish image to GHCR.

### Phase 3 — agi-ui (weeks 7–9)
- Next.js 14+ app, Tailwind + shadcn/ui, app router.
- Screens: pack switcher, agent chat, tool inspector, AI-Trail viewer, KB browser.
- No Comviva branding. Theme tokens come from the active pack.
- Tag `v0.3.0`.

### Phase 4 — Reference packs + Helm (weeks 10–12)
- `packs/telco-demo/` — KB + tools + scenarios, vendor-neutral.
- `packs/fleet-demo/` — second vertical, proves cross-vertical switching.
- Public Helm chart in `deploy/helm/agi/`.
- Documentation pass: getting-started, packs, tools, llm-providers, auth, deploy.
- Tag `v0.4.0`.

### Phase 5 — v1.0 cut (week 13+)
- Hardening: e2e tests, perf baseline, security review (SECURITY.md, dependabot, secret-scanning).
- Migration note: how to move a `bm-ai-platform` deployment over.
- Tag `v1.0.0`, announce.

## 7. Open decisions (need owner input)

1. **Repo location.** GitHub `comviva-oss/project-agi`? Personal org? Net-new neutral org?
2. **Final name.** `project-agi` is a working title. Candidates: `agi-stack`, `openagent`, `agentkit`, `agi-core`. Trademark check required.
3. **License.** Apache-2.0 assumed. Confirm with legal.
4. **Bitbucket mirror.** One-way sync from GitHub to Bitbucket for internal CI, or skip?
5. **CLA.** None initially. Acceptable?
6. **Trademarks.** Cannot ship under `BlueMarble` or `bm-` names in OSS. Pack-template names must be vendor-neutral.
7. **Relationship to `bluemarble-ai-framework`.** Archive it, or repurpose as a Bitbucket-only thin wrapper that depends on `agi-core`?
8. **Relationship to `bm-ai-platform`.** Roadmap: does `bm-ai-platform` eventually depend on `agi-core` instead of carrying its own copy?

## 8. Risks

| Risk | Mitigation |
|---|---|
| Comviva-proprietary code leaks into OSS repo. | Isolation-gate test + secret-scanning + manual diff review on every PR for first 90 days. |
| `bm-ai-platform` and `agi-core` diverge, doubling maintenance. | Phase 5 plan to have `bm-ai-platform` depend on `agi-core` so there's one runtime, not two. |
| Open-source name collision / trademark issue. | Run name search in Phase 0 before any public push. |
| Multi-tenant pack model leaks customer data across packs. | `X-Pack` is mandatory; missing header returns 400. Storage queries scoped on `pack_slug`. Add a fuzz test. |
| Community contributions stall (low engagement). | Acceptable for v1; the primary value is internal reuse + external evaluation, not community velocity. |

## 9. Definition of done (v1.0)

- `pip install agi-core` works from PyPI on a clean machine, no Nexus, no VPN.
- `docker compose up` launches the full stack on a clean machine in under five minutes.
- A new tenant can be added by dropping a folder under `packs/` and restarting — zero code changes.
- An external evaluator can complete the getting-started guide without internal help.
- Isolation-gate, lint, type-check, test, and image-build all pass on `main`.
- `bm-ai-platform` has a concrete plan to migrate onto `agi-core`.
