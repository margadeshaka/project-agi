# ADR-0003 — Runtime-provided identity stubs for generic endpoints

- Status: Accepted
- Date: 2026-05-23
- Deciders: project-agi maintainers
- Supersedes: —
- Related: ADR-0002 (SDK serve() vs runtime dispatch boundary)

## Context

ADR-0002 settled that both `agi.serve()` and the runtime's `POST /chat` delegate to `agi.dispatch.invoke_use_case(use_case_cls=..., ...)`. The seam validates `use_case_cls` carries the `@use_case(slug, version)` stamp and rejects undecorated classes with a clear error. This rejection is correct for SDK embedders — every embedded use-case author writes `@use_case("bill_explainer", "0.3.0")` at the top of their class — but it creates an awkward shape for the runtime's *generic* chat endpoint.

The runtime's `POST /chat` is the catch-all conversational surface for a pack. There is no single Python class that "is" the chat use-case the way `BillExplainer` is. The handler exists to drive the pack's system prompt + tools + KB against arbitrary user input; it is request-time conversational, not author-time codified.

Wave 2B of the P1 closure introduced a workaround at `distribution/agi-runtime/agi_runtime/routes/chat.py`:

```python
@use_case("chat", version="0.0.0")
class _RuntimeChatUseCase:
    """Runtime-provided identity stub for the generic /chat endpoint."""
```

The stub gives `invoke_use_case` a stamped class to validate, and its slug `"chat"` matches the legacy `Run.use_case_slug` the AI-Trail already records. The reviewer accepted the workaround with the condition that this ADR exist before contributors replicate the pattern ad-hoc for other generic endpoints.

## Decision

**Runtime-provided identity stubs are an accepted pattern for runtime endpoints that don't correspond to a user-authored use-case.** They are not a substitute for `@use_case` decoration on real, named SDK use-cases.

### When the pattern applies

A runtime endpoint MAY define a private identity-stub use-case class when ALL of the following hold:

1. The endpoint is a Band-2 (`agi-runtime`) construct — `routes/*.py` or `middleware/*.py`. SDK embedders never need this pattern; they decorate their real class directly.
2. The endpoint is a *generic* conversational/agentic surface: it does not encode application-specific business logic in the Python class body. All behaviour comes from the pack's prompts, tools, KB, and the orchestrator.
3. The endpoint needs to call `agi.dispatch.invoke_use_case` or `stream_use_case`, which today (post-ADR-0002) requires a stamped `@use_case` class.

### Conventions

Runtime stub use-cases MUST follow these conventions so the AI-Trail and the seam's identity contract stay consistent:

1. **Location.** Define the stub in the route file that owns the endpoint (e.g., `routes/chat.py` for `/chat`). Do NOT promote it to a runtime-level module unless multiple routes share the exact same identity.
2. **Name.** Use a leading underscore — `_Runtime<Endpoint>UseCase`. The leading underscore signals it is private to the runtime and never imported by another module.
3. **Slug.** Use the route's bare resource name in snake_case (`"chat"`, `"admin"`, etc.). NOT `runtime.chat`, NOT `agi.runtime.chat`. The bare slug matches the way Band-2 routes are addressed (`/chat`) and the way AI-Trail events have historically recorded the slug.
4. **Version.** `"0.0.0"` until the route's wire contract has its first non-additive change, then bump per semver. The version is read by AI-Trail and the OTel baggage layer; it must be a real semver string.
5. **Body.** The class body MUST be empty save for a one-line docstring. Stubs are identity-only; they do not host orchestrator-driving code. That code lives in the route handler around the `invoke_use_case` call.
6. **No re-export.** Do not add the stub to any package `__all__` or `__init__.py`. It is private to its route file.

### What this is NOT

- **Not a workaround for missing `@use_case` decorations on real use-cases.** If an SDK embedder forgets the decorator, the seam's rejection is the correct behaviour — the embedder must fix the decoration, not introduce a stub.
- **Not a path to multi-pack dispatch in the SDK.** The stub does not change ADR-0002's rule that the SDK takes one pack at a time.
- **Not extensible into AI-Trail tagging.** The stub's slug ("chat") is the use-case slug stored on every event for the request. It is NOT a category tag, NOT a routing key, NOT a hint to the orchestrator. Treat the slug as a real use-case slug whose author happens to be the runtime itself.

## Consequences

**Positive**
- The runtime can call `invoke_use_case` directly without an alternate code path or an `Optional[type]` argument that would re-open the ADR-0002 contract.
- The pattern is small (one decorated empty class per generic endpoint) and reads obviously at the call site.
- AI-Trail events for runtime endpoints carry a real, queryable slug. Audit queries don't need to special-case missing slugs.
- The seam's "every invocation has a decorated identity" invariant stays intact across both SDK and runtime, simplifying future work (e.g., per-use-case rate limits, per-use-case eval harness).

**Negative / what we give up**
- The runtime now defines tiny use-case classes inside route files. The pattern is a little surprising to readers expecting use-cases only in `agi-sdk` consumers. This ADR is the documentation that prevents that surprise from being noise.
- Adding a new generic Band-2 endpoint requires one extra empty class. This is a small but real maintenance cost.
- If future SDK work makes `use_case_cls` optional on `invoke_use_case` (synthesising a sentinel internally), this ADR can be deprecated cleanly — but doing so would re-open ADR-0002 contract wording. Deferred.

## Alternatives considered

1. **Make `invoke_use_case` accept `use_case_cls: type | None`.** Synthesise a sentinel `@use_case("unknown", "0.0.0")` when None. Rejected for now because it changes the ADR-0002 contract and would propagate through `dispatch.py`, `serve.py`, and `routes/chat.py`. The current pattern is a 4-line cost per endpoint; the contract change is wider. Re-evaluate in Phase 3 if the runtime grows several more generic endpoints.
2. **Promote chat to a real SDK use-case** (e.g., `agi_packs.blank.chat:BlankChatUseCase`). Rejected because the runtime's `/chat` is intentionally identity-less — its behaviour is the pack's, not a Python class's. Conflating the two would suggest packs SHOULD ship a Python class for chat, which contradicts the "packs are YAML, not code" rule.
3. **Skip the stamp check in `invoke_use_case` when the caller is Band-2.** Rejected — Band-2 has no privileged path. The seam treats all callers identically.

## Implementation outline (already landed in 7c0ce05)

- [x] `distribution/agi-runtime/agi_runtime/routes/chat.py` defines `_RuntimeChatUseCase` at module scope with slug `"chat"`, version `"0.0.0"`.
- [x] The route handler passes `_RuntimeChatUseCase` as `use_case_cls=` to `invoke_use_case` / `stream_use_case`.
- [x] `test_chat_delegates_to_seam.py` asserts the stub flows through the seam and produces the expected `InvokeResponse`.
- [ ] If a second generic Band-2 endpoint needs the pattern (none currently planned), it follows the conventions above. Reviewer enforcement: any new `routes/*.py` that calls `invoke_use_case` without a `_Runtime<Endpoint>UseCase` stub in the same file is a review-blocker until ADR-0003 is re-opened.
