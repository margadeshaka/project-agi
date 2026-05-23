# Orchestrator research — agent loops in project-agi

> **Historical design doc** — see `README.md` for the current open-source v1.0 framing. Stale references to "care-intelligence retrofit" in this file reflect early-2026 scoping when project-agi was an internal spin-out; the current intent is from-scratch open-source for the open world.


**Date:** 2026-05-22
**Status:** Research brief that drove decision R8 in `RESOLVED_STACK.md`
**Outcome:** Plain `async def` is the default; `langgraph` and `pydantic_ai` ship as blessed-but-optional adapters in `sdk.orchestrators`. Plain async + two blessed options keeps "library-first" credible.

> **Why this document exists:** the original research lived inside `DEBATE.md` and was easy to miss. Extracted here as a first-class artefact so future contributors can see the comparison, the watch-conditions, and what to revisit when the OSS landscape shifts.

---

## Constraints that bound the choice

This is a **vertical-agnostic** OSS project. The orchestrator choice has to survive contact with use cases we haven't imagined yet — care, claims, fraud, fleet, banking back-office, retail returns, energy meter-read explainers, healthcare triage handoffs, education tutor flows, anything. The constraints below are what stay constant across verticals:

1. **Library-first SDK.** `agi-sdk` is a `pip install`. It cannot impose an orchestration framework on importers — orchestrators must be opt-in.
2. **Multi-tenant via YAML packs.** Orchestrator choice can vary per-pack. A pack author who hates graphs stays on plain async.
3. **MCP-only tools.** Whatever orchestrator we pick, it must compose cleanly with the official MCP Python SDK.
4. **OpenLLMetry auto-instrumentation.** Traces must carry `bm.pack`, `bm.use_case`, `bm.tenant_id` baggage. Any orchestrator that bypasses OTel is disqualified.
5. **LiteLLM library mode.** Model calls happen in-process; no central model gateway. The orchestrator must not insist on its own provider abstraction.
6. **Retrofit, don't greenfield.** Care-intelligence (one early consumer) is already on LangGraph. A choice that forces a port is paying for nothing.
7. **Framework-gravity discipline.** If we bless exactly one orchestrator, that one silently becomes The Way. Discipline says we either bless zero or bless multiple.

---

## LangGraph deep look

### Current state (as of research date)

| Field | Value |
|---|---|
| Latest version | **1.3.2** (May 2026); 1.0 GA was October 2025 |
| Recent change | 1.2 (May 11 2026) — content-block-aware streaming, improved `interrupt()` semantics |
| License | **MIT** for `langgraph`, `langchain-core`, integrations |
| Commercial line | `langgraph-api` (the server runtime behind LangGraph Platform) is **Elastic License 2.0** — requires a commercial key for production self-hosting |
| Governance | LangChain, Inc. (Series A in 2024) |
| Production users | Uber, LinkedIn, Klarna |
| Release cadence | Majors every 6–12 months, minors every 1–2 months |
| Maturity | Stable runtime, **commercial gravity** beyond the MIT line |

### What it gives us beyond `async def`

| Primitive | What it is | Where it matters |
|---|---|---|
| Checkpointing | Persists graph state per node execution; in-memory / SQLite / Postgres backends | Multi-day workflows, crash recovery |
| `interrupt()` / HITL | Pause-and-resume primitive with durable state | Anywhere a human approves a side-effect |
| Conditional edges & subgraphs | Explicit branching, fan-out/fan-in, nested graphs | Complex flows beyond a single tool loop |
| State reducers | Append/replace/merge semantics on shared state | Multi-agent state sharing without hand-rolled locking |
| Streaming integration | Token, message, state-delta, event streams with consistent semantics | UX requirements for live updates |
| MCP integration | Native via `langchain-mcp-adapters` (`MultiServerMCPClient`) | Exactly the multi-server shape we want |

### Real downsides

| Concern | Detail |
|---|---|
| LangChain type coupling | `langchain-core` types leak in (`BaseMessage`, `HumanMessage`); even when you avoid `langchain` proper, nodes end up speaking LC's message vocabulary |
| Learning curve | The graph mental model (nodes/edges/immutable state/reducers) is a non-trivial concept tax vs plain `async def` |
| Debugging | Stack traces inside graph execution are noisy; you debug via LangSmith/Langfuse traces more than pdb |
| Runtime overhead | A `StateGraph` with checkpointing has noticeable per-step cost vs raw async; fine at agent-call scale, not at hot-path scale |
| API stability | 1.0 promised "zero breaking changes," but ~6 minors per year means real motion; v0 → v1 migration was significant |
| Lock-in shape | Not algorithmic lock-in (graph code is portable conceptually) but **type lock-in** (LC message types) + **commercial-runtime gravity** (LangGraph Platform for HITL/durability at scale) |

### Composition with our stack

| Stack piece | Composition with LangGraph |
|---|---|
| LiteLLM | ✓ Works fine — LangGraph nodes call `litellm.acompletion` directly; no need for LC chat-model wrappers |
| MCP Python SDK | ✓ Via `langchain-mcp-adapters` — adds a dependency layer; we could write a thin shim ourselves instead |
| OpenLLMetry | ✓ Auto-instruments LangGraph — exactly what we want |
| YAML packs / `X-Pack` | ⊝ Orthogonal — LangGraph doesn't object to multi-tenancy; we inject pack-scoped state into the initial graph state. No friction, no help. |

---

## Alternatives surveyed

| Option | Pitch | License | Maturity (May 2026) | Trade-off vs LangGraph | Fit |
|---|---|---|---|---|---|
| **Plain `async def` + state dict** | Just write Python. State is a Pydantic model. | n/a | Battle-tested | No checkpointing, no HITL primitive, no streaming helpers. You implement everything you need — but only what you need. | **Best library fit.** Zero gravity. Default in v0 docs. |
| **LlamaIndex Workflows 1.0** | Event-driven step pattern; steps emit events that trigger other steps | MIT | 1.0 stable; `llama-deploy` GA 2026 | Less "graph" gravity than LangGraph, more structure than async. Couples to LlamaIndex universe (less aggressively than LC). | Decent if we want structure. Pulls in a tangential ecosystem. |
| **CrewAI 1.10** | Role-based multi-agent ("crew" of agents with roles) | MIT | 1.x, large community | Opinionated about *agents as actors*. Forces multi-agent framing on every use case. Native MCP + A2A in 2026. | Wrong shape — most CI/care/back-office use cases are single-agent + tool loop. |
| **Microsoft AutoGen 0.7** | Conversation-pattern multi-agent | MIT (Microsoft) | **In maintenance**; successor is Microsoft Agent Framework | Conversation metaphor doesn't fit deflect/resolve/escalate cleanly. Project being deprecated in favor of Agent Framework. | Avoid — succession risk. |
| **Pydantic AI v1** | Type-first agents; Pydantic-native; FastAPI-style ergonomics | MIT | v1 stable Sept 2025, active in 2026 | Less "orchestration," more "well-typed agent loop + tool calling." Lighter than LangGraph. Pydantic team's stability track record is strong. | **Strong fit.** Pydantic-native matches our `sdk.config`. |
| **Burr (ex-DAGWorks)** | Lightweight state machine library, built-in tracing UI | Apache 2.0 (incubating) | 0.26.x, niche but real | State machine without LC universe. Smaller community; smaller surface; clearer mental model. | Good fit. Survival bet on a smaller community. |
| **DSPy 2.x (Stanford)** | Compile signatures+metrics into optimized prompts | MIT | 160k monthly downloads | **Different category** — prompt-optimization, not orchestration. | Complementary, not competing. Could ship behind `sdk.prompts` later. |
| **Strands Agents 1.0 (AWS)** | Model-driven agent SDK; production at AWS (Q Developer, Glue) | Apache 2.0 | 1.0 GA; used by Anthropic / Meta / Accenture | Apache-2.0 (no Elastic-licensed runtime), production-tested. Newer than LangGraph; smaller community; AWS-flavored. | **Strong fit on licensing and philosophy.** Library-first, MCP-native, OTel built-in. |
| **OpenAI Agents SDK** (`openai-agents`) | Lightweight multi-agent loop; provider-agnostic via Responses API or LiteLLM | MIT | 0.17.x, March 2025, fast-moving | Provider-agnostic but OpenAI-shaped abstractions. Still pre-1.0. | OK; cleaner alternatives exist. |
| **smolagents (HF)** | Minimalist 1000-LOC framework; code-agent paradigm | Apache 2.0 | 26k stars, active | Code-execution agents (LLM writes Python). Wrong paradigm for tool-calling care/back-office flows; great for autonomous research. | Wrong shape for most enterprise flows. |

---

## "Build something new"

A thin in-house orchestrator on top of LiteLLM + MCP would be roughly:

- A `Run` object holding `state: PydanticModel`, `messages: list`, `pack: Pack`, `correlation_id`, `step: int`.
- A `step()` coroutine that calls `litellm.acompletion`, dispatches MCP tool calls via the official SDK, and appends to state.
- A `checkpoint(run)` hook (pluggable: file / Mongo / Postgres) called after each step.
- A `pause(run, reason)` / `resume(run_id)` pair for HITL — durable state required.
- Streaming = forwarding LiteLLM's async generator with span enrichment.

**Realistic size:** ~600–1200 LOC including tests.

**You build it when:** (a) you need fewer than ~5 of LangGraph's features, (b) the framework's mental-model tax exceeds the build-it cost, and (c) you can credibly maintain it.

**The cost.** Every time LangGraph (or Pydantic-AI, or Strands) ships streaming improvements, better checkpointing, new HITL semantics, you don't get them. You re-invent the bug fixes their production users find. You support your own backends. You own the migration story. For a library aimed at use-case authors across many verticals, that maintenance is *every quarter forever*.

**What you'd gain.** No LC type leakage. Apache-2.0 end-to-end (no Elastic-licensed runtime upsell looming). Total alignment with `sdk.config`/`sdk.trail`/`sdk.serve`. Smaller dep footprint. Easier to keep OpenLLMetry attribution exactly the way `bm.pack`/`bm.use_case`/`bm.tenant_id` overlays require.

**Verdict: don't build.** The composition story (LangGraph + Pydantic-AI both compose cleanly with our stack) is strong enough that owning 600–1200 LOC of orchestration forever is debt with no customer value.

---

## Recommendation — adopted as decision R8

**Position (A) with a sharper escape hatch:**

> Plain `async def` is the default for new use cases. Two adapters in `sdk.orchestrators` bless one alternative each.

### Concretely

- `sdk.{models, mcp, prompts, rag, config, serve, trail}` know nothing about orchestration. They are the primitives.
- Optional `sdk.orchestrators` package ships **two** thin adapters:
  - **`langgraph`** — when you need durability, checkpointing, HITL, complex branching, streaming. ~150 LOC.
  - **`pydantic_ai`** — when you want type-first ergonomics, Pydantic-native state, no LC types. ~150 LOC.
- Adapters do only two things: (a) set OpenLLMetry baggage (`bm.pack`, `bm.use_case`, `bm.tenant_id`) on the right spans; (b) resolve MCP tools from the pack's allow-list.
- Adapters are **optional install extras**: `pip install agi-sdk[langgraph]`, `pip install agi-sdk[pydantic-ai]`.
- Plain async stays the default in docs, starter packs, and the getting-started guide.

### Why this beats the alternatives for *this project*

1. **Multi-tenant via packs.** Orchestrator choice is per-pack, not global. A pack author across any vertical picks what fits.
2. **Embeddable library.** SDK does not impose LC types on importers — LangGraph stays optional, not transitive.
3. **OpenLLMetry-instrumented.** Both LangGraph and Pydantic-AI are auto-instrumented, so the trace contract holds.
4. **MCP-only tools.** Existing adapters handle both paths; nothing to invent.
5. **Retrofit-don't-greenfield.** Care-intelligence already uses LangGraph — retrofit doesn't fight the existing platform layer.
6. **Framework-gravity discipline.** Two blessed options + plain async default makes "library-first" credible. One blessed option would silently become The Way.

---

## Watch-conditions — when this flips

These are the triggers that re-open the question. The tech lead reviews them quarterly.

### W-01 — LangChain Inc. tightens the commercial moat

**Signal:** Checkpointing primitives, HITL semantics, or durability features move from `langgraph` (MIT) to `langgraph-api` or `langgraph-platform` (Elastic License 2.0). Recent `langgraph-api` release notes hint about features going into the commercial product.

**Action:** Demote `langgraph` from "blessed" to "supported"; promote `pydantic_ai` or `strands` to second blessed slot. Document the migration path.

### W-02 — Use-case set narrows to durable-workflow pattern

**Signal:** ≥ 80% of community packs end up being long-running workflows with retries, HITL, and durable state.

**Action:** Evaluate a workflow engine outside the LLM-framework world — Temporal, Inngest, Hatchet. Plain async stays at the LLM call sites; durability externalises to the workflow engine.

### W-03 — Use-case set stays request-scoped

**Signal:** ≥ 80% of community packs are single-turn or simple multi-turn loops with no HITL/checkpointing need.

**Action:** Drop `langgraph` blessed status; plain async + `pydantic_ai` is enough.

### W-04 — A clearly-superior third option appears

**Signal:** A new orchestrator (or a major version of an existing one) becomes credible on all six constraints simultaneously — library, multi-tenant, MCP-native, OTel-clean, retrofit-friendly, ecosystem-stable.

**Action:** Run this brief's structure against the new option. Bless if it wins on at least three criteria the current pair loses.

---

## How this lands in the codebase

| Artefact | Phase | Where |
|---|---|---|
| `packages/agi-sdk/agi/orchestrators/__init__.py` | P1.5 | Empty re-exporter; gracefully no-ops if extras not installed |
| `packages/agi-sdk/agi/orchestrators/langgraph.py` | P1.5 | ~150-LOC adapter; sets OTel baggage, resolves MCP tools |
| `packages/agi-sdk/agi/orchestrators/pydantic_ai.py` | P1.5 | Same shape, type-first |
| `pyproject.toml` extras | P1.5 | `agi-sdk[langgraph]` and `agi-sdk[pydantic-ai]` |
| Starter pack default | P1, P5 | Plain `async def` use case in `packs/blank/` |
| Decision tree doc | P5 | `docs/orchestration-choice.md` — one-pager + figure (lives in `DESIGN.html § 7`) |
| Watch-condition review | Quarterly | Tech-lead checklist in the runbook |

---

## Examples — orchestrator choice by use-case shape

These cover multiple verticals to confirm the choice is genuinely vertical-agnostic.

| Use case | Vertical | Shape | Pick |
|---|---|---|---|
| Bill explainer | Any (telco, energy, broadband) | Single-turn, KB lookup + render | **Plain async** |
| Refund agent | Retail, telco, fintech | Multi-step with side-effect approval | **LangGraph** (HITL primitive) |
| Loan triage | Banking | Type-heavy state, no HITL | **Pydantic-AI** |
| Fleet meter-read explainer | Logistics | Single-turn, RAG | **Plain async** |
| Insurance claim resolver | Insurance | Long-running with retries, durable state | **LangGraph** (checkpointing) |
| Patient pre-triage | Healthcare | Multi-turn, type-strict | **Pydantic-AI** |
| Returns assistant | Retail | Simple tool loop | **Plain async** |
| Tier-2 escalation | Any care vertical | Conditional branching with handoff | **LangGraph** (subgraphs) |
| Tutor session | Education | Type-strict, no durability | **Pydantic-AI** |
| Outage explainer | Energy / utilities | Single-turn, KB lookup | **Plain async** |

The pattern: choose by **use-case shape**, never by vertical. Same shape → same orchestrator across industries.

---

## Sources (verified May 2026)

- LangGraph 1.0 GA announcement · LangGraph releases 1.3.2
- LangGraph MIT vs Elastic-License analysis
- LangGraph release policy
- LangGraph criticism / lock-in discussion
- `langchain-mcp-adapters` (official multi-server MCP client)
- LlamaIndex Workflows 1.0
- CrewAI GitHub (MIT, 1.10)
- Microsoft AutoGen in maintenance / Microsoft Agent Framework successor
- Pydantic AI v1 stable
- Apache Burr (DAGWorks)
- DSPy framework
- Strands Agents 1.0 GA (Apache-2.0)
- OpenAI Agents SDK (MIT)
- smolagents (Hugging Face)
- OpenLLMetry (Apache-2.0, Traceloop)
- Langfuse + OpenLLMetry integration

---

## Where this research is reflected

| Document | Section |
|---|---|
| `RESOLVED_STACK.md` | Decision R8 |
| `PLAN.html` | § 5 Orchestration |
| `DESIGN.html` | Figure 7 — Orchestration choice tree |
| `EXECUTION_PLAN.html` | Phase 1.5 (Wk 3) |
| `DEBATE.md` | Final § (this brief's original home) |
| Codebase | `packages/agi-sdk/agi/orchestrators/` |
