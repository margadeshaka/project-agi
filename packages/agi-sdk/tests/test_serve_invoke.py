# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for ``agi.serve`` — the FastAPI shell around the dispatch seam.

These tests boot the FastAPI app in non-blocking mode and exercise the same
fake ``litellm.acompletion`` pattern as ``test_dispatch_seam.py`` so we drive
the orchestrator end-to-end without network or provider credentials.
"""

from __future__ import annotations

import json
import sys
import types
from typing import Any

import pytest


# ---------------------------------------------------------------------------
# Fake litellm — injected before import (same pattern as test_dispatch_seam.py)
# ---------------------------------------------------------------------------


class _FakeChoice:
    def __init__(self, message: dict[str, Any], finish_reason: str | None = "stop") -> None:
        self.message = message
        self.finish_reason = finish_reason


class _FakeResponse:
    def __init__(self, choices: list[_FakeChoice]) -> None:
        self.choices = choices


_call_log: list[dict[str, Any]] = []
_scripted_replies: list[_FakeResponse] = []
_scripted_stream_chunks: list[Any] = []


async def _fake_acompletion(**kwargs: Any) -> Any:
    _call_log.append(kwargs)
    if kwargs.get("stream"):

        async def _agen() -> Any:
            for c in _scripted_stream_chunks:
                yield c

        return _agen()
    if not _scripted_replies:
        raise RuntimeError("no scripted reply queued for fake_acompletion")
    return _scripted_replies.pop(0)


if "litellm" not in sys.modules:
    _fake_litellm = types.ModuleType("litellm")
    _fake_litellm.acompletion = _fake_acompletion  # type: ignore[attr-defined]
    sys.modules["litellm"] = _fake_litellm


# Now safe to import the SDK surface.
from fastapi.testclient import TestClient  # noqa: E402

from agi.config import Pack  # noqa: E402
from agi.models import ModelBinding  # noqa: E402
from agi.serve import serve  # noqa: E402
from agi.trail import MemoryTrailSink  # noqa: E402
from agi.use_case import use_case  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_fakes() -> Any:
    """Install our scripted ``acompletion`` for the duration of one test."""
    _call_log.clear()
    _scripted_replies.clear()
    _scripted_stream_chunks.clear()
    litellm_mod = sys.modules["litellm"]
    previous = getattr(litellm_mod, "acompletion", None)
    litellm_mod.acompletion = _fake_acompletion  # type: ignore[attr-defined]
    try:
        yield
    finally:
        if previous is not None:
            litellm_mod.acompletion = previous  # type: ignore[attr-defined]


def _queue_reply(
    content: str | None = None, tool_calls: list[dict[str, Any]] | None = None
) -> None:
    msg: dict[str, Any] = {"content": content, "tool_calls": tool_calls or None}
    _scripted_replies.append(_FakeResponse([_FakeChoice(msg)]))


def _make_pack(slug: str = "test-pack") -> Pack:
    return Pack(slug=slug, version="0.1.0", tool_allowlist=["search", "lookup"])


def _make_binding() -> ModelBinding:
    return ModelBinding(role="reasoning", model_id="openai/gpt-4o-mini")


@use_case("serve_test_uc", "0.1.0")
class _DecoratedUseCase:
    """Tiny decorated use-case stand-in for the serve() tests."""

    def ping(self) -> str:
        """A public method — should surface in MCPServerHandle.tools."""
        return "pong"


class _UndecoratedUseCase:
    """Missing @use_case — invoke must reject with 400."""


def _boot_client(use_case_cls: type, *, pack: Pack | None = None) -> TestClient:
    """Boot the serve() FastAPI app in non-blocking mode and wrap in TestClient.

    Always supplies an explicit pack + MemoryTrailSink + ModelBinding so the
    tests are hermetic — no AGI_PACK_PATH dependence, no real provider calls.
    """
    sink = MemoryTrailSink()
    handle = serve(
        use_case_cls,
        pack=pack or _make_pack(),
        model_binding=_make_binding(),
        trail_sink=sink,
        http=True,
        mcp=True,
        block=False,
    )
    assert handle.fastapi_app is not None
    client = TestClient(handle.fastapi_app)
    # Stash the handle so individual tests can reach the sink / mcp handle.
    client.app.state.serve_handle = handle  # type: ignore[attr-defined]
    return client


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_invoke_happy_path() -> None:
    """POST /v1/invoke with a decorated class returns 200 + InvokeResponse shape."""
    _queue_reply(content="hi back")
    client = _boot_client(_DecoratedUseCase)
    sink: MemoryTrailSink = client.app.state.trail_sink

    resp = client.post(
        "/v1/invoke",
        json={
            "messages": [{"role": "user", "content": "hello"}],
            "correlation_id": "cid-happy",
            "session_id": "sess-happy",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "completed"
    assert body["response"] == "hi back"
    assert body["use_case"] == "serve_test_uc"
    assert body["use_case_version"] == "0.1.0"
    assert body["pack"] == "test-pack"
    assert body["correlation_id"] == "cid-happy"
    assert body["session_id"] == "sess-happy"

    event_types = [e["event_type"] for e in sink.events]
    assert "invoke.start" in event_types
    assert "invoke.end" in event_types


def test_invoke_undecorated_class_returns_400() -> None:
    """Undecorated use-case → ``serve()`` rejects at boot (stricter than 400).

    ``serve()`` won't let an undecorated class reach the HTTP plane at all — the
    boot-side ``get_use_case_slug`` check fires before FastAPI is built. That is
    deliberately stricter than letting the dispatch seam map the same condition
    to a 400 (which would still be valid per ADR-0002). The test pins the
    boot-time check so a future refactor that loosens it would have to update
    this test consciously.
    """
    with pytest.raises(TypeError, match="not a @use_case"):
        _boot_client(_UndecoratedUseCase)


def test_invoke_empty_messages_returns_400() -> None:
    """No messages at all → 400 from the dispatch seam's ValueError."""
    client = _boot_client(_DecoratedUseCase)
    resp = client.post("/v1/invoke", json={})
    assert resp.status_code == 400, resp.text


def test_invoke_stream_yields_invoke_end() -> None:
    """SSE stream terminates with one ``invoke.end`` event carrying the response."""
    chunks = [
        {"choices": [{"delta": {"content": "Hel"}, "finish_reason": None}]},
        {"choices": [{"delta": {"content": "lo"}, "finish_reason": None}]},
        {"choices": [{"delta": {"content": "!"}, "finish_reason": "stop"}]},
    ]
    _scripted_stream_chunks.extend(chunks)

    client = _boot_client(_DecoratedUseCase)
    with client.stream(
        "POST",
        "/v1/invoke/stream",
        json={
            "messages": [{"role": "user", "content": "stream me"}],
            "stream": True,
            "correlation_id": "cid-stream",
        },
    ) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        raw_chunks = b"".join(resp.iter_bytes()).decode("utf-8")

    # Parse the SSE frames.
    data_lines = [
        line[len("data: ") :] for line in raw_chunks.splitlines() if line.startswith("data: ")
    ]
    assert data_lines, f"no data lines parsed from {raw_chunks!r}"
    events = [json.loads(line) for line in data_lines]
    assert events[0]["event_type"] == "invoke.start"
    assert events[-1]["event_type"] == "invoke.end"
    final = events[-1]
    assert "response" in final
    assert final["response"]["use_case"] == "serve_test_uc"
    assert final["response"]["status"] == "completed"
    assert final["response"]["correlation_id"] == "cid-stream"


def test_tools_endpoint_phase3_pending() -> None:
    """GET /v1/tools surfaces the pack's allow-list with pending-phase-3 marker."""
    client = _boot_client(_DecoratedUseCase)
    resp = client.get("/v1/tools")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "pending-phase-3"
    names = sorted(t["name"] for t in body["tools"])
    assert names == ["lookup", "search"]


def test_trail_endpoint_returns_events() -> None:
    """GET /v1/trail/{cid} returns events tagged with that correlation_id."""
    _queue_reply(content="ok")
    client = _boot_client(_DecoratedUseCase)
    invoke = client.post(
        "/v1/invoke",
        json={
            "messages": [{"role": "user", "content": "trail me"}],
            "correlation_id": "cid-trail",
        },
    )
    assert invoke.status_code == 200, invoke.text

    resp = client.get("/v1/trail/cid-trail")
    assert resp.status_code == 200
    body = resp.json()
    events = body["events"]
    assert events, "expected at least one trail event for cid-trail"
    for event in events:
        assert event["correlation_id"] == "cid-trail"
    types = [e["event_type"] for e in events]
    assert types[0] == "invoke.start"
    assert types[-1] == "invoke.end"


def test_trail_endpoint_unknown_cid_empty() -> None:
    """Unknown correlation_id → empty list (not 404)."""
    client = _boot_client(_DecoratedUseCase)
    resp = client.get("/v1/trail/does-not-exist")
    assert resp.status_code == 200
    assert resp.json() == {"events": []}


def test_healthz_no_auth_required() -> None:
    """/healthz and /readyz both 200 without any auth header."""
    client = _boot_client(_DecoratedUseCase)
    h = client.get("/healthz")
    r = client.get("/readyz")
    assert h.status_code == 200
    assert r.status_code == 200
    assert h.json() == {"status": "ok"}
    assert r.json() == {"status": "ready"}


def test_info_endpoint_carries_pack_metadata() -> None:
    """/v1/info exposes slug, version, and the active pack identity."""
    client = _boot_client(_DecoratedUseCase)
    resp = client.get("/v1/info")
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == "serve_test_uc"
    assert body["version"] == "0.1.0"
    assert body["pack"] == "test-pack"
    assert body["pack_version"] == "0.1.0"


def test_mcp_server_handle_surfaces_public_methods() -> None:
    """The MCP server handle carries the decorated class's public methods."""
    client = _boot_client(_DecoratedUseCase)
    handle = client.app.state.serve_handle  # type: ignore[attr-defined]
    assert handle.mcp_server is not None
    assert handle.mcp_server.status == "pending-phase-3"
    assert "ping" in handle.mcp_server.tools
    assert handle.mcp_server.use_case_slug == "serve_test_uc"


def test_serve_requires_at_least_one_exposure() -> None:
    """Disabling both http and mcp is an error."""
    with pytest.raises(ValueError, match="requires at least one"):
        serve(
            _DecoratedUseCase,
            pack=_make_pack(),
            model_binding=_make_binding(),
            trail_sink=MemoryTrailSink(),
            http=False,
            mcp=False,
            block=False,
        )


def test_serve_rejects_undecorated_class_at_boot() -> None:
    """Undecorated use-case → TypeError at boot, before any HTTP traffic."""
    with pytest.raises(TypeError, match="not a @use_case"):
        serve(
            _UndecoratedUseCase,
            pack=_make_pack(),
            model_binding=_make_binding(),
            trail_sink=MemoryTrailSink(),
            block=False,
        )
