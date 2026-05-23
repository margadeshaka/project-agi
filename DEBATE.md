# project-agi — design debate transcript

**Date:** 2026-05-22
**Format:** Two parallel advocates, two rounds each, plus an independent orchestration research brief. Synthesis lives in `RESOLVED_STACK.md`.

| Side | Represents | Source of doctrine |
|---|---|---|
| **Framework Advocate** | Library-first SDK, "not a platform" | `bluemarble-ai-framework` `v0` (`docs/00..08`) |
| **Platform Advocate** | Production runtime + UI + Helm + Keycloak | `bm-ai-platform` `develop` + `care-intelligence` lived experience |

---

## Round 1 — opening positions

### Framework Advocate — opening

#### 1. Non-negotiables

**(a) Library-first SDK, not a server-first runtime.** `docs/02-Overview.md` § *Key architectural properties* is unambiguous: "The framework is a library, not a runtime. The SDK runs *inside* each use case service's process… There is no central 'framework server' that's a single point of failure." `docs/01-Why.md` § *Calling it a "platform"* explicitly forbids the platform framing because it "creates wrong expectations about staffing, scope, and ownership." **Failure mode if violated:** the moment `agi-runtime` becomes the assumed entry point, every use case team waits on the runtime team to ship features, the runtime grows feature flags to accommodate them, and within 12 months we have rebuilt bm-ai-platform with a new name. The `pip install agi-sdk` story dies.

**(b) Roles-not-providers, with lint enforcement.** `docs/03-SDK-Layer.md` § *Design principles* § 1 makes the role binding the SDK's first principle, and `docs/02-Overview.md` shows lint blocking `import anthropic / openai / boto3` with only an explicit `# bm-ai: allow native sdk` waiver. **Failure mode if violated:** the second a provider name leaks into use-case code (Bedrock region, Azure deployment slug, OpenAI org id), we are no longer config-portable and the EU AI Act / on-prem story breaks.

**(c) OpenLLMetry auto-instrumentation as the *only* default tracing path; AI-Trail is audit, not telemetry.** `docs/02-Overview.md` § *Observability comes from auto-instrumentation, not wrapper APIs* — `Traceloop.init()` at SDK boot, `SpanProcessor` overlays baggage, "There is no `sdk.tracer` escape hatch." **Failure mode if violated:** use-case authors will wrap every call by hand, native-SDK escape hatches will silently lose observability.

#### 2. Wrong compromises in PLAN.html v2

**(a) §4 "Architecture" lists `agi-runtime` and `agi-ui` as part of the architecture diagram.** They should be in a separate "examples/" section. By including them at the same visual altitude as `agi-sdk` and `agi-core`, the document trains every reader to think there is a "core runtime" component. `docs/02-Overview.md`'s diagram has **three** layers (use case services / SDK / Intelligence Core) and observability *beneath*. The runtime is not a layer.

**(b) §8 "Configuration model" makes `X-Pack` header dispatch first-class and §11 Phase 3 ships it before Phase 6 retrofits care-intelligence.** This is the bm-ai-platform multi-tenant-per-deploy pattern smuggled in under "packs." `docs/02-Overview.md` § *Use cases are autonomous services* is explicit: **one container per use case, independently deployed, scaled, failed**. Header-dispatched pack selection inside a single runtime is the opposite shape — it's the multi-tenant SaaS pattern v0 explicitly rejected. Pack-per-pod must be the default; multi-pack-per-pod is a dev-mode convenience, not a deployment topology.

#### 3. Concession

**Optional admin UI (Phase 4, `agi-ui`).** Strictly v0 says "Langfuse + Promptfoo cover the screens." But: (i) OSS adopter audience is broader than Comviva's AI engineers, and a one-screen pack switcher + AI-Trail viewer lowers activation cost dramatically; (ii) Langfuse doesn't render pack-level config or audit-grade AI-Trail; (iii) keeping the UI **optional, in a separate package, headless mode fully supported** costs me far less than fighting that battle.

#### 4. Minimum stack

**A Python library you import, a YAML pack you load, and a hub that turns OpenAPI into MCP — everything else is an example.**

- `agi-sdk` — Python library; `sdk.{models,mcp,rag,prompts,config,serve,trail}`; `Traceloop.init()` at boot.
- `agi-core` — auto-MCP-from-OpenAPI generator (`mcpfyer`) + shared vector indexes + tool registry.
- `packs/<slug>/` — YAML + prompts + KB seeds; loaded by SDK; one pack per process.
- OpenLLMetry → Langfuse (self-hosted) as the *only* default trace sink; AI-Trail is a separate audit-only writer.
- `examples/{embedded,service,multi-tenant}` — including a docker-compose reference; explicitly labelled examples, never the product.

---

### Platform Advocate — opening

#### 1. Non-negotiables

**(a) An admin UI that ships in the box, not an optional afterthought (§4 calls it "optional friendly defaults").** The platform's `src/ui/` (Next.js 16, NextAuth, `<RoleGuard>`, `useUserRoles()`) is what a non-technical operator at a customer site actually touches. Care-intelligence proves this: the `ModelIndicator` chip, `admin/llm` page, AI Trail viewer, KB browser, brand switcher — operators use these to debug their own incidents at 2am without paging us. **Scenario:** KPN's L2 ops engineer needs to know which provider answered the last failed agent run for ticket #INC-4421. **With the platform UI:** clicks the AI Trail row, sees the `correlation_id`, gets the tokens/tools/error in one view. **Failure mode if UI is "optional":** they SSH to a pod, `kubectl logs`, grep for the correlation_id across two services, escalate to us. We become the support tier. Langfuse is a developer tool, not an operator console; it knows nothing about packs, brand tokens, or RBAC scoped to BSS roles.

**(b) Pluggable identity that actually includes Keycloak as a first-class adapter — not "OIDC adapter with Keycloak as one option" (§3, §9).** Every Comviva customer site already runs Keycloak as part of the BSS stack. The platform's `bm-ai-auth` (JWTValidator + KeycloakClient + `require_role`/`require_permission` decorators + the three `BM_AI_ADMIN/DEVELOPER/VIEWER` realm roles centrally enforced in `src/bm_mcp/routes/mcp_routes.py`) is what unblocks the procurement conversation. **Failure mode:** "dev-noop / static-token / generic OIDC" gets you a GitHub-star demo; it does not get you through a telco security review. `X-Brand` law (care-intelligence rule 5) only holds because the identity layer is real — header dispatch without authenticated tenant claims is a multi-tenant data-leak waiting to happen.

**(c) A real Helm chart with a working multi-tenant deployment topology (§7, §11 Phase 5).** `charts/bm-ai-platform/` deploys today against `int-fall25.comviva.com` with `BASE_PATH` subdir routing, Mongo connection-string from config, RBAC roles wired to Keycloak realm roles. **Failure mode:** a chart "re-parameterised by pack" that was never deployed against a real ingress will discover its bugs at the customer site at go-live. The framework side has never shipped to a cluster; this is exactly where lived-experience wins.

#### 2. Wrong compromises in PLAN.html v2

**§2 "Prompts: YAMLs in repo, baked into container at build, PR-reviewed."** This is framework purism dressed as discipline. Operators at customer sites do not have a PR workflow into our repo. They have a Friday-night change window and a regulator asking why the agent's reply changed. The platform's DB-stored prompts + version field + restore (`resource_service.update(..., create_version=True, version_type=VersionType.MINOR)`) lets ops roll forward and back without a redeploy. **What an operator loses:** the ability to fix a prompt without a CI/CD pipeline they don't own. The "audit problem" the PLAN cites is solved by `audit_service.py` + AI Trail — we already have it.

**§2 + §9 "Drop the heavy DI / facades / factories layer."** The platform's DI is not ceremony — it is how `type_handlers/`, `MongoDBService`, `config_manager.get_mongodb_config()`, and the LLM router stay swappable per-deploy without code changes. **What an operator loses:** the moment you replace DI with "plain Python + Pydantic," every customer who wants a different Mongo auth mode, a different embedding cache, or to swap Qdrant for Atlas Search has to patch source.

#### 3. Concession

**LiteLLM as the model runner, role-keyed bindings, OpenLLMetry auto-instrumentation (§2, §5).** Give up the platform's custom LLM abstraction (`ai_service.py` / `llm_service.py` / `llm/router.py`) and the hand-rolled tracing paths. Reason: maintaining a private model gateway is debt with zero customer value, and `Traceloop.init()` over LiteLLM gives us better trace coverage than our hand-rolled spans. AI Trail stays on top as the regulator-grade audit sink (it already exists — `ai_trail` collection, `correlation_id` law in care-intelligence rule 7).

#### 4. Minimum stack

**Framework SDK plus a deployable runtime+UI+chart that a Comviva field team can stand up at a customer site on day one — not an optional turnkey afterthought.**

- `agi-sdk` (Python lib, LiteLLM runner, role-keyed bindings, OpenLLMetry, MCP tools, AI Trail audit sink)
- `agi-runtime` (FastAPI shell, `X-Pack` header dispatch, MCP endpoint, `assistant/stream` SSE) — **mandatory, not optional**
- `agi-ui` (Next.js shell, RoleGuard, AI Trail viewer, pack switcher, KB browser, `admin/llm` page) — **mandatory, not optional**
- `agi-auth` (Keycloak adapter as the reference implementation + generic OIDC, with three-role RBAC centrally enforced at the dispatch layer)
- `deploy/helm/agi/` (real chart with `BASE_PATH`, ConfigMap-mounted pack folders, Mongo connection-string from config) — **CI green against a kind cluster before v1.0**

---

## Round 2 — rebuttals

### Framework Advocate — rebuttal

#### A. Concede

1. **Keycloak as a first-class adapter, not a generic "OIDC option."** The Platform Advocate is right that every Comviva site already runs Keycloak as part of BSS and that procurement reviews don't tolerate "dev-noop / static-token / generic OIDC." Framework v0 `docs/01-Why.md`'s "retrofit, not greenfield" rule cuts against me here. Adjust: `bm-ai-auth` ships as the **reference** identity adapter in the SDK, with the *interface* generic. This also fixes their valid critique that `X-Brand` dispatch without authenticated tenant claims is a data-leak waiting to happen — claims-based pack resolution requires real auth, and fuzz tests (PLAN.html §13) are not the answer.

2. **The Helm chart is lived experience and I won't throw it away.** `charts/bm-ai-platform/` has shipped against `int-fall25.comviva.com` with `BASE_PATH` subdir routing — that's load-bearing knowledge a framework rewrite would relearn at a customer site at go-live. Concede: the chart ships in `agi-runtime` as a **reference deployment**, parameterised by pack. What I do *not* concede is making it the only supported topology.

#### B. Rebut

1. **"Mandatory runtime + UI + Helm chart in the box."** Reject. If `agi-runtime` and `agi-ui` ship at the same altitude as `agi-sdk` (PLAN.html §4), every new use case will fork the runtime instead of importing the SDK. We rebuild bm-ai-platform with a new name. The `pip install agi-sdk` + 20-line `main.py` story — the thing that lets a Comviva field team prototype a new agent in an afternoon — dies. **Counter:** runtime + UI ship as `agi-examples/` reference apps that *use* the SDK, with the chart parameterised. KPN's 2am L2 engineer scenario is real, but solved by the AI Trail viewer being a thin React component that consumes `/ai_trail` — not by coupling it to the SDK's release cycle.

2. **"DB-stored runtime-editable prompts because operators need Friday-night edits."** Reject hard. This is the change-without-review trap framework v0 `docs/01-Why.md` explicitly named. The failure mode: regulator asks "why did the agent's refund threshold change on March 14?" — Ops did a hot-edit in the admin UI, no PR, no diff in source control, `audit_service.py` logs *who* changed it but not *why* or *whether anyone reviewed it*. YAMLs-in-repo + PR review is the only path that survives a telco audit. The real operator pain is solved by a tested "pack hotfix" branch with a fast-merge bot, not by making prompts a database row.

3. **"Heavy DI / facades / factories is necessary for swappability."** Reject. Swappability comes from **interfaces** (Protocols, ABCs), not from `type_handlers/` + `MongoDBService` + `config_manager.get_mongodb_config()` + LLM router layers. LiteLLM (which they conceded) proves the point: one library, one interface, every provider swappable, zero factories.

#### C. Unresolved — for the project owner

1. **Is the runtime mandatory or a reference example?** *(a) Ships in `agi-runtime` package, required for full feature set → bm-ai-platform with rename. (b) Ships in `agi-examples/`, SDK works standalone → framework-first, runtime is opinion.*

2. **Are prompts source-controlled YAMLs or DB rows with restore?** *(a) YAMLs only, hotfix via fast-merge branch → audit-clean, slower ops. (b) DB-stored with `VersionType.MINOR` restore → fast ops, regulator risk.*

3. **Is multi-tenancy per-deploy (one container per pack) or per-request (X-Pack header dispatch)?** *(a) Per-deploy default, header dispatch opt-in for dev only → framework v0 topology. (b) Header dispatch in Phase 3 production → platform topology, claims-based gating required.*

#### D. Adjusted minimum stack

A Python SDK + YAML pack + auto-MCP-from-OpenAPI hub, with Keycloak as the reference identity adapter and a reference runtime+chart shipped as examples — not as the product.

- `agi-sdk` (Python library, LiteLLM-backed, OpenLLMetry auto-instrumented)
- `agi-pack` spec (YAMLs in repo, PR-reviewed, baked at build)
- `agi-mcp-hub` (auto-MCP-from-OpenAPI, role-keyed tool allowlist)
- `agi-auth` reference adapter (Keycloak-first, generic OIDC interface)
- `agi-examples/` (reference runtime + admin UI + Helm chart, importing the SDK — not extending it)

---

### Platform Advocate — rebuttal

#### A. Concede

1. **Library-first identity is correct; runtime is a *distribution*, not a layer.** The Framework Advocate's citation of `docs/02-Overview.md` § *Key architectural properties* ("library, not a runtime… no central framework server") is doctrinally sound, and the failure mode they predict — `agi-runtime` becoming the assumed entry point and recreating bm-ai-platform under a new name — is exactly what `bm-ai-platform/CLAUDE.md` warns about with its MCP-first thin-proxy rule. Withdraw "minimum stack = SDK + mandatory runtime." The SDK is the product. The runtime is the *reference distribution* that Comviva field teams happen to ship — first-class, supported, charted, but architecturally a consumer of the SDK, not a layer of it.

2. **AI-Trail is audit-only; OpenLLMetry owns telemetry.** Conceded LiteLLM + OpenLLMetry in Round 1; now accept the framework's stricter framing: use-case authors never call AI-Trail directly. Traces flow OTel → collector → AI-Trail sink for regulator-grade retention. This matches care-intelligence rule 7 — the *capture* is automatic, AI-Trail is just the durable sink with the audit schema on top.

#### B. Rebut

1. **"Pack-per-pod is the default."** Reject. At Comviva telco scale this is operationally unviable. A real customer (BlueMarble + BT + KPN + Verizon-Connect) × 3 scenarios (deflect/resolve/escalate) × min 2 replicas = 24 pods, 24 Helm releases, 24 HPA configs, 24 cert rotations, 24 Keycloak client registrations *per customer*. The deployment unit should be **pack-group-per-pod** (one runtime, N packs from the same tenant, header-dispatched), with single-pack-per-pod available as a hardening option for regulated isolation. **Failure mode if framework wins:** baseline infra cost explodes 10-20×, field teams hand-write per-pack Helm overlays, and the OSS adopter who runs one VM gives up on day one.

2. **"Runtime/UI go in examples/."** Reject hard. PLAN.html §4 listing `agi-runtime` and `agi-ui` in the architecture diagram is correct and must stay. care-intelligence is built around `/ci-start`, `/ci-health`, deployed routes at `/ai/care-intelligence/*`, Keycloak at `bm-demo5.comviva.com` — these aren't examples, they're the procurement artifact. **Failure mode if framework wins:** Comviva sales walks into a customer, the customer asks "show me the product," and we point at a Python import. Procurement closes the deck. The library-first *identity* (§A.1) is right; relegating the deployable to examples/ is wrong.

3. **Auto-MCP-from-OpenAPI (mcpfyer).** Concede the strategic value, contest the placement. It IS the differentiator vs LangChain/LlamaIndex. But it's a **build-time/sidecar generator**, not core runtime. Elevate to a first-class repo (`agi-mcpfyer`) alongside SDK and runtime, not buried under SDK utilities.

#### C. Unresolved

1. **Deployment unit: pack-per-pod or pack-group-per-pod?** *Per-pod* implies cleaner isolation, framework-pure, telco-unaffordable. *Per-group* implies header-dispatch in runtime, operationally sane, framework-impure.

2. **Is `agi-runtime` in the architecture diagram or in examples/?** *In-diagram* implies Comviva ships a product, OSS adopters get a paved road, library identity gets fuzzy. *In examples/* implies pure SDK identity, every field engagement custom-builds the host.

3. **Prompts: YAML-in-pack-only, or YAML + DB-backed runtime overlay?** *YAML-only* implies reproducible, git-versioned, ops-discipline-required. *DB overlay* implies operators edit prompts at 2am without a redeploy, with version+restore.

#### D. Adjusted minimum stack

A Python SDK is the product, and a reference runtime + UI + Helm chart are the supported distribution Comviva field teams deploy — both first-class repos, neither subordinate to the other.

- `agi-sdk` — library, role-keyed bindings, LiteLLM-backed, OpenLLMetry auto-instrumented
- `agi-mcpfyer` — OpenAPI → MCP generator, first-class repo, build-time
- `agi-runtime` — reference FastAPI host, pack-group-per-pod default, single-pack hardening mode supported
- `agi-ui` — admin UI with Keycloak-first adapter, ships in the box for the reference distribution
- `agi-chart` — production Helm chart with proven multi-tenant topology, AI-Trail sink, OTel collector wired

---

## Convergence map

| Topic | After R2 |
|---|---|
| LiteLLM as model runner | **Agreed** |
| Roles-not-providers | **Agreed** |
| OpenLLMetry as default telemetry, AI-Trail as audit-only sink | **Agreed** |
| Auto-MCP-from-OpenAPI (mcpfyer) is strategic | **Agreed**; placement debated (build-time vs core) |
| Keycloak as first-class reference identity adapter | **Agreed** |
| SDK is the product; runtime is a distribution (not a layer) | **Agreed** |
| Helm chart ships as reference (not the only topology) | **Agreed** |
| **Deployment unit (pack-per-pod vs pack-group-per-pod)** | **Unresolved** |
| **Runtime/UI in architecture diagram vs examples/** | **Unresolved** |
| **Prompts: YAML-only vs YAML + DB overlay** | **Unresolved** |

---

## Orchestration research brief (independent)

> Constraints: `project-agi` is a library-first Python SDK, LiteLLM as model runner, MCP-only tools, OpenLLMetry auto-instrumentation, multi-tenant via YAML packs, retrofit-don't-greenfield, framework-gravity warning. Care-intelligence already uses LangGraph in production.

### LangGraph deep look

**Current state.** LangGraph 1.0 GA was October 2025; latest is **1.3.2** (May 2026), with 1.2 (May 11 2026) adding content-block-aware streaming and improved `interrupt()` semantics. License is **MIT** for `langgraph`, `langchain-core`, and integrations — but `langgraph-api` (the server runtime behind LangGraph Platform) is **Elastic License 2.0** and requires a commercial key for production self-hosting. Governed by LangChain, Inc. Release cadence: majors every 6–12 months, minors every 1–2 months. Stable runtime, but with a clear commercial gravity well above the MIT line.

**What it gives beyond `async def`:** checkpointing (in-memory / SQLite / Postgres), `interrupt()` / human-in-the-loop with durable state, conditional edges & subgraphs, streaming integration (token / message / state-delta), state reducers, MCP tools native via `langchain-mcp-adapters`.

**Real downsides.** Coupling to LangChain message types (`BaseMessage`, `HumanMessage`); graph mental model learning curve; debugging via traces not pdb; per-step overhead; release motion (~6 minors/year). Lock-in shape: type lock-in + commercial-runtime gravity (LangGraph Platform).

**Composition.** LiteLLM ✓ (call directly). MCP ✓ (via `langchain-mcp-adapters`). OpenLLMetry ✓ (auto-instruments LangGraph). YAML packs / `X-Pack` orthogonal — inject pack-scoped state.

### Alternatives surveyed

| Option | Pitch | License | Fit |
|---|---|---|---|
| Plain `async def` + state dict | Just write Python | n/a | **Best library fit.** Zero gravity. Default in v0 docs already. |
| LlamaIndex Workflows 1.0 | Event-driven step pattern | MIT | Decent. Pulls in a tangential ecosystem. |
| CrewAI 1.10 | Role-based multi-agent | MIT | Wrong shape — most CI use cases are single-agent + tool loop. |
| Microsoft AutoGen 0.7 | Conversation-pattern multi-agent | MIT | Avoid — in maintenance, succeeded by Microsoft Agent Framework. |
| **Pydantic AI v1** | Type-first; FastAPI-style ergonomics | MIT | **Strong fit.** Pydantic-native matches `sdk.config`. |
| Burr (Apache, ex-DAGWorks) | Lightweight state machine + tracing UI | Apache 2.0 | Good fit, small ecosystem — survival bet. |
| DSPy 2.x | Compile signatures+metrics → optimized prompts | MIT | Complementary, not competing. |
| **Strands Agents 1.0 (AWS)** | Model-driven agent SDK; Apache-2.0 end-to-end | Apache 2.0 | **Strong fit on licensing.** Library-first, MCP-native, OTel built-in. |
| OpenAI Agents SDK | Lightweight multi-agent loop | MIT | OK; cleaner alternatives exist. |
| smolagents (HF) | Minimalist code-agent paradigm | Apache 2.0 | Wrong shape for tool-calling care flows. |

### "Build something new"

A thin in-house orchestrator on top of LiteLLM + MCP would be ~600–1200 LOC: `Run` object with state/messages/pack/correlation_id, `step()` coroutine, `checkpoint()` hook (pluggable backends), `pause`/`resume` for HITL, streaming via LiteLLM's async generator. **Cost:** every LangGraph improvement (streaming, checkpointing, HITL semantics) is re-built or skipped; we own bug fixes forever; we support our own backends. **Gain:** no LC type leakage, Apache-2.0 end-to-end, total alignment with `sdk.config`/`sdk.trail`/`sdk.serve`, smaller dep footprint.

### Recommendation — **(A) with a sharper escape hatch**

Keep PLAN.html position: **LangGraph as the blessed-but-optional orchestrator, plain `async def` as the default**, *but* explicitly bless **one alternative** alongside LangGraph and write the SDK so it doesn't presume *any* orchestrator.

- `sdk.{models,mcp,prompts,rag,config,serve,trail}` know nothing about orchestration.
- Optional `sdk.orchestrators` package ships **two** thin adapters: `langgraph` (durable, checkpointing, HITL) and `pydantic_ai` (type-first, lighter, no LC types). Plain `async def` is default in docs and starter packs.
- Adapters just ensure OpenLLMetry baggage (`bm.pack`, `bm.use_case`, `bm.tenant_id`) is set on the right spans and MCP tools are loaded from the pack allow-list. ~150 LOC each.

**Why this beats the alternatives:**
1. **Multi-tenant via packs:** Orchestrator choice is per-pack, not global.
2. **Embeddable library:** SDK can't impose LC types on importers — LangGraph stays optional, not transitive.
3. **OpenLLMetry-instrumented:** Both LangGraph and Pydantic AI are auto-instrumented.
4. **MCP-only tools:** Existing adapters handle both paths; nothing to invent.
5. **Retrofit-don't-greenfield:** Care-intelligence already uses LangGraph — retrofit doesn't fight existing platform layer.
6. **Framework gravity warning:** Two blessed options + plain async default makes "library-first" credible. One blessed option would silently become The Way.

**Two scenarios where this is wrong:**
1. **LangChain, Inc. tightens the commercial moat.** If durability/HITL primitives move behind LangGraph Platform's Elastic-licensed runtime, demote LangGraph to "supported" and promote Pydantic AI or Strands Agents to blessed.
2. **Use-case set narrows to a single durable-workflow pattern.** If 80% of packs become "long-running workflow with retries and HITL," a workflow engine outside LLM-frameworks (Temporal, Inngest, Hatchet) probably beats every option here.

### Sources

- LangGraph 1.0 GA · LangGraph releases 1.3.2 · LangGraph MIT vs Elastic-License · `langchain-mcp-adapters`
- LlamaIndex Workflows 1.0 · CrewAI · AutoGen → Microsoft Agent Framework
- Pydantic AI v1 · Burr · DSPy
- Strands Agents 1.0 GA (Apache-2.0) · OpenAI Agents SDK · smolagents
- OpenLLMetry · Langfuse + OpenLLMetry integration

---

## Synthesis

See `RESOLVED_STACK.md` for the unified decisions and the v3 stack shape.
