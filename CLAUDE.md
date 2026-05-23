# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo identity

`project-agi` — Apache-2.0 open-source agent-intelligence stack, built from scratch for the open world (not a retrofit of any internal stack). Vertical-agnostic; SDK is the product, runtime/UI/chart are the supported reference distribution. Status: **P0–P5 complete in-repo, P6 (v1.0 release prep) in flight** (see `EXECUTION_PLAN.html` for the original 14-week plan to v1.0).

> **Note on care-intelligence:** care-intelligence is a *future downstream consumer* of project-agi, not a retrofit target. The architectural lineage is documented in the final paragraph of `ARCHITECTURE.md` — patterns from the prior internal stack informed the open-source design, but project-agi is not built to absorb care-intelligence code.

## Workspace layout (uv workspace, two bands)

```
packages/                  # Band 1 — Product (the library)
├── agi-sdk/   agi/        # Python SDK: use_case, serve, models, mcp, prompts, trail, orchestrators
├── agi-core/  agi_core/   # Optional shared services: tool/registry hub, settings, http_routes
├── agi-mcpfyer/ agi_mcpfyer/  # OpenAPI 3 → MCP bundle generator (CLI: agi-mcpfyer)
└── agi-packs/             # Reference packs (blank only — care/fleet live in packs/)

distribution/              # Band 2 — Reference Distribution
├── agi-runtime/ agi_runtime/  # FastAPI :9000, X-Pack dispatch middleware, /chat /tools /kb /trail /mcp
├── agi-auth/    agi_auth/     # OIDC/Keycloak/static-token/dev-noop adapters
├── agi-ui/                    # Next.js 14 admin console :8080 (Tailwind v4 + shadcn-style)
└── agi-chart/                 # Helm chart (Chart.yaml + values.schema.json)

packs/                     # Tenant content (YAML/J2/JSON only — no code)
├── care-demo/   pack.yaml, tools.yaml, prompts/, kb/, scenarios/
└── fleet-demo/

deploy/docker/             # docker-compose.yml — runtime + ui + mongo + qdrant + langfuse + otel-collector
.smoke/                    # Real-LLM smoke harnesses (Ollama, deflect) — not unit tests
docs/decisions/            # ADRs — non-trivial changes need one
```

**Band rule (enforced in CI):** Band 2 depends on Band 1; Band 1 NEVER imports Band 2. Gate: `packages/agi-sdk/tests/test_isolation_gate.py` AST-scans `agi/` and fails on any import of the band-2 distribution packages (`agi_runtime`, `agi_ui`, `agi_auth`, `agi_chart`) or native LLM SDKs (`openai`, `anthropic`, `boto3`).

## Common commands

```bash
# Sync — ALWAYS pass --all-extras, otherwise pytest/mypy/ruff get uninstalled
uv sync --all-packages --all-extras

# Test (whole workspace)
uv run pytest -v

# Test one package / one file / one test
uv run pytest packages/agi-sdk/tests -v
uv run pytest packages/agi-sdk/tests/test_isolation_gate.py::test_no_banned_imports_in_sdk -v

# Lint + format + types (matches CI exactly)
uv run ruff check .
uv run ruff format --check .
uv run mypy packages/agi-sdk/agi

# Just the isolation gate (CI job: isolation-gate)
uv run pytest packages/agi-sdk/tests/test_isolation_gate.py -v

# Runtime — local FastAPI
uv run agi-runtime                           # console script, defaults to :9000
AGI_RELOAD=1 AGI_PORT=9000 uv run agi-runtime

# UI — Next.js
cd distribution/agi-ui
npm run dev          # :8080
npm run lint         # next lint + custom no-hex check (scripts/check-no-hex.ts)
npm run type-check
npm run test         # vitest
npm run e2e          # playwright (app/e2e/)

# Full stack
cd deploy/docker && docker compose up -d
# → runtime :9000, ui :8080, mongo :27017, qdrant :6333, langfuse :3000, otel :4317/4318

# Real-LLM smoke (needs local Ollama on :11434)
OLLAMA_API_BASE=http://localhost:11434 uv run python .smoke/sdk_ollama_smoke.py

# OpenAPI → MCP bundle
uv run agi-mcpfyer <openapi-spec-path>
```

## Architecture you must read before editing

The big picture spans many files; before non-trivial edits read:

- `ARCHITECTURE.md` — three-layer model: packs → runtime → core, pack dispatch, AI-Trail schema, config precedence.
- `RESOLVED_STACK.md` — **load-bearing**; overrides `PLAN.html` v2 where they conflict. Codifies the 8 ratified decisions and the 3 owner-pending ones.
- `ORCHESTRATOR_RESEARCH.md` — why plain async is default, why LangGraph + Pydantic-AI are the two blessed adapters.
- `ADMIN_CONSOLE.md` — admin UI requirements (prompts are read-only in the UI; runtime-editable prompts are explicitly out of scope).

### Key invariants (don't break these)

1. **SDK is the product; runtime is one distribution.** `pip install agi-sdk` must work standalone. The SDK takes ONE pack at a time — multi-pack dispatch is an `agi-runtime` concern, not an SDK concern.
2. **`X-Pack` header mandatory in production paths**; missing → 400, unknown → 404, no default-pack fallback. Pack is **claims-resolved from the auth token**, then consistency-checked against the header — header trust alone is a multi-tenant leak.
3. **Roles, not providers.** Use-case code asks `sdk.models.binding("reasoning")`, never a model id. `import openai/anthropic/boto3` in SDK is blocked by the isolation gate; in pack/runtime code it requires an `# bm-ai: allow native sdk` waiver comment.
4. **MCP-only tool plane.** Every tool is an MCP tool. No parallel tool abstractions. Use `agi-mcpfyer` to auto-generate from OpenAPI.
5. **LiteLLM library mode** is the model gateway. No custom model abstraction wraps it.
6. **Tracing is automatic.** Traceloop/OpenLLMetry boots at SDK import (`agi/__init__.py::_bootstrap_traceloop`); set `AGI_DISABLE_TRACELOOP=1` in tests. Do not hand-roll OTel spans.
7. **Prompts live in packs as YAML/J2, baked into the container, PR-reviewed.** No DB-stored runtime-editable prompts. The hotfix lane is the `pack-hotfix/<ticket-id>` branch convention with a CI workflow template (≤15min merge-to-live target).
8. **AI-Trail is a sink, not an API.** Use cases don't call it directly; the OTel collector pipes spans → trail with the audit-schema overlay.

### Runtime request flow

`agi_runtime.main:create_app` → `XPackDispatchMiddleware` (claims-validated, exempts `/healthz`/`/readyz`) → routers in `agi_runtime/routes/` (`chat`, `tools`, `kb`, `trail`, `admin`, `health`). Shared state (`PackLoader`, `BundleLoader`, `TrailSink`) is built once in the lifespan handler and attached to `app.state.runtime`.

### Pack model

A pack is a folder under `packs/<slug>/` containing `pack.yaml` (identity, model role bindings, theme), `tools.yaml` (declarative tool defs), `prompts/*.j2`, `kb/` (markdown/JSON seeds), `scenarios/` (e2e + UI walkthroughs). Adding a tenant = drop a folder + restart (or `POST /admin/packs/reload`). YAML on disk is source of truth; the DB may mirror for performance.

### Orchestrators (`agi/orchestrators/`)

- `native.py` — plain `async def` + Pydantic state. **Default for new use cases.** No framework gravity.
- `langgraph.py` — durable, checkpointing, HITL, streaming. Optional extra: `agi-sdk[langgraph]`.
- `pydantic_ai.py` — type-first, Pydantic-native. Optional extra: `agi-sdk[pydantic-ai]`.

Each adapter is ~150 LOC; their only job is to set OpenLLMetry baggage (`bm.pack`, `bm.use_case`, `bm.tenant_id`) and resolve pack tool allow-lists. They do not wrap orchestration.

## Conventions

- **Python**: ruff (`select = E,F,I,B,UP,N,S`) + mypy `strict = true`. Line length 100. Targets py311/312/313.
- **Commits**: conventional commits (`feat:`, `fix:`, `docs:`, …). PRs against `main`. One maintainer approval required; CI must be green.
- **Path resolution oddity**: `uv sync --all-packages` writes editable installs as `_editable_impl_*.pth`, which Python's `site.py` filters (underscore prefix → hidden). Root `conftest.py` prepends each workspace package's source dir to `sys.path` to work around this. Do not delete it until `uv` ships a fix.
- **UI**: no hex literals in components — `npm run lint:no-hex` enforces this. Theme tokens come from the active pack.
- **Pytest mode**: `--import-mode=importlib` (set in root `pyproject.toml`) — avoids the duplicate `tests` package collision across workspace members. New tests must be importable in this mode.
- **ADR**: non-trivial changes get a markdown ADR in `docs/decisions/`.

## Status / phase awareness

`README.md` lists current phase progress. When asked about features, check phase status before promising. `EXECUTION_PLAN.html` has the original Gantt and gates (historical — see banner on that file).

| Phase | Scope | Status |
|---|---|---|
| P0 | Public repo scaffold | Done |
| P1 | agi-sdk shell + dispatch seam | Done |
| P1.5 | Orchestrator adapters (LangGraph, Pydantic-AI) | Done |
| P2 | agi-mcpfyer (OpenAPI → MCP) | Done |
| P3 | agi-runtime + claims-validated X-Pack dispatch | Done |
| P4a | Admin UI shell + NextAuth + read-only screens | Done |
| P4b | Tool catalogue + form-from-schema + use-case Langfuse | Done |
| P4c | Audit virtualisation + CSV export + KB reindex SSE | Done |
| P5 | Helm chart green + GHCR publishing + `/chat` helm-test | Done (in-repo); human-blocked steps in `docs/deploy/p5-runbook.md` |
| **P6** | **v1.0 release prep: PyPI publish, docs polish, version freeze** | **In flight** |

## Definition-of-done signals

- `pip install agi-sdk` works from a clean machine.
- `docker compose up` brings the band-2 stack up in <5min with `/healthz` green.
- Multi-pack-per-pod runtime rejects any request whose `X-Pack` doesn't match its tenant claim.
- Pack hotfix completes ≤15min from merge to live.
- OpenLLMetry traces land in Langfuse with `bm.pack` / `bm.use_case` / `bm.tenant_id` overlaid.
