# ADR-0001 · Phase 6 Deflect retrofit findings

**Date:** 2026-05-23
**Status:** Accepted
**Scope:** `agi.orchestrators.native`
**Related:** `ORCHESTRATOR_RESEARCH.md` § decision R8/R8.1, `EXECUTION_PLAN.html` § Phase 6

## Context

Track C of the "what's next" plan: port the care-intelligence **Deflect**
scenario (`deflect-esim-install.scenario.json`) onto `agi-sdk` to validate the
SDK shape against a real solution module. The original 14-week plan put this
in week 12 for a specific reason — the *retrofit, don't greenfield* discipline
says we keep the SDK honest by porting an existing consumer rather than
guessing at the right API in isolation.

The Deflect scenario is the simplest of the three care-intelligence
scenarios: customer asks a KB-able question ("how do I install my eSIM on
iPhone 15?"), the agent calls one tool (`search_knowledge_base`), the tool
returns the matching article, the agent composes a personalised reply and
the conversation closes — no ticket, no human.

A faithful port lives at `.smoke/sdk_deflect_smoke.py`. It loads a sample
telco-operator KB seed (used as an early reference implementation), drives
`run_use_case(...)` against the native orchestrator, and verifies the
scenario's `expected_tool_sequence` and `expected_response_phrases` against
the live llama3.2 reply.

**Outcome: 6/6 scenario assertions pass.** Getting there surfaced three SDK
gaps, fixed during the retrofit. They are documented below.

## Finding 1 — Tool-call wire shape mismatch with LiteLLM

### Symptom

The first run crashed mid-step-2 with `KeyError: 'function'` raised inside
`litellm/litellm_core_utils/prompt_templates/factory.py::ollama_pt`. Step 1
returned an assistant message with a tool call; step 2's prompt rebuild died
inside LiteLLM's Ollama prompt template.

### Cause

`agi.orchestrators.native.ToolCall` modelled the wire shape as flat:
`{id, name, arguments}`. LiteLLM (and OpenAI's API) expects the **nested**
form: `{id, type: "function", function: {name, arguments}}` with
`arguments` JSON-stringified.

`Orchestrator.step()` rebuilt the message history with
`m.model_dump(exclude_none=True)`, which emitted the flat shape verbatim.
Step 1 worked because the message had no tool_calls; step 2 included the
tool_call from step 1, which LiteLLM couldn't parse.

### Fix

Added `_to_wire_message(msg)` in `agi/orchestrators/native.py`. Translates
the internal `Message` into the OpenAI/LiteLLM-compatible dict at the
acompletion-call boundary, emitting `tool_calls` items in the nested form
and JSON-encoding `arguments`. Internal shape stays flat (cleaner to read,
cleaner to checkpoint).

### Test coverage

The existing tests pass because they were against the orchestrator's
internal shape, not the wire path. A future test should round-trip a
multi-turn tool-call run through `_to_wire_message` to lock the contract.

## Finding 2 — Small models loop on the same tool indefinitely

### Symptom

After fix #1, the run no longer crashed but **never completed**: llama3.2
called `search_knowledge_base` six times in a row with identical arguments
across six steps. Message tree:
`[system, user, assistant, tool, assistant, tool, assistant, tool, ...]`.
Hit `max_steps` and reported `status="failed"`.

### Cause

Tool-using small open-weights models (llama3.2:3B-Q4_K_M tested here, but
the pattern is documented for similar-class models) do not reliably switch
from "call tool" to "compose answer from tool result" after a single
round-trip. Tightening the system prompt to "call ONCE then reply" caused a
second, related failure (finding 3 below).

### Fix

Added `Run.max_tool_calls: int | None` and `Run.tool_calls_made: int`. In
`Orchestrator.step()`, when the budget is exhausted the orchestrator
withholds the `tools` list from the next `acompletion` call entirely — the
model has no syntactic way to emit a tool call and must reply with text.

`run_use_case()` now exposes the corresponding `max_tool_calls` kwarg, and
the Deflect smoke sets `max_tool_calls=1` to match the scenario's expected
sequence.

### Why this isn't a "small model problem" we shrug off

Even with strong frontier models, real production scenarios cap tool budgets
to bound cost and protect against runaway loops. The orchestrator should
own this; expecting every use-case author to police it via prompt engineering
is the kind of leakage that makes a framework brittle.

## Finding 3 — `tool_choice="none"` is not portable across providers

### Symptom

Initial fix-2 attempt set `tool_choice="none"` on the budget-exhausted call.
LiteLLM rejected it with `UnsupportedParamsError: ollama does not support
parameters: ['tool_choice']`.

### Cause

`tool_choice` is an OpenAI-API-shaped parameter. Some providers accept it,
some don't. Ollama via LiteLLM is in the latter group. Other providers
(Anthropic direct, some Bedrock paths) translate the parameter; Ollama
errors.

### Fix

The budget-exhausted branch in `Orchestrator.step()` simply withholds
`tools` rather than asking for `tool_choice="none"`. Same effective outcome
across every provider LiteLLM supports — if the model isn't offered a tool
schema, it can't emit a tool call.

## Finding 4 — Models invent tools when told not to call the real one

### Symptom

Halfway through investigating finding 2, I tried a tighter prompt: "after
calling the tool once, do NOT call it again." llama3.2 invented a new tool
called `respond_to_user` (not in the pack allow-list) and the orchestrator
correctly raised `ToolNotAllowedError`.

### Verdict — not a bug

This one is *worth flagging but not fixing in the orchestrator*. The
existing allow-list enforcement caught the hallucination cleanly. The
right fix is the budget mechanism from finding 2 (don't offer tools at all);
prompt-engineering against tool-use is fragile and shouldn't be the
primary defence.

That said — the allow-list enforcement working correctly here is a real
signal that the pack-level `tool_allowlist` is doing its job. Worth keeping
the test pattern in the regression suite.

## Decisions

| # | Decision |
|---|---|
| D-1 | `agi.orchestrators.native.Message` keeps its flat internal shape. Wire shape is translated at the boundary via `_to_wire_message`. |
| D-2 | `Run` gains `max_tool_calls` (optional cap) + `tool_calls_made` (running count). |
| D-3 | `run_use_case(max_tool_calls=...)` is the public API surface. Default `None` = no cap, preserving existing behavior. |
| D-4 | When budget exhausted, withhold `tools` from next acompletion. Do NOT use `tool_choice="none"` (not portable). |
| D-5 | Pack-level `tool_allowlist` is the safety net against hallucinated tool names. Already works; no change needed. |

## Files changed

- `packages/agi-sdk/agi/orchestrators/native.py`
  - Added `_to_wire_message(msg)` helper (D-1)
  - Replaced both `model_dump(exclude_none=True)` call sites with `_to_wire_message`
  - Added `Run.max_tool_calls` + `Run.tool_calls_made` fields (D-2)
  - Step loop: skip tools when budget exhausted (D-4)
  - `run_use_case(..., max_tool_calls=None)` kwarg passthrough (D-3)
- `.smoke/sdk_deflect_smoke.py` — the retrofit driver itself

## What this validates about the SDK shape

| SDK concern | Verdict |
|---|---|
| Multi-step tool loop semantics | ✓ correct after wire-shape fix |
| Pack tool_allowlist enforcement | ✓ caught hallucinated tool name |
| `run_use_case` ergonomics | ✓ ~30 lines of consumer code for a real scenario |
| Trail event capture | ✓ `llm.call` + `mcp.tool` events per step |
| Checkpoint store roundtrip | ✓ FileJsonl persisted run state |
| OTel baggage shape | (untested in this smoke — Traceloop disabled) |
| MCP transport shape | (untested — used a Python-callable shim, not real MCP) |
| Runtime-layer `/chat` path | (untested for Deflect — runtime's BundleLoader.dispatch is still a stub) |

## What's next

Three follow-ups, ordered by leverage:

1. **Port Deflect through the full runtime path** (currently bypassed). Needs
   a real MCP server for `search_knowledge_base` OR a built-in tool registry
   in `agi-runtime` that maps tool names to runtime-internal callables.
2. **Port the Resolve scenario** (billing refund). Multi-tool, side-effecting.
   The harder test of `max_tool_calls`, allow-list, and the trail's
   `side_effecting=true` annotation.
3. **Add a regression test** under `tests/test_native_orchestrator.py` that
   exercises a multi-turn tool-call run through `_to_wire_message` so
   finding 1 can't regress silently.
