# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for ``agi.dispatch`` — the shared serve()/runtime seam.

The seam is HTTP- and MCP-agnostic; these tests drive it directly with the
same fake LiteLLM module used by ``test_native_orchestrator`` so we exercise
the orchestrator path end-to-end without network or provider credentials.

Match the fixture style of ``test_native_orchestrator.py``: inject a fake
``litellm`` module into ``sys.modules`` *before* importing anything that pulls
in :mod:`agi.orchestrators.native`, then build the seam's inputs with the
same light fake collaborators (``_FakeBinding``, ``_FakePack``, ``_FakeMCP``).
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest


# ---------------------------------------------------------------------------
# Fake litellm — injected before import
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
# Important: do NOT overwrite an already-injected ``litellm.acompletion`` at
# module-import time — ``test_native_orchestrator.py`` installs its own fake
# and relies on it during its own tests. We install our fake only while our
# own tests are running, via the autouse fixture below.


# Now safe to import the seam + its dependencies.
from agi.config import Pack  # noqa: E402
from agi.dispatch import (  # noqa: E402
    InvokeMessage,
    InvokeRequest,
    InvokeResponse,
    invoke_use_case,
    stream_use_case,
)
from agi.models import ModelBinding  # noqa: E402
from agi.trail import MemoryTrailSink  # noqa: E402
from agi.use_case import use_case  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures / fakes
# ---------------------------------------------------------------------------


def _queue_reply(
    content: str | None = None, tool_calls: list[dict[str, Any]] | None = None
) -> None:
    msg: dict[str, Any] = {"content": content, "tool_calls": tool_calls or None}
    _scripted_replies.append(_FakeResponse([_FakeChoice(msg)]))


@pytest.fixture(autouse=True)
def _reset_fakes() -> Any:
    """Install our scripted ``acompletion`` for the duration of one test, then
    restore whatever was there before. Keeps sibling test files (notably
    ``test_native_orchestrator.py``, which installs its own fake) untouched."""
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


def _make_binding() -> ModelBinding:
    return ModelBinding(role="reasoning", model_id="openai/gpt-4o-mini")


def _make_pack(slug: str = "telco-demo") -> Pack:
    return Pack(slug=slug, version="0.1.0")


@use_case("dispatch_test_uc", "0.1.0")
class _DecoratedUseCase:
    """Tiny decorated use-case stand-in.

    The seam only reads slug/version off the class — it never instantiates the
    class today. (When ``serve()`` later instantiates use-case classes, the
    seam will receive a constructed instance via a separate facade arg.)
    """


class _UndecoratedUseCase:
    """A class missing @use_case — invoke_use_case must reject it."""


def _make_request(message: str = "hello", *, stream: bool = False) -> InvokeRequest:
    return InvokeRequest(
        messages=[InvokeMessage(role="user", content=message)],
        stream=stream,
    )


# ---------------------------------------------------------------------------
# invoke_use_case
# ---------------------------------------------------------------------------


async def test_invoke_use_case_happy_path() -> None:
    """A decorated use-case + scripted text reply returns a 200-equivalent envelope."""
    _queue_reply(content="hi back")
    sink = MemoryTrailSink()
    response = await invoke_use_case(
        use_case_cls=_DecoratedUseCase,
        pack=_make_pack(),
        request=_make_request("hello"),
        model_binding=_make_binding(),
        available_tools={},
        trail_sink=sink,
        correlation_id="cid-happy",
        tenant_id="t-happy",
        session_id="sess-1",
    )
    assert isinstance(response, InvokeResponse)
    assert response.status == "completed"
    assert response.response == "hi back"
    assert response.use_case == "dispatch_test_uc"
    assert response.use_case_version == "0.1.0"
    assert response.pack == "telco-demo"
    assert response.correlation_id == "cid-happy"
    assert response.tenant_id == "t-happy"
    assert response.session_id == "sess-1"
    assert response.error is None
    # Trail saw start + at least one orchestrator event (llm.call) + end.
    event_types = [e["event_type"] for e in sink.events]
    assert event_types[0] == "invoke.start"
    assert event_types[-1] == "invoke.end"
    assert "llm.call" in event_types
    assert response.trail_event_count == len(sink.events)


async def test_invoke_undecorated_class_raises() -> None:
    """Calling the seam with an undecorated class is a clear, blunt TypeError."""
    sink = MemoryTrailSink()
    with pytest.raises(TypeError, match="not decorated with @agi.use_case"):
        await invoke_use_case(
            use_case_cls=_UndecoratedUseCase,
            pack=_make_pack(),
            request=_make_request(),
            model_binding=_make_binding(),
            available_tools={},
            trail_sink=sink,
            correlation_id="cid-undec",
            tenant_id="t-undec",
        )
    # Validation must short-circuit before any envelope event lands.
    assert sink.events == []


async def test_invoke_trail_envelope_event_ids() -> None:
    """Both ``invoke.start`` and ``invoke.end`` land in the sink, with metadata."""
    _queue_reply(content="ok")
    sink = MemoryTrailSink()
    response = await invoke_use_case(
        use_case_cls=_DecoratedUseCase,
        pack=_make_pack(slug="fleet-demo"),
        request=_make_request("ping"),
        model_binding=_make_binding(),
        available_tools={},
        trail_sink=sink,
        correlation_id="cid-env",
        tenant_id="t-env",
        session_id="sess-env",
    )
    starts = [e for e in sink.events if e["event_type"] == "invoke.start"]
    ends = [e for e in sink.events if e["event_type"] == "invoke.end"]
    assert len(starts) == 1
    assert len(ends) == 1
    start = starts[0]
    end = ends[0]
    assert start["correlation_id"] == "cid-env"
    assert start["pack_slug"] == "fleet-demo"
    assert start["session_id"] == "sess-env"
    assert start["payload"]["use_case"] == "dispatch_test_uc"
    assert start["payload"]["version"] == "0.1.0"
    assert start["payload"]["tenant_id"] == "t-env"
    assert start["payload"]["request"]["message_count"] == 1
    assert end["payload"]["status"] == "completed"
    assert end["payload"]["run_id"] == response.run_id
    assert end["payload"]["error"] is None


async def test_invoke_legacy_message_field_accepted() -> None:
    """Back-compat: ``{"message": "..."}`` short-hand still works."""
    _queue_reply(content="legacy ok")
    sink = MemoryTrailSink()
    response = await invoke_use_case(
        use_case_cls=_DecoratedUseCase,
        pack=_make_pack(),
        request=InvokeRequest(message="legacy hello"),
        model_binding=_make_binding(),
        available_tools={},
        trail_sink=sink,
        correlation_id="cid-legacy",
        tenant_id="t-legacy",
    )
    assert response.status == "completed"
    assert response.response == "legacy ok"


async def test_invoke_empty_messages_raises() -> None:
    """No messages → ValueError, before any envelope event lands."""
    sink = MemoryTrailSink()
    with pytest.raises(ValueError, match="no messages"):
        await invoke_use_case(
            use_case_cls=_DecoratedUseCase,
            pack=_make_pack(),
            request=InvokeRequest(),
            model_binding=_make_binding(),
            available_tools={},
            trail_sink=sink,
            correlation_id="cid-empty",
            tenant_id="t-empty",
        )
    assert sink.events == []


async def test_invoke_request_use_case_mismatch_raises() -> None:
    """``request.use_case`` must match the class's stamped slug (no cross dispatch)."""
    _queue_reply(content="unreached")
    sink = MemoryTrailSink()
    with pytest.raises(ValueError, match="does not match"):
        await invoke_use_case(
            use_case_cls=_DecoratedUseCase,
            pack=_make_pack(),
            request=InvokeRequest(
                messages=[InvokeMessage(role="user", content="hi")],
                use_case="some_other_uc",
            ),
            model_binding=_make_binding(),
            available_tools={},
            trail_sink=sink,
            correlation_id="cid-mismatch",
            tenant_id="t-mismatch",
        )


# ---------------------------------------------------------------------------
# stream_use_case
# ---------------------------------------------------------------------------


async def test_stream_use_case_yields_invoke_end_last() -> None:
    """The async iterator must terminate with one ``invoke.end`` row carrying
    the serialised :class:`InvokeResponse` payload."""
    chunks = [
        {"choices": [{"delta": {"content": "Hel"}, "finish_reason": None}]},
        {"choices": [{"delta": {"content": "lo"}, "finish_reason": None}]},
        {"choices": [{"delta": {"content": "!"}, "finish_reason": "stop"}]},
    ]
    _scripted_stream_chunks.extend(chunks)

    sink = MemoryTrailSink()
    iterator = await stream_use_case(
        use_case_cls=_DecoratedUseCase,
        pack=_make_pack(),
        request=_make_request("stream me", stream=True),
        model_binding=_make_binding(),
        available_tools={},
        trail_sink=sink,
        correlation_id="cid-stream",
        tenant_id="t-stream",
        session_id="sess-stream",
    )
    drained: list[dict[str, Any]] = []
    async for row in iterator:
        drained.append(row)

    assert drained, "stream_use_case produced no rows"
    assert drained[0]["event_type"] == "invoke.start"
    assert drained[-1]["event_type"] == "invoke.end"
    final = drained[-1]
    assert "response" in final
    response_payload = final["response"]
    assert response_payload["use_case"] == "dispatch_test_uc"
    assert response_payload["status"] == "completed"
    assert response_payload["response"] == "Hello!"
    assert response_payload["correlation_id"] == "cid-stream"

    # Sink saw both envelope events too — the stream re-emits the start as a
    # row but the trail copy is the canonical audit record.
    sink_types = [e["event_type"] for e in sink.events]
    assert sink_types[0] == "invoke.start"
    assert sink_types[-1] == "invoke.end"


async def test_stream_undecorated_class_raises() -> None:
    """``stream_use_case`` validates the @use_case stamp just like the non-stream path."""
    sink = MemoryTrailSink()
    iterator = await stream_use_case(
        use_case_cls=_UndecoratedUseCase,
        pack=_make_pack(),
        request=_make_request(stream=True),
        model_binding=_make_binding(),
        available_tools={},
        trail_sink=sink,
        correlation_id="cid-stream-undec",
        tenant_id="t-stream-undec",
    )
    with pytest.raises(TypeError, match="not decorated"):
        async for _ in iterator:
            pass
    assert sink.events == []
