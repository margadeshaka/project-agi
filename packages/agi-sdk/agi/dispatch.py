# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.dispatch`` — transport-agnostic seam between ``serve()`` and the runtime.

Both ``agi.serve()``'s ``POST /v1/invoke`` and ``agi-runtime``'s ``POST /chat``
must drive the same orchestrator code against the same request/response wire
shape. To stop those two call sites drifting (the problem ADR-0002 closes),
the orchestrator-driving code lives here — in Band 1, with **no FastAPI types
and no imports from any band-2 module**.

What this module exports
------------------------
- :class:`InvokeRequest` / :class:`InvokeResponse` — the wire shape both
  transports accept / return. Subsumes the legacy ``ChatRequest`` /
  ``ChatMessage`` pair in ``agi_runtime.routes.chat``.
- :func:`invoke_use_case` — async helper that takes a decorated use-case
  class, a resolved :class:`agi.config.Pack`, a populated
  :class:`agi.models.ModelBinding`, an available-tools mapping, a
  :class:`agi.trail.TrailSink`, and an :class:`InvokeRequest`, and returns a
  normalised :class:`InvokeResponse`. Emits ``invoke.start`` and ``invoke.end``
  envelope events on either side of the orchestrator's own events.
- :func:`stream_use_case` — async-iterator counterpart. Yields trail events
  as ``dict`` rows then ends with one ``invoke.end`` row carrying the full
  :class:`InvokeResponse` payload. The HTTP layer wraps the dicts into SSE
  frames; this module never touches SSE framing.

Hard rules
----------
- No FastAPI / starlette / pydantic-V1 imports.
- No ``agi_runtime.*`` imports — the band-isolation gate enforces this.
- No native LLM SDK imports (``openai``, ``anthropic``, ``boto3``) — also gated.
- Do **not** redesign :func:`agi.orchestrators.native.run_use_case`. The seam
  adapts to its current signature; if the signature must change, that's an
  ADR / orchestrator-owner conversation, not a dispatch-module concern.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from agi.orchestrators.native import (
    MemoryCheckpointStore,
    Message,
    Orchestrator,
    Run,
)
from agi.trail import MemoryTrailSink, TrailSink, new_event
from agi.use_case import get_use_case_slug, get_use_case_version

if TYPE_CHECKING:
    from agi.config import Pack
    from agi.mcp import MCPClientsAPI
    from agi.models import ModelBinding
    from agi.orchestrators.native import CheckpointStore


# ---------------------------------------------------------------------------
# Wire types
# ---------------------------------------------------------------------------


_Role = Literal["system", "user", "assistant", "tool"]


class InvokeMessage(BaseModel):
    """One turn in the conversation, OpenAI-compatible shape.

    Mirrors :class:`agi.orchestrators.native.Message` but stays distinct so the
    wire schema is stable independent of orchestrator internals.
    """

    model_config = ConfigDict(extra="forbid")

    role: _Role = "user"
    content: str | None = None
    name: str | None = None
    tool_call_id: str | None = None


class InvokeRequest(BaseModel):
    """Request body for ``POST /v1/invoke`` and the runtime's ``POST /chat``.

    Subsumes the legacy ``ChatRequest`` (``messages``, ``stream``, ``max_steps``)
    plus the older ``{"message": "..."}`` shape for back-compat with the
    runtime's dispatch fuzz test. Adds an optional ``model_overrides`` map for
    per-call sampling-param tweaks.
    """

    model_config = ConfigDict(extra="allow")

    messages: list[InvokeMessage] | None = None
    """New shape. Preferred."""

    message: str | None = None
    """Legacy single-string shape — convenience for ``messages=[{"role":"user",...}]``."""

    stream: bool = False
    use_case: str | None = None
    """Optional override for the use-case slug — only honoured when it matches
    the slug stamped on ``use_case_cls`` (no cross-use-case dispatch in serve())."""

    session_id: str | None = None
    correlation_id: str | None = None
    max_steps: int | None = None
    max_tool_calls: int | None = None
    model_overrides: dict[str, Any] = Field(default_factory=dict)

    def to_messages(self) -> list[Message]:
        """Normalise to ``list[agi.orchestrators.native.Message]``.

        Accepts the new structured form or the legacy single-string form. An
        empty result is the caller's signal to short-circuit with a 400.
        """
        if self.messages:
            return [
                Message(
                    role=m.role,
                    content=m.content,
                    name=m.name,
                    tool_call_id=m.tool_call_id,
                )
                for m in self.messages
            ]
        if self.message:
            return [Message(role="user", content=self.message)]
        return []


class InvokeToolCall(BaseModel):
    """One model-emitted tool call surfaced in the response envelope."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class InvokeResponse(BaseModel):
    """Response body for ``POST /v1/invoke`` and the runtime's ``POST /chat``.

    Carries the final assistant reply plus enough metadata for transports to
    return their existing JSON shapes without reaching into the orchestrator.
    """

    model_config = ConfigDict(extra="forbid")

    response: str = ""
    """Last assistant message content. Empty when the run failed without one."""

    pack: str
    use_case: str
    use_case_version: str
    run_id: str
    status: Literal["running", "paused", "completed", "failed"]
    correlation_id: str
    session_id: str | None = None
    tenant_id: str | None = None

    tool_calls: list[InvokeToolCall] = Field(default_factory=list)
    """Distinct tool calls the model emitted across the run, in order."""

    checkpoints: list[str] = Field(default_factory=list)
    """``run_id`` of every checkpoint persisted during the run. Empty when no
    persistent checkpoint store is in play."""

    trail_event_count: int = 0
    """Number of AI-Trail events the in-process sink saw between
    ``invoke.start`` and ``invoke.end`` (inclusive)."""

    error: str | None = None
    """Populated when ``status == "failed"``."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_use_case_identity(use_case_cls: type) -> tuple[str, str]:
    """Pull ``(slug, version)`` off a ``@use_case``-decorated class.

    Raises :class:`TypeError` if the class wasn't decorated. The error is
    deliberately blunt — silently inventing a slug here would mask a wiring
    bug in the caller.
    """
    slug = get_use_case_slug(use_case_cls)
    version = get_use_case_version(use_case_cls)
    if not slug or not version:
        raise TypeError(
            f"{use_case_cls.__name__!r} is not decorated with @agi.use_case(slug, version); "
            "invoke_use_case requires a stamped class so it can set OTel baggage and the "
            "InvokeResponse envelope correctly."
        )
    return slug, version


def _last_user_message(messages: list[Message]) -> str:
    """Last ``role=user`` content in the conversation, or empty string."""
    return next((m.content or "" for m in reversed(messages) if m.role == "user"), "")


def _system_prompt(messages: list[Message]) -> str | None:
    """First ``role=system`` content in the conversation, or ``None``."""
    return next((m.content for m in messages if m.role == "system"), None)


def _redact_request_for_trail(request: InvokeRequest) -> dict[str, Any]:
    """Trail-safe view of the request.

    Strips the message bodies (full conversation lives in the orchestrator's
    own per-step events) and keeps only the envelope metadata operators need
    to correlate runs with HTTP requests.
    """
    msg_count = len(request.messages or []) + (1 if request.message else 0)
    return {
        "stream": request.stream,
        "session_id": request.session_id,
        "correlation_id": request.correlation_id,
        "max_steps": request.max_steps,
        "max_tool_calls": request.max_tool_calls,
        "message_count": msg_count,
        "has_model_overrides": bool(request.model_overrides),
    }


def _extract_tool_calls_from_run(run: Run) -> list[InvokeToolCall]:
    """Flatten every assistant ``tool_calls`` array across the run's history."""
    out: list[InvokeToolCall] = []
    for msg in run.messages:
        if msg.role != "assistant" or not msg.tool_calls:
            continue
        for tc in msg.tool_calls:
            args = tc.arguments if isinstance(tc.arguments, dict) else {}
            out.append(InvokeToolCall(id=tc.id, name=tc.name, arguments=args))
    return out


def _response_from_run(
    *,
    run: Run,
    pack_slug: str,
    use_case_slug: str,
    use_case_version: str,
    correlation_id: str,
    tenant_id: str | None,
    session_id: str | None,
    trail_event_count: int,
) -> InvokeResponse:
    """Build the normalised :class:`InvokeResponse` from a finished :class:`Run`."""
    last_assistant = next(
        (m.content or "" for m in reversed(run.messages) if m.role == "assistant"),
        "",
    )
    reply = (run.result or {}).get("reply") if run.result else None
    return InvokeResponse(
        response=reply if isinstance(reply, str) and reply else last_assistant,
        pack=pack_slug,
        use_case=use_case_slug,
        use_case_version=use_case_version,
        run_id=run.run_id,
        status=run.status,
        correlation_id=correlation_id,
        session_id=session_id,
        tenant_id=tenant_id,
        tool_calls=_extract_tool_calls_from_run(run),
        checkpoints=[run.run_id],
        trail_event_count=trail_event_count,
        error=run.error,
    )


def _coerce_mcp(available_tools: Mapping[str, Any]) -> "MCPClientsAPI":
    """Use a caller-supplied ``MCPClientsAPI`` if present, else build a stub.

    The seam accepts a ``Mapping`` so transports can pass either:

    * ``{"_mcp": <MCPClientsAPI>, "tools": [...]}`` — the recommended shape
      when the transport already owns an :class:`agi.mcp.MCPClientsAPI`.
    * Anything else — we lazily construct a stub MCP API with no servers; the
      orchestrator only invokes tools when the model emits a ``tool_call``,
      and the pack's allow-list (if any) gates that path.
    """
    from agi.mcp import MCPClientsAPI

    candidate = available_tools.get("_mcp") if isinstance(available_tools, Mapping) else None
    if isinstance(candidate, MCPClientsAPI):
        return candidate
    return MCPClientsAPI(servers={})


def _coerce_tool_schemas(available_tools: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Pull the OpenAI tool-schema list out of the ``available_tools`` map.

    Accepts ``{"tools": [...]}`` or treats the mapping itself as a
    ``{name: schema}`` dict; if neither fits, returns an empty list and lets
    the orchestrator decide what to do.
    """
    if not isinstance(available_tools, Mapping):
        return []
    raw_tools = available_tools.get("tools")
    if isinstance(raw_tools, list):
        return [t for t in raw_tools if isinstance(t, dict)]
    # Heuristic: maybe the mapping itself is name → schema.
    out: list[dict[str, Any]] = []
    for key, val in available_tools.items():
        if key.startswith("_"):
            continue
        if isinstance(val, dict) and "function" in val:
            out.append(val)
    return out


# ---------------------------------------------------------------------------
# invoke_use_case
# ---------------------------------------------------------------------------


async def invoke_use_case(
    *,
    use_case_cls: type,
    pack: "Pack",
    request: InvokeRequest,
    model_binding: "ModelBinding",
    available_tools: Mapping[str, Any],
    trail_sink: TrailSink,
    correlation_id: str,
    tenant_id: str,
    session_id: str | None = None,
    checkpoint_store: "CheckpointStore | None" = None,
) -> InvokeResponse:
    """Drive a single :class:`InvokeRequest` through the native orchestrator.

    The function is HTTP- and MCP-agnostic — :func:`agi.serve.serve` and
    ``agi_runtime.routes.chat`` both call this. It:

    1. Validates the use-case class carries ``@use_case`` stamps.
    2. Emits an ``invoke.start`` envelope event to ``trail_sink``.
    3. Drives the native :class:`agi.orchestrators.native.Orchestrator`
       end-to-end (orchestrator emits its own ``llm.call`` / ``mcp.tool`` events
       on the same sink).
    4. Emits an ``invoke.end`` envelope event.
    5. Normalises the result into :class:`InvokeResponse` and returns it.

    Orchestrator exceptions propagate — the transport layer maps them to HTTP
    codes. The envelope ``invoke.end`` event still fires on the failure path
    via ``try/finally``, so the audit sink is never left half-written.
    """
    use_case_slug, use_case_version = _resolve_use_case_identity(use_case_cls)
    if request.use_case and request.use_case != use_case_slug:
        raise ValueError(
            f"InvokeRequest.use_case={request.use_case!r} does not match the slug stamped on "
            f"{use_case_cls.__name__!r} ({use_case_slug!r}); cross-use-case dispatch is a "
            "runtime concern, not a serve()/dispatch one."
        )

    messages = request.to_messages()
    if not messages:
        raise ValueError(
            "InvokeRequest carries no messages; either set 'messages' or the legacy 'message'."
        )

    pack_slug = pack.slug
    pre_event_count = len(trail_sink.events) if isinstance(trail_sink, MemoryTrailSink) else 0

    # (1) start envelope.
    await trail_sink.write(
        new_event(
            correlation_id=correlation_id,
            pack_slug=pack_slug,
            session_id=session_id or "",
            event_type="invoke.start",
            payload={
                "use_case": use_case_slug,
                "version": use_case_version,
                "tenant_id": tenant_id,
                "ts": _now_iso(),
                "request": _redact_request_for_trail(request),
            },
        )
    )

    # (2) build orchestrator + run, drive to terminal status.
    mcp = _coerce_mcp(available_tools)
    tool_schemas = _coerce_tool_schemas(available_tools)
    store: CheckpointStore = checkpoint_store or MemoryCheckpointStore()

    orch = Orchestrator(
        binding=model_binding,
        mcp=mcp,
        pack=pack,
        checkpoint_store=store,
        trail_sink=trail_sink,
        available_tools=tool_schemas,
    )

    run = Run(
        correlation_id=correlation_id,
        pack_slug=pack_slug,
        use_case_slug=use_case_slug,
        use_case_version=use_case_version,
        tenant_id=tenant_id,
        session_id=session_id,
        messages=messages,
        max_steps=request.max_steps or 50,
        max_tool_calls=request.max_tool_calls,
    )

    status_for_envelope: str = "failed"
    error_for_envelope: str | None = None
    try:
        run = await orch.run_until_done(run)
        status_for_envelope = run.status
        error_for_envelope = run.error
    except Exception as exc:  # noqa: BLE001 — re-raised below
        error_for_envelope = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        await trail_sink.write(
            new_event(
                correlation_id=correlation_id,
                pack_slug=pack_slug,
                session_id=session_id or "",
                event_type="invoke.end",
                payload={
                    "use_case": use_case_slug,
                    "version": use_case_version,
                    "run_id": run.run_id,
                    "status": status_for_envelope,
                    "error": error_for_envelope,
                    "ts": _now_iso(),
                },
            )
        )

    post_event_count = len(trail_sink.events) if isinstance(trail_sink, MemoryTrailSink) else 0
    trail_event_count = max(0, post_event_count - pre_event_count)

    # System prompt / last_user are derived for parity with run_use_case's
    # eager helper; the orchestrator itself reads the full message history.
    _ = _system_prompt(messages)
    _ = _last_user_message(messages)

    return _response_from_run(
        run=run,
        pack_slug=pack_slug,
        use_case_slug=use_case_slug,
        use_case_version=use_case_version,
        correlation_id=correlation_id,
        tenant_id=tenant_id,
        session_id=session_id,
        trail_event_count=trail_event_count,
    )


# ---------------------------------------------------------------------------
# stream_use_case
# ---------------------------------------------------------------------------


async def stream_use_case(
    *,
    use_case_cls: type,
    pack: "Pack",
    request: InvokeRequest,
    model_binding: "ModelBinding",
    available_tools: Mapping[str, Any],
    trail_sink: TrailSink,
    correlation_id: str,
    tenant_id: str,
    session_id: str | None = None,
    checkpoint_store: "CheckpointStore | None" = None,
) -> AsyncIterator[dict[str, Any]]:
    """SSE-yielding equivalent of :func:`invoke_use_case`.

    Yields ``dict`` rows in this order:

    1. One ``{"event_type": "invoke.start", ...}`` row, mirroring the trail event.
    2. Zero or more ``{"event_type": "llm.delta", "delta": "...", "finish_reason": ...}``
       rows for each streaming chunk. (Tool dispatch during streaming is a
       Phase 3 feature; see :meth:`Orchestrator.stream`'s docstring.)
    3. One terminal ``{"event_type": "invoke.end", "response": <InvokeResponse.model_dump()>}``
       row carrying the same envelope shape :func:`invoke_use_case` returns.

    The HTTP layer wraps each yielded dict into ``data: <json>\\n\\n`` SSE
    frames; this module never touches SSE framing.
    """
    return _stream_use_case_impl(
        use_case_cls=use_case_cls,
        pack=pack,
        request=request,
        model_binding=model_binding,
        available_tools=available_tools,
        trail_sink=trail_sink,
        correlation_id=correlation_id,
        tenant_id=tenant_id,
        session_id=session_id,
        checkpoint_store=checkpoint_store,
    )


async def _stream_use_case_impl(
    *,
    use_case_cls: type,
    pack: "Pack",
    request: InvokeRequest,
    model_binding: "ModelBinding",
    available_tools: Mapping[str, Any],
    trail_sink: TrailSink,
    correlation_id: str,
    tenant_id: str,
    session_id: str | None,
    checkpoint_store: "CheckpointStore | None",
) -> AsyncIterator[dict[str, Any]]:
    use_case_slug, use_case_version = _resolve_use_case_identity(use_case_cls)
    if request.use_case and request.use_case != use_case_slug:
        raise ValueError(
            f"InvokeRequest.use_case={request.use_case!r} does not match the slug stamped on "
            f"{use_case_cls.__name__!r} ({use_case_slug!r})."
        )

    messages = request.to_messages()
    if not messages:
        raise ValueError(
            "InvokeRequest carries no messages; either set 'messages' or the legacy 'message'."
        )

    pack_slug = pack.slug
    pre_event_count = len(trail_sink.events) if isinstance(trail_sink, MemoryTrailSink) else 0

    start_payload = {
        "use_case": use_case_slug,
        "version": use_case_version,
        "tenant_id": tenant_id,
        "ts": _now_iso(),
        "request": _redact_request_for_trail(request),
    }
    await trail_sink.write(
        new_event(
            correlation_id=correlation_id,
            pack_slug=pack_slug,
            session_id=session_id or "",
            event_type="invoke.start",
            payload=start_payload,
        )
    )
    yield {"event_type": "invoke.start", "ts": _now_iso(), "payload": start_payload}

    mcp = _coerce_mcp(available_tools)
    tool_schemas = _coerce_tool_schemas(available_tools)
    store: CheckpointStore = checkpoint_store or MemoryCheckpointStore()

    orch = Orchestrator(
        binding=model_binding,
        mcp=mcp,
        pack=pack,
        checkpoint_store=store,
        trail_sink=trail_sink,
        available_tools=tool_schemas,
    )
    run = Run(
        correlation_id=correlation_id,
        pack_slug=pack_slug,
        use_case_slug=use_case_slug,
        use_case_version=use_case_version,
        tenant_id=tenant_id,
        session_id=session_id,
        messages=messages,
        max_steps=request.max_steps or 50,
        max_tool_calls=request.max_tool_calls,
    )

    status_for_envelope: str = "failed"
    error_for_envelope: str | None = None
    try:
        async for chunk in orch.stream(run):
            yield {
                "event_type": "llm.delta",
                "ts": _now_iso(),
                "payload": chunk,
            }
        status_for_envelope = run.status
        error_for_envelope = run.error
    except Exception as exc:  # noqa: BLE001
        error_for_envelope = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        await trail_sink.write(
            new_event(
                correlation_id=correlation_id,
                pack_slug=pack_slug,
                session_id=session_id or "",
                event_type="invoke.end",
                payload={
                    "use_case": use_case_slug,
                    "version": use_case_version,
                    "run_id": run.run_id,
                    "status": status_for_envelope,
                    "error": error_for_envelope,
                    "ts": _now_iso(),
                },
            )
        )

    post_event_count = len(trail_sink.events) if isinstance(trail_sink, MemoryTrailSink) else 0
    trail_event_count = max(0, post_event_count - pre_event_count)

    response = _response_from_run(
        run=run,
        pack_slug=pack_slug,
        use_case_slug=use_case_slug,
        use_case_version=use_case_version,
        correlation_id=correlation_id,
        tenant_id=tenant_id,
        session_id=session_id,
        trail_event_count=trail_event_count,
    )
    yield {"event_type": "invoke.end", "response": response.model_dump()}


__all__ = [
    "InvokeMessage",
    "InvokeRequest",
    "InvokeResponse",
    "InvokeToolCall",
    "invoke_use_case",
    "stream_use_case",
]
