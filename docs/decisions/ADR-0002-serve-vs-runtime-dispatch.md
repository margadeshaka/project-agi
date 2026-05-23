# ADR-0002 — SDK serve() vs runtime dispatch boundary

- Status: Proposed
- Date: 2026-05-23
- Deciders: project-agi maintainers
- Supersedes: —
- Related: RESOLVED_STACK Decision 1, ARCHITECTURE §"Layer 2 — agi-runtime", ADR-0001 (Phase 6 Deflect retrofit findings)

## Context

`agi.serve()` in `packages/agi-sdk/agi/serve.py` is a Phase-1 shell: it builds a FastAPI app with `/healthz`, `/readyz`, `/v1/info`, and a stub `/v1/invoke` (lines 129–138, "TODO: dispatch to use_case.handle() in Phase 1.5"), and `_build_mcp_server` returns a placeholder dict. The phase audit closing P0 asked: when `/v1/invoke` is actually wired, what does it dispatch, and how does it relate to the already-working dispatch in `distribution/agi-runtime/agi_runtime/routes/chat.py`?

`agi-runtime`'s `chat.py` already calls `agi.orchestrators.native.run_use_case(...)` against a request-scoped pack resolved by the claims-validated `XPackDispatchMiddleware`. The Band 2 runtime is — by RESOLVED_STACK Decision 1 — the sole owner of multi-pack dispatch. But the README's flagship Band 1 contract still promises `serve(BillExplainer, http=True, mcp=True)` as a single-import way to expose one use-case as both HTTP and MCP. We need to settle, before any P1 closure code lands, what serve() does and does not own, where the shared seam lives, and how serve() composes with (but never imports) the runtime.

## Decision

`serve()` is a **single-pack, single-use-case process boot**. It exposes the active use-case as HTTP, MCP, or both, drives the SDK's native orchestrator end-to-end, and emits AI-Trail events through the SDK's own sink. It performs **no** pack dispatch, **no** claims validation beyond a pluggable hook, and contains **zero** imports from `agi_runtime.*`.

### What serve() owns

1. **Process lifecycle.** Build a FastAPI app and/or an MCP server bound to one decorated use-case class. Block on `uvicorn.run` (default) or hand back a `ServeHandle` for embedders/tests. Graceful shutdown via `ServeHandle.shutdown()`.
2. **A fixed HTTP route set** (when `http=True`):
   - `GET /healthz`, `GET /readyz` — liveness/readiness, no auth, no pack required.
   - `GET /v1/info` — `{"slug", "version", "exposures": ["http","mcp"]}`.
   - `POST /v1/invoke` — dispatch to the use-case via the shared seam (see below).
   - `POST /v1/invoke/stream` — SSE stream of the same dispatch.
   - `GET /v1/tools` — names + JSON schemas of tools the use-case's pack exposes (via `MCPClientsAPI`).
   - `GET /v1/trail/{correlation_id}` — read-only AI-Trail events, scoped to the in-process trail sink only.
   - `POST /mcp` is **not** mounted by serve(); MCP is a separate transport on its own port/socket, configured by `mcp=True`.
3. **The MCP exposure** (when `mcp=True`). One MCP tool per public method on the decorated class (Phase 3 lands the actual server; Phase 1 closure registers the surface and returns a real server handle, not a placeholder dict).
4. **OTel baggage middleware.** `bm.pack`, `bm.use_case`, `bm.use_case.version`, `bm.tenant_id`, `bm.flavor` — already implemented in `_baggage_middleware`; kept as-is.
5. **A single, header-resolved pack.** serve() reads one pack per process. The pack source is, in priority order: (a) an explicit `pack=` kwarg (a `Pack` object or a path), (b) `AGI_PACK_PATH` env var, (c) the `blank` reference pack. There is no `X-Pack` switching inside serve(); see "What serve() does NOT own."

### What serve() does NOT own

1. **`X-Pack` header dispatch / multi-pack routing.** That is `agi-runtime`'s job and stays in `XPackDispatchMiddleware`. serve() reads `X-Pack` only to overlay baggage and (in non-dev modes) to assert it matches the configured pack; mismatch → 400.
2. **Claims-validated tenancy.** The runtime owns the token verification, three-role RBAC, and tenant-claim consistency. serve()'s auth is a pluggable callable (default `dev-noop`); when serve() is embedded by the runtime, the runtime's middleware runs first and serve()'s hook is a no-op.
3. **Pack hot-reload.** Pack-on-disk changes require a process restart in serve(). Runtime owns `POST /admin/packs/reload`.
4. **Cross-pack admin endpoints** (`/admin/*`, `/kb/*`, `/tools/{name}` invoke, `/mcp` server-of-servers). These belong to `agi-runtime`.

### What runtime owns

The runtime is unchanged by this ADR. It continues to own claims-validated `X-Pack` dispatch, multi-pack routing, the cross-pack admin surface, the long-form `/chat` route, and the production OTel pipeline. **Runtime's `routes/chat.py` is retired in favour of a thin wrapper that delegates to the shared seam** (see Implementation outline) so the dispatch path stops drifting from serve()'s implementation.

### The shared seam

The orchestrator-invocation code already exists at `agi.orchestrators.native.run_use_case(...)`. It is the contract between serve() and runtime. We add **one** new SDK module to host the HTTP/MCP-agnostic plumbing that both call sites need:

**`packages/agi-sdk/agi/dispatch.py`** — Band 1, no transport, no FastAPI types, no runtime imports.

It exports:

- `InvokeRequest` / `InvokeResponse` Pydantic models — the wire shape of `/v1/invoke` and the runtime's `/chat`. Today's `chat.py` `ChatRequest`/`ChatMessage` are subsumed by these.
- `async def invoke_use_case(*, use_case_cls, pack, sdk, request: InvokeRequest, correlation_id, tenant_id, session_id, available_tools, trail_sink) -> InvokeResponse` — the single function both transports call. Internally it builds the use-case instance (or calls `run_use_case` directly for the chat-shaped use-case), drives the orchestrator, and returns a normalized response.
- `async def stream_use_case(...)` — the SSE-yielding equivalent.

`agi.serve` imports `agi.dispatch`. `agi_runtime.routes.chat` imports `agi.dispatch`. Neither imports the other. The band-isolation gate is preserved.

### AI-Trail emission

serve() emits AI-Trail events via the SDK's own `TrailSink` (default `MemoryTrailSink`, configurable to `FileJsonlTrailSink` via `AGI_TRAIL_SINK`/`AGI_TRAIL_PATH` env). The orchestrator already writes `llm.call`, `mcp.tool`, `run.pause`, `run.resume`; serve() adds an `invoke.start` and `invoke.end` envelope event at the HTTP boundary.

When the runtime hosts the same use-case via its own process (band-2 deployment), the runtime's OTel collector overlay produces the regulator-grade AI-Trail per RESOLVED_STACK's "AI-Trail is an audit sink, not a telemetry API" rule. **The two paths do not double-emit:** in runtime-hosted mode, serve() is not in the call stack — the runtime's `/chat` (delegating to `agi.dispatch.invoke_use_case`) is. In SDK-embedded mode, serve()'s in-process sink is the only path; that's by design for the "library-first" promise.

### Authn in serve()

serve() ships a pluggable `auth=` kwarg accepting a callable `(request) -> Claims | None`. Defaults:

- **`dev-noop` (default for SDK-embedded use):** accepts every request, returns synthetic claims with `tenant_id = pack.slug`. Matches `agi-auth`'s `dev-noop` adapter shape.
- **`static-token`:** opt-in via `AGI_SERVE_STATIC_TOKEN` env. Single shared bearer, useful for local Docker.
- **Custom:** any user-supplied callable. Used by power-users who want OIDC without running the full runtime.

serve() never reimplements Keycloak/OIDC adapters; that surface stays in `agi-auth` (Band 2). When serve() is embedded inside the runtime, the runtime's claims middleware has already run and serve()'s auth hook returns the already-attached `request.state.claims`.

## Consequences

**Positive**
- The band-isolation gate stays clean. SDK has zero `agi_runtime.*` imports; runtime depends on `agi.*` (already true).
- Runtime's `routes/chat.py` shrinks to a thin adapter (resolve pack from `request.state`, build `InvokeRequest`, delegate to `agi.dispatch.invoke_use_case`). The orchestrator-driving code lives in one place.
- The README contract `serve(BillExplainer, http=True, mcp=True)` becomes literally true at the end of P1 — no second TODO sweep needed.
- Single-pack embedders never pay the dispatch / claims / multi-pack tax. Library-first stays library-first.
- AI-Trail emission has one rule: the orchestrator writes the events, the transport adds envelopes. No double-emit in any deployment mode.

**Negative / what we give up**
- We add one Band-1 module (`agi/dispatch.py`). The "tiny top-level namespace" property of `agi/__init__.py` is preserved (we don't re-export `dispatch`), but the SDK surface grows by one importable module.
- serve() is **deliberately single-pack**. Embedders running a multi-tenant scenario must use the runtime — there is no shortcut. This is the correct outcome but worth naming.
- The runtime's `routes/chat.py` must be refactored as part of P1 closure (small, but in scope). If we defer the refactor, runtime and serve() drift again — the very problem this ADR is closing.

**Doc consequences**
- README's `serve(...)` example needs no change; this ADR ratifies it.
- `ARCHITECTURE.md` Layer 2 section needs a one-line callout that the runtime's chat dispatch delegates to `agi.dispatch.invoke_use_case` so the seam is documented.

## Alternatives considered

1. **serve() delegates to runtime.** Rejected — would require `agi-sdk` to import `agi_runtime`, violating the band-isolation gate (RESOLVED_STACK Decision 2, mechanics bullet 3).
2. **runtime imports `agi.serve()` and mounts its FastAPI app.** Rejected — `serve()`'s app is bound to a single use-case and a single pack; the runtime is multi-pack by definition. Mounting serve() inside runtime would either limit the runtime to one pack or require gymnastics that re-invent the dispatch problem.
3. **No HTTP in serve(); MCP-only.** Rejected — the README contract and the "embed without the runtime" narrative both depend on HTTP. Removing it would force every embedder to either install the runtime or write their own FastAPI shell.
4. **Put the shared seam in `agi.orchestrators.native`** (i.e., expand `run_use_case`). Rejected — `run_use_case` is the *orchestrator* contract, not the *transport* contract. The InvokeRequest/InvokeResponse models and the trail-envelope emission belong at a higher layer.
5. **Make `/v1/invoke` accept `X-Pack` and re-dispatch.** Rejected — duplicates runtime's dispatch logic in Band 1 and re-introduces the very drift this ADR is closing.

## Open question (deferred to maintainer call before P1 closure merges)

When `auth=dev-noop` is in effect, the synthetic claims default `tenant_id = pack.slug`. That's clean for single-pack mode but means a misconfigured embedder cannot catch a pack/tenant mismatch at boot — there is no mismatch to catch. Should serve() require an explicit `tenant_id=` kwarg when `auth=dev-noop` and the embedder wants pack-slug-doesn't-equal-tenant-id? Documented here; default behaviour locked at `tenant_id = pack.slug` until ruled otherwise.

## Implementation outline

Concrete file changes for P1 closure. Bullets are ordered for low-risk sequencing.

- [ ] Create `packages/agi-sdk/agi/dispatch.py` with `InvokeRequest`, `InvokeResponse`, `invoke_use_case()`, `stream_use_case()`. No FastAPI types, no runtime imports. Use existing `agi.orchestrators.native.run_use_case` internally.
- [ ] In `packages/agi-sdk/agi/serve.py`, replace the `/v1/invoke` stub body (current lines 129–138) with a call to `agi.dispatch.invoke_use_case(...)`, passing a pack resolved via the new `pack=` / `AGI_PACK_PATH` precedence and an auth-hook claims object. Add `POST /v1/invoke/stream`, `GET /v1/tools`, `GET /v1/trail/{correlation_id}` route handlers as thin wrappers over the same seam and the in-process trail sink.
- [ ] In `packages/agi-sdk/agi/serve.py`, replace `_build_mcp_server`'s placeholder dict with a real MCP server returned by the official MCP SDK; register one tool per public method on the decorated class. (If full MCP wiring slips to Phase 3 per current docstring, return a typed `MCPServerHandle` with a clear `status="pending-phase-3"` field — *not* a dict — so the public type signature is stable.)
- [ ] Add `serve(use_case_cls, *, pack: Pack | str | None = None, auth: AuthHook | None = None, ...)` kwargs to the public signature. Default `auth` to `dev-noop`. Document `AGI_PACK_PATH`, `AGI_SERVE_STATIC_TOKEN`, `AGI_TRAIL_SINK` env vars in the module docstring.
- [ ] Refactor `distribution/agi-runtime/agi_runtime/routes/chat.py` to delegate body to `agi.dispatch.invoke_use_case` / `stream_use_case`. Keep request-state plumbing (pack from middleware, correlation_id, session_id, model binding resolution) in the route; remove the inline orchestrator construction. Net delete of the `_stream_chat` helper, kept only as a 3-line wrapper.
- [ ] Update `packages/agi-sdk/agi/__init__.py` — no new top-level re-exports. `agi.dispatch` is importable but not in `__all__`, matching the "small intentional top-level" rule.
- [ ] Add `packages/agi-sdk/tests/test_serve_invoke.py` — exercises serve() in `block=False` mode with a fake `ModelBinding` + memory checkpoint store, asserts `/v1/invoke` returns 200 with the expected `InvokeResponse` shape and writes the expected trail events.
- [ ] Add `packages/agi-sdk/tests/test_dispatch_seam.py` — direct unit test on `agi.dispatch.invoke_use_case` to lock the contract independent of FastAPI.
- [ ] Add `distribution/agi-runtime/tests/test_chat_delegates_to_seam.py` — assert runtime's `/chat` and SDK's `/v1/invoke` produce identical `InvokeResponse` shapes for the same input. This is the regression test that catches future drift.
- [ ] Update `ARCHITECTURE.md` Layer 2 with one-line note: "Runtime's chat dispatch delegates to `agi.dispatch.invoke_use_case`. The orchestrator-driving code lives in agi-sdk; runtime owns only multi-pack dispatch and the cross-pack admin surface."

Out of scope for this ADR / Phase 1 closure (explicitly deferred):
- Real Mongo/Postgres trail sinks (Phase 3).
- Full MCP server implementation with capability discovery (Phase 3).
- Streaming + tool dispatch interleaving (Phase 3, already noted in `agi.orchestrators.native.stream`).
- Pack hot-reload in serve() (will remain restart-only; runtime owns the reload endpoint).
