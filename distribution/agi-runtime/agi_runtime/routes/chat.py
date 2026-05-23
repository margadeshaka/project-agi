# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""POST /chat — thin adapter over the SDK's :mod:`agi.dispatch` seam.

Request shape (FR-INT.1):

    POST /chat
    Headers: X-Pack, Authorization, [X-Correlation-Id], [X-Session-Id]
    Body: { "messages": [Message], "stream": bool, "max_steps": int }
          (also accepts legacy ``{"message": "..."}`` from earlier callers)

Response shape:

    { "response": <last assistant content>,
      "pack": <slug>,
      "correlation_id": <id>,
      "run_id": <id>,
      "status": "completed" | "failed" | "paused" }

Streaming responses use Server-Sent Events with ``data: <json>`` frames; the
final frame is ``data: [DONE]`` so the FE matches OpenAI's wire format.

Per ADR-0002, this module's only job is request-state plumbing — pack resolved
by ``XPackDispatchMiddleware``, correlation/session ids, model binding lookup.
The orchestrator-driving code lives in :mod:`agi.dispatch` and is shared with
``agi.serve()``'s ``POST /v1/invoke``. **Do not re-inline orchestrator
construction here** — the whole point of this refactor is that there's exactly
one such call site.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from agi.config import Pack as SDKPack
from agi.dispatch import (
    InvokeRequest,
    InvokeResponse,
    invoke_use_case,
    stream_use_case,
)
from agi.models import ModelBinding
from agi.use_case import use_case as _use_case_decorator

from agi_runtime.config import ModelBindingConfig
from agi_runtime.state import RuntimeState

router = APIRouter(tags=["chat"])


# A minimal ``@use_case``-stamped class so :func:`agi.dispatch.invoke_use_case`
# can read its ``slug`` / ``version`` sentinel attributes. The runtime's
# ``/chat`` doesn't dispatch to per-tenant use-case code (that's a serve()
# concern); it just needs a stable identity for the OTel baggage and the
# InvokeResponse envelope. The slug ``"chat"`` matches the legacy value the
# pre-refactor route stamped on ``Run.use_case_slug``.
@_use_case_decorator("chat", version="0.0.0")
class _RuntimeChatUseCase:
    """Identity stub for the runtime's generic /chat route."""


@router.post("/chat")
async def chat(request: Request) -> Any:
    """Non-streaming chat — delegates to :func:`agi.dispatch.invoke_use_case`."""
    payload = await _read_json_body(request)
    try:
        invoke_req = InvokeRequest.model_validate(payload)
    except Exception as exc:  # noqa: BLE001 — surface as a 400, not a 500
        return JSONResponse(
            {
                "error": "invalid_request",
                "message": str(exc),
                "correlation_id": request.state.correlation_id,
            },
            status_code=400,
        )

    ctx = _request_context(request, invoke_req)
    if ctx.empty_messages_response is not None:
        return ctx.empty_messages_response
    if ctx.stub_response is not None:
        return ctx.stub_response

    # Streaming via body flag is supported for back-compat with older clients
    # that POST {"messages": [...], "stream": true} to /chat.
    if invoke_req.stream:
        return _stream_response(ctx)

    invoke_resp = await invoke_use_case(
        use_case_cls=_RuntimeChatUseCase,
        pack=ctx.sdk_pack,
        request=invoke_req,
        model_binding=ctx.model_binding,
        available_tools=ctx.available_tools,
        trail_sink=ctx.runtime.trail_sink,
        correlation_id=ctx.correlation_id,
        tenant_id=ctx.tenant_id,
        session_id=ctx.session_id,
    )
    return _to_chat_response(invoke_resp, pack_slug=ctx.pack_slug)


@router.post("/chat/stream")
async def chat_stream(request: Request) -> Any:
    """SSE-only chat — always streams, even if the body omits ``stream=true``."""
    payload = await _read_json_body(request)
    try:
        invoke_req = InvokeRequest.model_validate(payload)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            {
                "error": "invalid_request",
                "message": str(exc),
                "correlation_id": request.state.correlation_id,
            },
            status_code=400,
        )

    # Force-on the stream flag so the dispatch envelope and the response shape
    # agree with the URL-based contract.
    invoke_req.stream = True

    ctx = _request_context(request, invoke_req)
    if ctx.empty_messages_response is not None:
        return ctx.empty_messages_response
    if ctx.stub_response is not None:
        # Stub mode has no live stream; emit one synthetic frame + [DONE].
        return _stub_stream_response(ctx)

    return _stream_response(ctx)


# ---------------------------------------------------------------------------
# Request-state plumbing
# ---------------------------------------------------------------------------


class _RequestContext:
    """Everything the seam needs, derived once per request."""

    __slots__ = (
        "available_tools",
        "correlation_id",
        "empty_messages_response",
        "invoke_req",
        "model_binding",
        "pack_slug",
        "runtime",
        "sdk_pack",
        "session_id",
        "stub_response",
        "tenant_id",
    )

    def __init__(
        self,
        *,
        runtime: RuntimeState,
        invoke_req: InvokeRequest,
        sdk_pack: SDKPack,
        pack_slug: str,
        tenant_id: str,
        session_id: str | None,
        correlation_id: str,
        model_binding: ModelBinding | None,
        available_tools: dict[str, Any],
        empty_messages_response: JSONResponse | None,
        stub_response: dict[str, Any] | None,
    ) -> None:
        self.runtime = runtime
        self.invoke_req = invoke_req
        self.sdk_pack = sdk_pack
        self.pack_slug = pack_slug
        self.tenant_id = tenant_id
        self.session_id = session_id
        self.correlation_id = correlation_id
        # ``model_binding`` is only used on the live path; the stub path
        # short-circuits before it's dereferenced, so a ``None`` is fine there.
        self.model_binding = model_binding  # type: ignore[assignment]
        self.available_tools = available_tools
        self.empty_messages_response = empty_messages_response
        self.stub_response = stub_response


def _request_context(request: Request, invoke_req: InvokeRequest) -> _RequestContext:
    pack = request.state.pack
    correlation_id: str = request.state.correlation_id
    runtime: RuntimeState = request.app.state.runtime

    # X-Session-Id header wins over body session_id; both are optional.
    session_id = request.headers.get("X-Session-Id") or invoke_req.session_id

    # ``XPackDispatchMiddleware`` already validated tenant == pack header, so
    # either source is safe. Prefer the claims tuple so the seam sees the
    # claim-derived value (matches what serve()'s in-process auth hook does).
    claims = getattr(request.state, "claims", None)
    tenant_id: str = getattr(claims, "tenant_id", None) or pack.tenant_id or pack.slug

    # Propagate correlation_id back onto the InvokeRequest so the trail's
    # invoke.start envelope records it.
    if not invoke_req.correlation_id:
        invoke_req.correlation_id = correlation_id

    # Resolve the SDK Pack — fall back to a synthetic shim when the pack
    # folder hasn't been physically deployed (matches pre-refactor behaviour
    # the dispatch fuzz test relies on).
    sdk_pack: SDKPack | None = runtime.pack_loader.get(pack.slug)
    if sdk_pack is None:
        sdk_pack = SDKPack(slug=pack.slug, version="0.0.0-stub")

    # Empty-messages short-circuit — keep the 400 contract.
    if not invoke_req.to_messages():
        return _RequestContext(
            runtime=runtime,
            invoke_req=invoke_req,
            sdk_pack=sdk_pack,
            pack_slug=pack.slug,
            tenant_id=tenant_id,
            session_id=session_id,
            correlation_id=correlation_id,
            model_binding=None,
            available_tools={},
            empty_messages_response=JSONResponse(
                {
                    "error": "empty_messages",
                    "message": "request must include 'messages' or 'message'",
                    "correlation_id": correlation_id,
                },
                status_code=400,
            ),
            stub_response=None,
        )

    # No model binding → return the synthetic stub envelope (back-compat with
    # the dispatch fuzz test which has no LLM wired).
    binding_cfg = runtime.config.model_binding("reasoning")
    if binding_cfg is None:
        return _RequestContext(
            runtime=runtime,
            invoke_req=invoke_req,
            sdk_pack=sdk_pack,
            pack_slug=pack.slug,
            tenant_id=tenant_id,
            session_id=session_id,
            correlation_id=correlation_id,
            model_binding=None,
            available_tools={},
            empty_messages_response=None,
            stub_response=_stub_response(pack.slug, correlation_id, invoke_req),
        )

    model_binding = _to_sdk_binding(binding_cfg)

    # Compose ``available_tools`` in the convention :mod:`agi.dispatch`
    # expects: a single mapping carrying both the live MCP client API and
    # the OpenAI-shaped tool schema list.
    from agi.mcp import MCPClientsAPI

    mcp = MCPClientsAPI(
        servers={},
        tool_allowlist=list(sdk_pack.tool_allowlist) if sdk_pack.tool_allowlist else None,
    )
    available_tools: dict[str, Any] = {
        "_mcp": mcp,
        "tools": runtime.bundle_loader.all_tools_for(sdk_pack),
    }

    # Pin max_steps to the runtime default when the caller didn't pick one;
    # the seam reads ``request.max_steps`` directly.
    if invoke_req.max_steps is None:
        invoke_req.max_steps = runtime.config.max_steps

    return _RequestContext(
        runtime=runtime,
        invoke_req=invoke_req,
        sdk_pack=sdk_pack,
        pack_slug=pack.slug,
        tenant_id=tenant_id,
        session_id=session_id,
        correlation_id=correlation_id,
        model_binding=model_binding,
        available_tools=available_tools,
        empty_messages_response=None,
        stub_response=None,
    )


async def _read_json_body(request: Request) -> dict[str, Any]:
    """Tolerant JSON-body parse — returns ``{}`` on empty body."""
    raw = await request.body()
    if not raw:
        return {}
    try:
        loaded = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _to_sdk_binding(cfg: ModelBindingConfig) -> ModelBinding:
    """Adapt the runtime's :class:`ModelBindingConfig` to the SDK binding."""
    return ModelBinding(
        role=cfg.role,
        model_id=cfg.model_id,
        region=cfg.region,
        default_params=dict(cfg.default_params),
        extra=dict(cfg.extra),
    )


# ---------------------------------------------------------------------------
# Response shaping
# ---------------------------------------------------------------------------


def _to_chat_response(resp: InvokeResponse, *, pack_slug: str) -> dict[str, Any]:
    """Map the seam's :class:`InvokeResponse` onto the legacy chat wire shape.

    Existing tests assert ``response``, ``pack``, ``correlation_id``, ``run_id``,
    ``status``. :class:`InvokeResponse` is wire-compatible for those fields, so
    we project (not wrap) — this keeps the response body small and avoids a
    schema double-up. Extra envelope fields (``tool_calls``, ``trail_event_count``)
    are surfaced too because they're additive.
    """
    return {
        "response": resp.response,
        "pack": pack_slug,
        "correlation_id": resp.correlation_id,
        "run_id": resp.run_id,
        "status": resp.status,
        "tool_calls": [tc.model_dump() for tc in resp.tool_calls],
        "trail_event_count": resp.trail_event_count,
        "error": resp.error,
    }


def _stub_response(
    pack_slug: str,
    correlation_id: str,
    invoke_req: InvokeRequest,
) -> dict[str, Any]:
    """Synthetic 200 used when no model binding is configured.

    The dispatch fuzz test and ``test_chat_stub_when_no_binding`` exercise
    this branch — they care only about HTTP status and the ``pack`` /
    ``stub`` fields, not the actual LLM call.
    """
    messages = invoke_req.to_messages()
    user_text = next(
        (m.content or "" for m in reversed(messages) if m.role == "user"),
        "",
    )
    return {
        "response": f"[stub] no model binding configured; echo: {user_text}",
        "pack": pack_slug,
        "correlation_id": correlation_id,
        "run_id": "run-stub",
        "status": "completed",
        "stub": True,
    }


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


def _stream_response(ctx: _RequestContext) -> StreamingResponse:
    """3-line wrapper over :func:`agi.dispatch.stream_use_case`."""
    return StreamingResponse(
        _sse_frames(ctx),
        media_type="text/event-stream",
        headers={"X-Correlation-Id": ctx.correlation_id},
    )


async def _sse_frames(ctx: _RequestContext) -> Any:
    """Yield ``data: <json>\\n\\n`` SSE frames + a terminal ``data: [DONE]``.

    ``stream_use_case`` is an ``async def`` that **returns** an async iterator,
    so the call itself yields a coroutine — we await it before iterating.
    """
    iterator = await stream_use_case(
        use_case_cls=_RuntimeChatUseCase,
        pack=ctx.sdk_pack,
        request=ctx.invoke_req,
        model_binding=ctx.model_binding,
        available_tools=ctx.available_tools,
        trail_sink=ctx.runtime.trail_sink,
        correlation_id=ctx.correlation_id,
        tenant_id=ctx.tenant_id,
        session_id=ctx.session_id,
    )
    async for row in iterator:
        yield f"data: {json.dumps(row)}\n\n"
    yield "data: [DONE]\n\n"


def _stub_stream_response(ctx: _RequestContext) -> StreamingResponse:
    """SSE wrapper around the no-binding stub envelope.

    Emits one synthetic ``invoke.end``-shaped frame so clients hitting
    ``/chat/stream`` against an unconfigured runtime still see a valid SSE
    stream with the same terminal-event convention :func:`stream_use_case`
    uses on the live path.
    """

    async def _frames() -> Any:
        end_frame = {
            "event_type": "invoke.end",
            "response": ctx.stub_response,
        }
        yield f"data: {json.dumps(end_frame)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _frames(),
        media_type="text/event-stream",
        headers={"X-Correlation-Id": ctx.correlation_id},
    )
