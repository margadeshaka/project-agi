# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.orchestrators.native`` — built-in agent loop.

This is the *third* orchestrator option, alongside the blessed-but-optional
``langgraph`` and ``pydantic_ai`` adapters. It is owned in-tree and depends
only on what ``agi-sdk`` already imports (LiteLLM, the official MCP SDK,
Pydantic, OpenTelemetry). No LangChain types, no external orchestration
framework, no Elastic-licensed runtime to worry about.

Positioning
-----------
- **Plain ``async def``** — single-turn or trivial multi-step.
- **``agi.orchestrators.native``** ← *this module* — multi-step tool loops
  with pluggable checkpointing and HITL ``pause``/``resume``, *without* taking
  a LangGraph or Pydantic-AI dependency.
- **``agi.orchestrators.langgraph``** — durable graph state machines, full
  checkpointing/subgraph machinery, large ecosystem.
- **``agi.orchestrators.pydantic_ai``** — type-first agent loop with native
  Pydantic state.

Why a built-in option
---------------------
The orchestrator research (``ORCHESTRATOR_RESEARCH.html`` § 4) priced an
in-house build at ~600–1200 LOC and recommended *against* it because two
blessed externals were sufficient. The native orchestrator lands when:

- The user explicitly wants an Apache-2.0, MIT-only-deps path with zero
  external orchestration framework.
- A pack needs multi-step tool loops but doesn't want LC message types or
  Pydantic-AI's typing tax.
- Watch-condition **W-01** fires (LangGraph commercial moat tightens) — this
  module is the fallback that doesn't require a port to a different
  framework.

Design
------
- ``Run`` — Pydantic model holding ``state``, ``messages``, ``pack_slug``,
  ``correlation_id``, ``step``, ``status``.
- ``Orchestrator`` — async ``step()`` (one model call + optional tool
  dispatch), ``run_until_done()`` (loop until ``completed``/``paused``/budget),
  ``pause(reason)`` and ``resume(run_id)``.
- ``CheckpointStore`` Protocol — pluggable; ``MemoryCheckpointStore`` and
  ``FileJsonlCheckpointStore`` built-in; Mongo/Postgres stubbed for parity
  with :mod:`agi.trail`.
- Streaming via ``Orchestrator.stream()`` forwarding LiteLLM's async generator
  with OTel span enrichment.
- OTel baggage (``bm.pack``, ``bm.use_case``, ``bm.tenant_id``,
  ``bm.run_id``) is set on every step via :func:`set_run_baggage`.
- Tool allow-list resolved per pack via :func:`resolve_tools` — same shape as
  the langgraph and pydantic_ai adapters.

Use-case authors interact via the high-level helper :func:`run_use_case`
which wires the SDK's ``ModelBinding`` + ``MCPClientsAPI`` + ``Pack`` into a
``Run`` and drives it.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, Protocol

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from agi.config import Pack
    from agi.mcp import MCPClientsAPI
    from agi.models import ModelBinding
    from agi.trail import TrailSink

RunStatus = Literal["running", "paused", "completed", "failed"]
"""Lifecycle states a ``Run`` can be in."""


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class OrchestratorError(RuntimeError):
    """Base class for native-orchestrator errors."""


class StepBudgetExceededError(OrchestratorError):
    """``run_until_done`` hit ``max_steps`` without completing or pausing."""


class CheckpointNotFoundError(OrchestratorError):
    """``resume(run_id)`` could not locate a checkpoint."""


class ToolNotAllowedError(OrchestratorError):
    """The model asked for a tool not in the pack's allow-list."""


# ---------------------------------------------------------------------------
# Messages, tool calls
# ---------------------------------------------------------------------------


class Message(BaseModel):
    """One turn in the agent conversation, OpenAI-compatible shape."""

    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = None
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None
    name: str | None = None


class ToolCall(BaseModel):
    """Model-emitted tool call."""

    id: str
    name: str
    arguments: dict[str, Any]


Message.model_rebuild()


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------


class Run(BaseModel):
    """The unit of state the orchestrator drives.

    Always reconstructable from a checkpoint — no in-memory-only fields.
    """

    run_id: str = Field(default_factory=lambda: f"run-{uuid.uuid4().hex[:12]}")
    correlation_id: str
    pack_slug: str
    use_case_slug: str
    use_case_version: str
    tenant_id: str | None = None
    session_id: str | None = None

    status: RunStatus = "running"
    pause_reason: str | None = None

    step: int = 0
    max_steps: int = 50
    tool_calls_made: int = 0
    """Total tool dispatches this run has made (incremented per call, not per step)."""

    max_tool_calls: int | None = None
    """Optional cap on tool dispatches. Once reached, subsequent model calls
    are made with ``tool_choice="none"`` to force the model to compose a text
    reply from the already-collected tool results.

    Discovered during the Phase 6 Deflect retrofit: small open-weights models
    (llama3.2:3B and similar) loop on the same tool indefinitely unless the
    orchestrator removes the option to call one. Set this to the expected
    tool budget for the scenario (e.g. 1 for single-shot KB lookup) to
    bound the loop deterministically. ``None`` means no cap (default)."""

    messages: list[Message] = Field(default_factory=list)
    state: dict[str, Any] = Field(default_factory=dict)
    """Free-form per-use-case state. Kept dict-shaped for checkpoint portability."""

    result: dict[str, Any] | None = None
    error: str | None = None

    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Checkpoint store
# ---------------------------------------------------------------------------


class CheckpointStore(Protocol):
    """Persist :class:`Run` snapshots for resume."""

    async def save(self, run: Run) -> None: ...
    async def load(self, run_id: str) -> Run | None: ...
    async def delete(self, run_id: str) -> None: ...


class MemoryCheckpointStore:
    """In-memory store. Tests, dev, and single-pod use only."""

    def __init__(self) -> None:
        self._runs: dict[str, Run] = {}

    async def save(self, run: Run) -> None:
        self._runs[run.run_id] = run.model_copy(deep=True)

    async def load(self, run_id: str) -> Run | None:
        return self._runs.get(run_id)

    async def delete(self, run_id: str) -> None:
        self._runs.pop(run_id, None)


class FileJsonlCheckpointStore:
    """Append-only JSON-Lines on disk. One file per run, last line wins on load."""

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, run_id: str) -> Path:
        return self._root / f"{run_id}.jsonl"

    async def save(self, run: Run) -> None:
        line = run.model_dump_json()
        with self._path(run.run_id).open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    async def load(self, run_id: str) -> Run | None:
        p = self._path(run_id)
        if not p.exists():
            return None
        last: str | None = None
        with p.open("r", encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    last = line
        if last is None:
            return None
        return Run.model_validate_json(last)

    async def delete(self, run_id: str) -> None:
        p = self._path(run_id)
        if p.exists():
            p.unlink()


class MongoCheckpointStore:
    """Mongo-backed store. Stubbed; wired in Phase 3 with ``motor``."""

    def __init__(self, *, uri: str, collection: str = "agi_runs") -> None:
        self._uri = uri
        self._collection = collection

    async def save(self, run: Run) -> None:
        raise NotImplementedError("TODO: implement with motor in Phase 3.")

    async def load(self, run_id: str) -> Run | None:
        raise NotImplementedError("TODO: implement with motor in Phase 3.")

    async def delete(self, run_id: str) -> None:
        raise NotImplementedError("TODO: implement with motor in Phase 3.")


class PostgresCheckpointStore:
    """Postgres-backed store. Stubbed; wired in Phase 3 with ``asyncpg``."""

    def __init__(self, *, dsn: str, table: str = "agi_runs") -> None:
        self._dsn = dsn
        self._table = table

    async def save(self, run: Run) -> None:
        raise NotImplementedError("TODO: implement with asyncpg in Phase 3.")

    async def load(self, run_id: str) -> Run | None:
        raise NotImplementedError("TODO: implement with asyncpg in Phase 3.")

    async def delete(self, run_id: str) -> None:
        raise NotImplementedError("TODO: implement with asyncpg in Phase 3.")


# ---------------------------------------------------------------------------
# OTel baggage + tool allow-list — same surface as the other adapters
# ---------------------------------------------------------------------------


def set_run_baggage(run: Run) -> dict[str, str]:
    """Return baggage dict to overlay on the active span.

    Mirrors the shape used by :mod:`agi.orchestrators.langgraph` and
    :mod:`agi.orchestrators.pydantic_ai`. The :mod:`agi.serve` middleware sets
    these once per request; this helper is for inner-loop spans.
    """
    return {
        "bm.pack": run.pack_slug,
        "bm.use_case": run.use_case_slug,
        "bm.use_case.version": run.use_case_version,
        "bm.run_id": run.run_id,
        "bm.tenant_id": run.tenant_id or "",
    }


def resolve_tools(pack: Pack, available: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filter ``available`` (OpenAI tool-schema dicts) to the pack's allow-list.

    Each ``available`` item must carry a ``function.name`` string. Items whose
    ``function.name`` is in ``pack.tool_denylist`` are dropped; items not in
    ``pack.tool_allowlist`` (when that list is non-empty) are also dropped.
    Empty ``tool_allowlist`` means everything is allowed by default — pack
    manifests that want to be strict should always list explicit names.
    """
    allow = set(pack.tool_allowlist or [])
    deny = set(pack.tool_denylist or [])
    out: list[dict[str, Any]] = []
    for tool in available:
        name = tool.get("function", {}).get("name")
        if not isinstance(name, str):
            continue
        if name in deny:
            continue
        if allow and name not in allow:
            continue
        out.append(tool)
    return out


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


@dataclass
class Orchestrator:
    """Drive a :class:`Run` through model calls and tool dispatch.

    Construct one per use-case service. ``step()`` advances by one model call
    (and any tool calls it triggered); ``run_until_done()`` loops until the
    run reaches a terminal status or hits ``max_steps``.

    Parameters
    ----------
    binding:
        Resolved :class:`agi.models.ModelBinding` for this run's reasoning role.
    mcp:
        The pack-scoped :class:`agi.mcp.MCPClientsAPI`. Tool calls are
        dispatched here.
    pack:
        Active :class:`agi.config.Pack`. Used for tool allow-list resolution
        and prompt assembly.
    checkpoint_store:
        Where to persist :class:`Run` snapshots. Defaults to
        :class:`MemoryCheckpointStore`.
    trail_sink:
        Optional :class:`agi.trail.TrailSink`. When provided, every step
        writes an audit event.
    """

    binding: ModelBinding
    mcp: MCPClientsAPI
    pack: Pack
    checkpoint_store: CheckpointStore = field(default_factory=MemoryCheckpointStore)
    trail_sink: TrailSink | None = None
    available_tools: list[dict[str, Any]] = field(default_factory=list)
    """OpenAI tool-schema dicts the orchestrator will offer (post-allowlist).

    Construct via :meth:`set_available_tools` or pass on creation. The pack's
    ``tools.allow`` further filters this list.
    """

    def set_available_tools(self, tools: Iterable[dict[str, Any]]) -> None:
        """Replace the candidate tool set. Allow-listing happens at use time."""
        self.available_tools = list(tools)

    # -------------------- core loop --------------------

    async def step(self, run: Run) -> Run:
        """Advance one step. Mutates and returns the run, persists a checkpoint.

        One step = (a) one ``litellm.acompletion`` call, (b) zero-or-more tool
        dispatches for any returned ``tool_calls``, (c) state/message updates,
        (d) checkpoint save, (e) optional trail event.
        """
        if run.status != "running":
            return run

        run.step += 1
        run.touch()

        # (a) Call the model.
        from litellm import acompletion  # type: ignore[import-not-found]

        tools = resolve_tools(self.pack, self.available_tools)

        # Tool-call budget: once the run has exhausted its quota, withhold
        # tools entirely so the model is forced to compose a text reply
        # from the already-collected tool results. We deliberately don't pass
        # ``tool_choice="none"`` — Ollama-via-LiteLLM rejects that parameter
        # (LiteLLM UnsupportedParamsError), and dropping the tools list
        # achieves the same outcome portably across providers.
        budget_exhausted = (
            run.max_tool_calls is not None and run.tool_calls_made >= run.max_tool_calls
        )
        tools_to_offer = None if budget_exhausted else (tools or None)

        completion_kwargs = self.binding.kwargs(
            messages=[_to_wire_message(m) for m in run.messages],
            tools=tools_to_offer,
        )
        response = await acompletion(**completion_kwargs)
        msg = _extract_assistant_message(response)
        run.messages.append(msg)
        await self._trail(run, "llm.call", {"model": self.binding.model_id, "step": run.step})

        # (b) Dispatch any tool calls.
        if msg.tool_calls:
            for tc in msg.tool_calls:
                if tools and not any(t["function"]["name"] == tc.name for t in tools):
                    raise ToolNotAllowedError(
                        f"model called tool {tc.name!r} which is not allow-listed for pack "
                        f"{run.pack_slug!r}"
                    )
                tool_result = await self.mcp.tool(tc.name).call(**tc.arguments)
                run.tool_calls_made += 1
                run.messages.append(
                    Message(
                        role="tool",
                        tool_call_id=tc.id,
                        name=tc.name,
                        content=json.dumps(tool_result, default=str),
                    )
                )
                await self._trail(
                    run, "mcp.tool", {"tool": tc.name, "step": run.step, "tool_call_id": tc.id}
                )

        # (c) Termination — no tool calls + assistant content → completed.
        if not msg.tool_calls and msg.content is not None:
            run.status = "completed"
            run.result = {"reply": msg.content}

        # (d) Step budget guard (signalling only — caller decides to raise).
        if run.step >= run.max_steps and run.status == "running":
            run.status = "failed"
            run.error = f"step budget exceeded ({run.max_steps})"

        # (e) Persist.
        await self.checkpoint_store.save(run)
        return run

    async def run_until_done(self, run: Run) -> Run:
        """Loop ``step()`` until the run reaches a terminal status.

        Raises :class:`StepBudgetExceededError` if ``run.max_steps`` is hit
        with status still ``running`` (which can only happen if a custom
        ``step`` keeps the status moving — the default never does).
        """
        while run.status == "running" and run.step < run.max_steps:
            run = await self.step(run)
        if run.status == "running":
            raise StepBudgetExceededError(
                f"run {run.run_id} hit max_steps={run.max_steps} without completing"
            )
        return run

    # -------------------- HITL --------------------

    async def pause(self, run: Run, reason: str) -> Run:
        """Mark the run paused with a human-readable reason and persist."""
        run.status = "paused"
        run.pause_reason = reason
        run.touch()
        await self.checkpoint_store.save(run)
        await self._trail(run, "run.pause", {"reason": reason})
        return run

    async def resume(self, run_id: str) -> Run:
        """Reload a paused run, set status back to ``running``, persist."""
        run = await self.checkpoint_store.load(run_id)
        if run is None:
            raise CheckpointNotFoundError(f"no checkpoint for run_id={run_id!r}")
        if run.status != "paused":
            raise OrchestratorError(f"can only resume paused runs; run {run_id} is {run.status!r}")
        run.status = "running"
        run.pause_reason = None
        run.touch()
        await self.checkpoint_store.save(run)
        await self._trail(run, "run.resume", {})
        return run

    # -------------------- streaming --------------------

    async def stream(self, run: Run) -> AsyncIterator[dict[str, Any]]:
        """Yield LiteLLM streaming chunks for the next assistant turn.

        Unlike :meth:`step`, this does *not* dispatch tool calls — streaming
        is for live UX on plain-text turns. Mixed streaming + tool dispatch is
        a Phase 3 enhancement.

        Each yielded dict has ``{"delta": str, "finish_reason": str | None}``.
        """
        from litellm import acompletion  # type: ignore[import-not-found]

        completion_kwargs = self.binding.kwargs(
            messages=[_to_wire_message(m) for m in run.messages],
            stream=True,
        )
        accumulated = ""
        async for chunk in await acompletion(**completion_kwargs):
            choices = getattr(chunk, "choices", None) or chunk.get("choices", [])  # type: ignore[union-attr]
            if not choices:
                continue
            choice0 = choices[0]
            delta = getattr(choice0, "delta", None) or choice0.get("delta", {})
            content = getattr(delta, "content", None) or delta.get("content")
            finish = getattr(choice0, "finish_reason", None) or choice0.get("finish_reason")
            if content:
                accumulated += content
                yield {"delta": content, "finish_reason": finish}
            elif finish:
                yield {"delta": "", "finish_reason": finish}

        run.messages.append(Message(role="assistant", content=accumulated))
        run.status = "completed"
        run.result = {"reply": accumulated}
        run.touch()
        await self.checkpoint_store.save(run)
        await self._trail(run, "llm.call", {"model": self.binding.model_id, "stream": True})

    # -------------------- internals --------------------

    async def _trail(self, run: Run, event_type: str, payload: dict[str, Any]) -> None:
        if self.trail_sink is None:
            return
        from agi.trail import new_event

        event = new_event(
            correlation_id=run.correlation_id,
            pack_slug=run.pack_slug,
            session_id=run.session_id or "",
            event_type=event_type,
            payload=payload,
        )
        await self.trail_sink.write(event)


# ---------------------------------------------------------------------------
# High-level helper
# ---------------------------------------------------------------------------


async def run_use_case(
    *,
    binding: ModelBinding,
    mcp: MCPClientsAPI,
    pack: Pack,
    use_case_slug: str,
    use_case_version: str,
    correlation_id: str,
    tenant_id: str | None,
    session_id: str | None,
    user_message: str,
    system_prompt: str | None = None,
    available_tools: Iterable[dict[str, Any]] | None = None,
    checkpoint_store: CheckpointStore | None = None,
    trail_sink: TrailSink | None = None,
    max_steps: int = 50,
    max_tool_calls: int | None = None,
) -> Run:
    """End-to-end convenience: build a Run, drive it to completion, return it.

    The typical 20-line use case calls this directly instead of constructing
    the :class:`Orchestrator` by hand.
    """
    orch = Orchestrator(
        binding=binding,
        mcp=mcp,
        pack=pack,
        checkpoint_store=checkpoint_store or MemoryCheckpointStore(),
        trail_sink=trail_sink,
        available_tools=list(available_tools or []),
    )
    msgs: list[Message] = []
    if system_prompt:
        msgs.append(Message(role="system", content=system_prompt))
    msgs.append(Message(role="user", content=user_message))
    run = Run(
        correlation_id=correlation_id,
        pack_slug=pack.slug,
        use_case_slug=use_case_slug,
        use_case_version=use_case_version,
        tenant_id=tenant_id,
        session_id=session_id,
        messages=msgs,
        max_steps=max_steps,
        max_tool_calls=max_tool_calls,
    )
    return await orch.run_until_done(run)


# ---------------------------------------------------------------------------
# LiteLLM response → Message conversion
# ---------------------------------------------------------------------------


def _to_wire_message(msg: Message) -> dict[str, Any]:
    """Serialise a :class:`Message` into the OpenAI/LiteLLM wire shape.

    Two differences vs. ``msg.model_dump(exclude_none=True)``:

    1. ``tool_calls`` items are emitted as the OpenAI nested form
       ``{"id", "type": "function", "function": {"name", "arguments"}}``,
       not our internal flat ``{"id", "name", "arguments"}``. LiteLLM's
       provider transformers (notably the Ollama prompt template at
       ``litellm/litellm_core_utils/prompt_templates/factory.py``) read
       the nested form and ``KeyError`` on the flat one.
    2. ``arguments`` is encoded as a JSON string to match OpenAI's format —
       LiteLLM accepts a dict in some places, but the safer wire-shape is
       the string the spec calls for.

    Discovered during the Phase 6 retrofit when the multi-turn Deflect
    scenario crashed mid-step on the rebuild of message history.
    """
    out: dict[str, Any] = {"role": msg.role}
    if msg.content is not None:
        out["content"] = msg.content
    if msg.name is not None:
        out["name"] = msg.name
    if msg.tool_call_id is not None:
        out["tool_call_id"] = msg.tool_call_id
    if msg.tool_calls:
        out["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.name,
                    "arguments": (
                        tc.arguments
                        if isinstance(tc.arguments, str)
                        else json.dumps(tc.arguments)
                    ),
                },
            }
            for tc in msg.tool_calls
        ]
    return out


def _extract_assistant_message(response: Any) -> Message:
    """Pull the assistant message out of a LiteLLM ``acompletion`` response.

    LiteLLM normalises across providers but the response object may be a
    Pydantic-ish model or a dict depending on the provider; access defensively.
    """
    choices = getattr(response, "choices", None) or response.get("choices", [])
    if not choices:
        return Message(role="assistant", content="")
    choice0 = choices[0]
    message = getattr(choice0, "message", None) or choice0.get("message", {})

    content = getattr(message, "content", None) or message.get("content")
    raw_tool_calls = getattr(message, "tool_calls", None) or message.get("tool_calls") or []

    tool_calls: list[ToolCall] = []
    for tc in raw_tool_calls:
        tc_id = getattr(tc, "id", None) or tc.get("id") or f"tc-{uuid.uuid4().hex[:8]}"
        fn = getattr(tc, "function", None) or tc.get("function", {})
        name = getattr(fn, "name", None) or fn.get("name") or ""
        args_raw = getattr(fn, "arguments", None) or fn.get("arguments") or "{}"
        args: dict[str, Any] = args_raw if isinstance(args_raw, dict) else json.loads(args_raw)
        tool_calls.append(ToolCall(id=tc_id, name=name, arguments=args))

    return Message(
        role="assistant",
        content=content,
        tool_calls=tool_calls or None,
    )


__all__ = [
    "CheckpointNotFoundError",
    "CheckpointStore",
    "FileJsonlCheckpointStore",
    "MemoryCheckpointStore",
    "Message",
    "MongoCheckpointStore",
    "Orchestrator",
    "OrchestratorError",
    "PostgresCheckpointStore",
    "Run",
    "RunStatus",
    "StepBudgetExceededError",
    "ToolCall",
    "ToolNotAllowedError",
    "resolve_tools",
    "run_use_case",
    "set_run_baggage",
]
