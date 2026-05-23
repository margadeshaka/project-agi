# project-agi — resolved stack

> **Historical design doc** — see `README.md` for the current open-source v1.0 framing. Stale references to "care-intelligence retrofit" in this file reflect early-2026 scoping when project-agi was an internal spin-out; the current intent is from-scratch open-source for the open world.


**Date:** 2026-05-22
**Inputs:** `PLAN.html` v2, `ADMIN_CONSOLE.md`, full debate transcript in `DEBATE.md` (Framework Advocate + Platform Advocate, two rounds), and an independent orchestration research brief.
**Status:** Decisions taken on the three unresolved questions; everything the two sides converged on is now ratified.

> This document is **load-bearing**: it overrides `PLAN.html` v2 wherever they conflict. A v3 of `PLAN.html` will be regenerated to match this.

---

## Decisions

### Decision 1 — Deployment unit: pack-group-per-pod (default), single-pack-per-pod (hardening mode)

**Resolution:** Adopt the **Platform Advocate's** position with a Framework guardrail.

The default deployment shape is **one runtime container per tenant, hosting that tenant's packs**, dispatched by `X-Pack` header. Single-pack-per-pod is supported as a "hardening mode" for regulated tenants who buy isolation at the cost of baseline infra.

**Why this side wins:** The Framework's "one container per use case" rule is doctrinally correct for autonomy but operationally fatal at telco scale. The Platform's math is hard to argue with — 4 packs × 5 use cases × 2 replicas = 40 pods, 40 Helm releases, 40 cert rotations per customer. We will not ship an OSS stack where the OSS adopter who runs one VM gives up on day one.

**Framework guardrails that come with this:**
- `X-Pack` header is **mandatory on every request**; missing header → 400. No default-pack fallback in production paths. Same rule care-intelligence already enforces with `X-Brand`.
- Pack resolution is **claims-based**, not header-trust-based. The auth adapter resolves the pack from the authenticated token's tenant claim; the header is consistency-checked against the claim and rejected on mismatch. This closes the multi-tenant leak the Platform side identified.
- The SDK itself contains **no** pack-dispatch logic. The SDK takes one pack at a time and runs against it. Header dispatch is an `agi-runtime` concern — packs are an SDK concept, multi-pack-per-process is a runtime concern.
- Hardening mode (single-pack-per-pod) ships as a Helm values flag, not a separate chart. Operators flip a switch.

### Decision 2 — Runtime + UI altitude: first-class repos, separate visual band from SDK/Core

**Resolution:** Both sides conceded the same shape after R2 — codify it.

The unified architecture has **two distinct visual bands** in every diagram going forward:

```
┌─ Product (the library) ─────────────────────────────────────┐
│  agi-sdk         (Python library — the actual product)      │
│  agi-core        (auto-MCP hub + registry + shared indexes) │
│  agi-mcpfyer     (OpenAPI → MCP generator — first-class)    │
│  agi-packs       (pack spec + reference packs)              │
└─────────────────────────────────────────────────────────────┘
              ▲ depended on by ▲
┌─ Reference Distribution (what Comviva field teams ship) ────┐
│  agi-runtime    (FastAPI + MCP server + X-Pack dispatch)    │
│  agi-ui         (Next.js admin console)                     │
│  agi-auth       (Keycloak reference + generic OIDC iface)   │
│  agi-chart      (Helm — multi-tenant topology)              │
└─────────────────────────────────────────────────────────────┘
```

**Why:** The Framework Advocate is doctrinally right — the SDK is the product, the runtime is a distribution. The Platform Advocate is operationally right — "go look at examples/" is procurement death. The compromise is a deliberate two-band layout that says "library is the heart, deployable is supported." Same repo, distinct visual altitude in every doc and diagram, separate release cadence (SDK majors gate distribution majors, not vice versa).

**Mechanics:**
- Both bands ship from the same monorepo (`project-agi/`).
- `pip install agi-sdk` works without any band-2 package.
- Band-2 packages depend on band-1 packages, never the reverse.
- README leads with the library; the deployable gets its own subdoc (`DISTRIBUTION.md`).
- Architecture diagrams always render the two bands. A bare "agi-runtime is the product" wording in any doc is a review-blocker.

### Decision 3 — Prompts: YAML-in-pack source of truth, with a documented hotfix lane

**Resolution:** Adopt the **Framework Advocate's** position. Build the hotfix lane the Framework named so the operator pain is solved without the audit hole.

**The rule:**
1. Prompts live as YAMLs in the pack (`packs/<slug>/prompts/`), baked into the runtime container at build, PR-reviewed.
2. There is **no** DB-stored prompt with runtime editing. The admin UI shows prompts read-only (per `ADMIN_CONSOLE.md` §0).
3. The "Friday-night edit without our CI pipeline" pain is solved by a **pack hotfix flow** that is itself part of the OSS deliverable:
   - Each pack lives in a folder that is its own git repo (or subdir of the customer's pack repo).
   - A documented `pack-hotfix/<ticket-id>` branch convention with: pre-merge automated smoke (KB + prompt-render + tool-schema), auto-tag on merge, container rebuild + image push triggered by tag, runtime auto-reload on the new image tag.
   - Promised time-to-prod for a prompt hotfix: ≤ 15 minutes from merge to live, well inside any Friday-night change window.

**Why:** The regulator-asks-why-did-the-refund-threshold-change failure is real and severe; DB-stored runtime-editable prompts make this failure trivially easy to land in. The Platform side's Friday-night pain is real but the answer is *faster delivery* not *bypass review*. Building the hotfix lane gives us both.

**What the Platform Advocate gives up:** `resource_service.update(..., create_version=True, version_type=VersionType.MINOR)` for prompts. The version+restore mechanism stays useful for KB articles (where the failure mode is different — facts updating, not behaviour changing) but is not extended to prompts.

**What the Framework Advocate owes:** the hotfix lane must be documented and reference-implemented as a CI workflow template, not left as an aspiration.

---

## Ratified positions (both sides converged)

These were resolved during R1/R2 by mutual concession; codifying:

| Topic | Position |
|---|---|
| Model gateway | **LiteLLM library mode.** No custom model abstraction. |
| Role binding | **Roles-not-providers** with lint enforcement (`import openai/anthropic/boto3` requires explicit waiver comment). |
| Telemetry | **OpenLLMetry auto-instrumentation** is the only default trace path. `Traceloop.init()` at SDK boot. |
| Audit | **AI-Trail is an audit sink**, not a telemetry API. OTel collector pipes spans → AI-Trail with the regulator-grade schema overlay. Use-case authors do not call AI-Trail directly. |
| Identity | **Keycloak as the reference adapter**, generic OIDC interface, static-token + dev-noop for dev. Three-role RBAC (`AGI_ADMIN/DEVELOPER/VIEWER`) enforced centrally at the dispatch layer. |
| Tool plane | **Everything is MCP**, no exceptions. Auto-generated from OpenAPI via `agi-mcpfyer`. |
| Auto-MCP-from-OpenAPI | **First-class repo (`agi-mcpfyer`)**, build-time/sidecar generator. Not buried in SDK utilities. |
| Helm chart | **Ships in `agi-chart`** with `BASE_PATH` subdir routing, ConfigMap-mounted pack folders, OTel collector wired. CI green against a kind cluster before v1.0. |
| SDK identity | **Library, not runtime.** No central framework server. SDK runs in the use-case process. |

---

## Orchestration — adopted recommendation

**Position (A) with a sharper escape hatch** — from the independent research brief.

- **Default for new use cases:** plain `async def` + Pydantic state. No framework gravity unless the use case needs it.
- **Two blessed adapters** in optional `sdk.orchestrators` package:
  - `langgraph` — durable, checkpointing, HITL, streaming. License: MIT for the lib; commercial gravity only at the LangGraph Platform line, which we do not adopt.
  - `pydantic_ai` — type-first, FastAPI-style ergonomics, Pydantic-native (matches `sdk.config`).
- Adapters are ~150 LOC each; their job is to set OpenLLMetry baggage and resolve pack tool allow-lists. They do not wrap orchestration.
- **Plain async stays the default** in docs, starter packs, and getting-started. Two blessed options keeps "library-first" credible — one blessed option would silently become The Way.

**Watch-conditions** (when this decision flips):
- LangChain, Inc. moves checkpointing or HITL behind the Elastic-licensed LangGraph Platform → demote LangGraph to "supported," promote Pydantic AI or Strands Agents to blessed.
- If ≥ 80% of packs end up as long-running durable workflows → evaluate Temporal / Inngest / Hatchet outside the LLM-framework class.

**Care-intelligence retrofit** (Phase 6 of `PLAN.html`): care-intelligence already uses LangGraph; the retrofit runs against the `langgraph` adapter — no port required, just rebinding to `agi-sdk` interfaces.

---

## The resolved stack (band-by-band)

### Band 1 — Product (the library)

| Package | Purpose | Position |
|---|---|---|
| `agi-sdk` | Python library; `sdk.{models, mcp, rag, prompts, config, serve, trail}` + optional `sdk.orchestrators.{langgraph, pydantic_ai}`. `Traceloop.init()` at boot. | The product. Pure Python; no FastAPI, no DB, no UI. |
| `agi-core` | Tool registry, shared vector indexes, hub proxy. | Optional shared services. |
| `agi-mcpfyer` | OpenAPI → MCP generator (versioned tool bundles). | First-class repo. Build-time. |
| `agi-packs` | Pack spec + reference packs (`blank`, `telco-demo`, `fleet-demo`). | Reference content. Customer packs live elsewhere. |

### Band 2 — Reference Distribution (what Comviva field teams ship)

| Package | Purpose | Position |
|---|---|---|
| `agi-runtime` | FastAPI + MCP server + `X-Pack` header dispatch + `/chat /tools /kb /trail /mcp` routes. | Reference deployable. Consumes `agi-sdk`. |
| `agi-ui` | Next.js admin console (per `ADMIN_CONSOLE.md`). | Reference UI. Pack switcher, AI-Trail viewer, tool inspector, KB browser, LLM role bindings, admin log. |
| `agi-auth` | Keycloak reference adapter + generic OIDC interface + static-token + dev-noop. Three-role RBAC enforced centrally. | Reference identity. |
| `agi-chart` | Helm chart, `BASE_PATH` subdir routing, ConfigMap-mounted packs, OTel collector, hardening-mode toggle. CI green against kind. | Reference deployment topology. |

### Cross-cutting

| Concern | Choice |
|---|---|
| Tracing default sink | Langfuse (self-hosted, OTLP ingestion) |
| Audit sink | AI-Trail (Mongo or Postgres) — wired off the OTel collector, not from use-case code |
| Storage default | SQLite (dev); Postgres (prod default); Mongo supported |
| Vector store default | Qdrant; Mongo Atlas Search + pgvector + Weaviate as adapters |
| Eval harness | Promptfoo CLI, with a thin wrapper for tenant-profile expansion |
| Release | Apache-2.0; PyPI for `agi-sdk` + `agi-core` + `agi-mcpfyer`; GHCR for `agi-runtime` + `agi-ui` images; chart in `oci://ghcr.io/<org>/agi` |

---

## What changes in PLAN.html v3

Concrete edits the next pass should make:

1. **§4 architecture diagram:** redraw with the two-band layout above. The runtime + UI no longer sit at the same altitude as SDK/core; they sit in a separate "Reference Distribution" band.
2. **§7 repo layout:** rename `packages/agi-runtime/` and `packages/agi-ui/` siblings of `packages/agi-sdk/`, but move `agi-mcpfyer/` from inside `agi-core/` to its own top-level package. Add `agi-chart/` under `packages/`.
3. **§8 config model:** add the **claims-based pack resolution** rule. `X-Pack` is validated against the authenticated tenant claim; mismatch → 401, not 200-with-wrong-data.
4. **§8 config model:** clarify that prompts are pack-resident YAML, hotfix lane is the documented pack-hotfix branch convention with CI workflow template.
5. **§11 phases:** add Phase 1.5 — `sdk.orchestrators.{langgraph, pydantic_ai}` adapter package, ~150 LOC each. Phase 4 (admin UI) explicitly excludes prompt editing.
6. **§12 open decisions:** strike (3), (4), (5), (6), (7) — resolved here. Leave (1), (2), (8) as still owner-pending (repo location, final name, eval harness wrapper depth).
7. **§13 risks:** add "multi-pack-per-pod tenancy leak" with the claims-based-pack-resolution mitigation now codified.

---

## What `ADMIN_CONSOLE.md` needs to reflect

Concrete edits the next pass should make:

1. §0 explicit non-goals already lists "Editing prompts at runtime" — keep, reinforce against Platform R1 pressure. Prompts are read-only in the UI.
2. §3.2 Pack overview: replace "operator-level edit of role bindings" with "view + per-session override via `X-LLM-Override`" — runtime mutation of pack config is not a UI feature.
3. §4 API contract: add `GET /audit/pack-hotfix/:slug` (lists hotfix branches and their merge status) so the admin UI surfaces the hotfix lane.
4. §5 RBAC: scope names align with the three-role model (`agi:admin`, `agi:operator:<slug>`, `agi:dev`, `agi:viewer`). Done; no change.
5. §7 Tech: add Keycloak-first identity wiring at NextAuth layer (currently says "Auth.js with OIDC adapter"). Keycloak is the reference; OIDC interface stays generic.

---

## Definition of done (unchanged but reinforced)

- `pip install agi-sdk` works from a clean machine, no Comviva network.
- `docker compose up` (band-2 reference distribution) launches the full stack in under 5 minutes.
- A new tenant is added by dropping a folder under `packs/` and restarting — zero code changes.
- The auto-MCP hub takes any OpenAPI and produces a runnable MCP server. TMF is one example, not a dependency.
- OpenLLMetry traces land in Langfuse with `bm.pack`, `bm.use_case`, `bm.tenant_id` correctly overlaid.
- A pack hotfix completes within ≤ 15 minutes from merge to live (new in v3).
- Multi-pack-per-pod runtime rejects any request whose `X-Pack` doesn't match its tenant claim (new in v3).
- Care-intelligence runs on `agi-sdk` with the `langgraph` adapter in dev.

---

## What's still owner-decision

These survive the debate; the project owner must rule:

1. **Repo location.** `github.com/comviva-oss/project-agi`? Personal org? Net-new neutral org?
2. **Final name.** `project-agi` is a working title. `agi-sdk` / `openagent` / `agentkit` / `agi-stack` — trademark check required.
3. **Eval harness depth.** Promptfoo direct vs thin wrapper for tenant-profile expansion (v0 doc § 7 left this open; debate didn't pick a side).
