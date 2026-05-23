# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""Regression: runtime ``/chat`` MUST delegate to :mod:`agi.dispatch`.

ADR-0002 makes ``agi.dispatch.invoke_use_case`` the single seam both
``agi.serve()``'s ``POST /v1/invoke`` and the runtime's ``POST /chat`` drive.
This file pins the contract three ways:

1. Wire-shape parity — the runtime's HTTP response carries the same envelope
   fields :func:`agi.dispatch.invoke_use_case` returns directly.
2. Streaming terminal event — ``POST /chat/stream`` ends with an SSE frame
   whose decoded payload has ``event_type == "invoke.end"``.
3. Call-site discipline — patching ``invoke_use_case`` to a sentinel proves
   the route really delegates (vs re-inlining orchestrator code).

These are the drift detectors. If they fail, someone has split the seam
again — re-read ADR-0002 before "fixing" them.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from agi.config import Pack as SDKPack
from agi.dispatch import InvokeRequest, InvokeResponse, invoke_use_case
from agi.mcp import MCPClientsAPI
from agi.models import ModelBinding
from agi.trail import MemoryTrailSink

from agi_runtime import routes  # noqa: F401 — needed so the dotted patch path resolves
from agi_runtime.config import ModelBindingConfig
from agi_runtime.main import create_app
from agi_runtime.middleware import dispatch as dispatch_mod
from agi_runtime.routes import chat as chat_route
from agi_runtime.state import RuntimeState

from .conftest import bearer_for


# ---------------------------------------------------------------------------
# Shared LiteLLM stand-in + test client
# ---------------------------------------------------------------------------


def _fake_completion(content: str) -> dict[str, Any]:
    return {
        "choices": [
            {
                "message": {"content": content, "tool_calls": []},
                "finish_reason": "stop",
            }
        ]
    }


async def _fake_stream_chunks(text: str) -> Any:
    """Async iterator of LiteLLM-shaped streaming chunks for ``text``.

    The native orchestrator's :meth:`Orchestrator.stream` reads
    ``chunk["choices"][0]["delta"]["content"]`` plus ``finish_reason`` — we
    emit one token chunk then a terminal ``finish_reason="stop"`` frame.
    """
    yield {
        "choices": [
            {"delta": {"content": text}, "finish_reason": None},
        ]
    }
    yield {
        "choices": [
            {"delta": {"content": ""}, "finish_reason": "stop"},
        ]
    }


@pytest.fixture
def fake_litellm(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_acompletion(**kwargs: Any) -> Any:
        # Streaming branch — return an async iterator, not a dict.
        if kwargs.get("stream"):
            return _fake_stream_chunks("hello from seam parity")
        return _fake_completion("hello from seam parity")

    monkeypatch.setattr("litellm.acompletion", fake_acompletion)


@pytest.fixture
def configured_client(
    monkeypatch: pytest.MonkeyPatch,
    fake_litellm: None,
) -> TestClient:
    """TestClient with claims-verifier patched + a reasoning binding configured."""

    async def fake_verify(request):  # type: ignore[no-untyped-def]
        header = request.headers.get("Authorization", "")
        token = header.split(" ", 1)[1].strip()
        body = token.split(":", 1)[1]
        if ":" in body:
            tenant, scopes_raw = body.split(":", 1)
            scopes = tuple(s for s in scopes_raw.split(",") if s)
        else:
            tenant, scopes = body, ("AGI_VIEWER",)
        return dispatch_mod._Claims(sub="test", tenant_id=tenant, scopes=scopes)

    monkeypatch.setattr(dispatch_mod, "_verify_request_claims", fake_verify)

    app = create_app()
    with TestClient(app) as c:
        state: RuntimeState = app.state.runtime
        state.config.models["reasoning"] = ModelBindingConfig(
            role="reasoning",
            model_id="openai/gpt-fake",
        )
        # Replace the sink with a fresh in-memory one so we can compare counts.
        state.trail_sink = MemoryTrailSink()
        yield c


# ---------------------------------------------------------------------------
# (1) Wire-shape parity
# ---------------------------------------------------------------------------


def _drive_direct_invoke(  # helper used by the parity test
    *,
    payload: dict[str, Any],
    correlation_id: str,
) -> tuple[InvokeResponse, MemoryTrailSink]:
    """Run :func:`invoke_use_case` with the same wiring the route uses."""
    sink = MemoryTrailSink()
    pack = SDKPack(slug="bluemarble", version="0.0.0-stub")
    resp = _await(
        invoke_use_case(
            use_case_cls=chat_route._RuntimeChatUseCase,
            pack=pack,
            request=InvokeRequest.model_validate(payload),
            model_binding=ModelBinding(role="reasoning", model_id="openai/gpt-fake"),
            available_tools={"_mcp": MCPClientsAPI(servers={}), "tools": []},
            trail_sink=sink,
            correlation_id=correlation_id,
            tenant_id="bluemarble",
            session_id=None,
        )
    )
    return resp, sink


def _await(coro: Any) -> Any:
    """Run an awaitable in the test thread."""
    import asyncio

    return asyncio.new_event_loop().run_until_complete(coro)


def test_chat_response_matches_dispatch_invoke_response(
    configured_client: TestClient,
) -> None:
    """``/chat`` body must carry the same envelope fields as a direct seam call.

    Fire the same payload through the route AND through
    :func:`invoke_use_case` directly. Both should resolve to
    ``status == "completed"``, surface the same final assistant ``response``,
    emit the same tool-call count, and write the same number of trail events
    (``invoke.start``/``invoke.end`` envelope plus orchestrator inner events).
    """
    payload = {"messages": [{"role": "user", "content": "hi"}]}

    direct_resp, direct_sink = _drive_direct_invoke(payload=payload, correlation_id="cid-direct")

    http_resp = configured_client.post(
        "/chat",
        json=payload,
        headers={
            "X-Pack": "bluemarble",
            "Authorization": bearer_for("bluemarble"),
            "X-Correlation-Id": "cid-http",
        },
    )
    assert http_resp.status_code == 200, http_resp.text
    body = http_resp.json()

    # Same final-message content & status.
    assert body["response"] == direct_resp.response
    assert body["status"] == direct_resp.status == "completed"

    # Same tool-call count (zero on this LLM mock).
    assert len(body["tool_calls"]) == len(direct_resp.tool_calls) == 0

    # Same trail-event count between invoke.start and invoke.end (inclusive).
    # The HTTP path's sink is the app-state sink; we count it post-hoc.
    state: RuntimeState = configured_client.app.state.runtime  # type: ignore[attr-defined]
    assert isinstance(state.trail_sink, MemoryTrailSink)
    assert body["trail_event_count"] == direct_resp.trail_event_count
    # Both sinks should have at least the start+end envelopes.
    assert any(e["event_type"] == "invoke.start" for e in direct_sink.events)
    assert any(e["event_type"] == "invoke.end" for e in direct_sink.events)
    assert any(e["event_type"] == "invoke.start" for e in state.trail_sink.events)
    assert any(e["event_type"] == "invoke.end" for e in state.trail_sink.events)


# ---------------------------------------------------------------------------
# (2) Streaming terminates with invoke.end
# ---------------------------------------------------------------------------


def test_chat_stream_yields_invoke_end_event(configured_client: TestClient) -> None:
    """POST /chat/stream — drain SSE, assert the last data frame is invoke.end."""
    with configured_client.stream(
        "POST",
        "/chat/stream",
        json={"messages": [{"role": "user", "content": "ping"}]},
        headers={
            "X-Pack": "bluemarble",
            "Authorization": bearer_for("bluemarble"),
        },
    ) as resp:
        assert resp.status_code == 200
        frames: list[str] = []
        for line in resp.iter_lines():
            if not line:
                continue
            # httpx/TestClient yields str lines already.
            if line.startswith("data: "):
                frames.append(line[len("data: ") :])

    assert frames, "no SSE data frames received"
    assert frames[-1] == "[DONE]", f"stream did not terminate with [DONE]: {frames[-1]!r}"

    # The penultimate frame must be the invoke.end envelope.
    assert len(frames) >= 2, f"expected >=2 frames, got {frames!r}"
    terminal_payload = json.loads(frames[-2])
    assert terminal_payload["event_type"] == "invoke.end", terminal_payload


# ---------------------------------------------------------------------------
# (3) Call-site discipline — the route DELEGATES, doesn't re-inline
# ---------------------------------------------------------------------------


def test_chat_dispatches_through_seam(
    monkeypatch: pytest.MonkeyPatch,
    configured_client: TestClient,
) -> None:
    """Patch :func:`agi.dispatch.invoke_use_case` and assert the route calls it.

    If somebody re-inlines orchestrator construction inside the route, the
    sentinel never gets returned and this fails — exactly the regression
    ADR-0002 closes.
    """
    sentinel = InvokeResponse(
        response="sentinel-reply",
        pack="bluemarble",
        use_case="chat",
        use_case_version="0.0.0",
        run_id="run-sentinel",
        status="completed",
        correlation_id="cid-sentinel",
        session_id=None,
        tenant_id="bluemarble",
    )
    spy = AsyncMock(return_value=sentinel)

    # Patch the name the route imports — that's the call site we're pinning.
    monkeypatch.setattr(chat_route, "invoke_use_case", spy)

    resp = configured_client.post(
        "/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "max_steps": 7},
        headers={
            "X-Pack": "bluemarble",
            "Authorization": bearer_for("bluemarble"),
            "X-Session-Id": "sess-xyz",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Sentinel made it onto the wire — proves the route's response derives
    # from the seam's return value.
    assert body["response"] == "sentinel-reply"
    assert body["run_id"] == "run-sentinel"
    assert body["status"] == "completed"

    # Spy was called exactly once with the kwargs the contract requires.
    assert spy.await_count == 1
    kwargs = spy.await_args.kwargs
    assert kwargs["use_case_cls"] is chat_route._RuntimeChatUseCase
    assert kwargs["tenant_id"] == "bluemarble"
    assert kwargs["session_id"] == "sess-xyz"
    assert kwargs["correlation_id"]
    # The InvokeRequest had its max_steps preserved (caller provided 7).
    assert isinstance(kwargs["request"], InvokeRequest)
    assert kwargs["request"].max_steps == 7
    # ``available_tools`` follows the {"_mcp": ..., "tools": [...]} convention.
    avail = kwargs["available_tools"]
    assert "_mcp" in avail
    assert isinstance(avail["_mcp"], MCPClientsAPI)
    assert "tools" in avail
    assert isinstance(avail["tools"], list)
    # The seam gets the runtime's actual trail sink, not a fresh one.
    state: RuntimeState = configured_client.app.state.runtime  # type: ignore[attr-defined]
    assert kwargs["trail_sink"] is state.trail_sink
