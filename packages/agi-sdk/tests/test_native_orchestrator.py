# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for ``agi.orchestrators.native``.

LiteLLM and MCP are stubbed via fakes so these tests run without network or
real provider credentials. The fakes match the surface the orchestrator
actually depends on, no more.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path
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


_fake_litellm = types.ModuleType("litellm")
_fake_litellm.acompletion = _fake_acompletion  # type: ignore[attr-defined]
sys.modules["litellm"] = _fake_litellm


# Now safe to import the orchestrator.
from agi.orchestrators.native import (  # noqa: E402
    CheckpointNotFoundError,
    FileJsonlCheckpointStore,
    MemoryCheckpointStore,
    Message,
    Orchestrator,
    OrchestratorError,
    Run,
    ToolNotAllowedError,
    resolve_tools,
    run_use_case,
    set_run_baggage,
)
from agi.trail import MemoryTrailSink  # noqa: E402


# ---------------------------------------------------------------------------
# Light fakes for SDK collaborators
# ---------------------------------------------------------------------------


class _FakePack:
    """Stand-in matching the real Pack model's tool_allowlist / tool_denylist."""

    def __init__(
        self,
        slug: str = "care-demo",
        allow: list[str] | None = None,
        deny: list[str] | None = None,
    ) -> None:
        self.slug = slug
        self.tool_allowlist: list[str] = allow or []
        self.tool_denylist: list[str] = deny or []


class _FakeBinding:
    def __init__(self, model_id: str = "openai/gpt-4o-mini") -> None:
        self.model_id = model_id

    def kwargs(self, **overrides: Any) -> dict[str, Any]:
        out: dict[str, Any] = {"model": self.model_id}
        out.update({k: v for k, v in overrides.items() if v is not None})
        return out


class _FakeToolClient:
    def __init__(self, name: str, calls: list[tuple[str, dict[str, Any]]]) -> None:
        self._name = name
        self._calls = calls

    async def call(self, **kwargs: Any) -> dict[str, Any]:
        self._calls.append((self._name, kwargs))
        return {"ok": True, "tool": self._name, "args": kwargs}


class _FakeMCP:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def tool(self, name: str) -> _FakeToolClient:
        return _FakeToolClient(name, self.calls)


def _make_run(*, max_steps: int = 5, user: str = "hello") -> Run:
    return Run(
        correlation_id="cid-test",
        pack_slug="care-demo",
        use_case_slug="bill_explainer",
        use_case_version="0.1.0",
        tenant_id="t-1",
        messages=[Message(role="user", content=user)],
        max_steps=max_steps,
    )


def _queue_reply(
    content: str | None = None, tool_calls: list[dict[str, Any]] | None = None
) -> None:
    msg: dict[str, Any] = {"content": content, "tool_calls": tool_calls or None}
    _scripted_replies.append(_FakeResponse([_FakeChoice(msg)]))


@pytest.fixture(autouse=True)
def _reset_fakes() -> None:
    _call_log.clear()
    _scripted_replies.clear()
    _scripted_stream_chunks.clear()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_set_run_baggage_shape() -> None:
    run = _make_run()
    bag = set_run_baggage(run)
    assert bag["bm.pack"] == "care-demo"
    assert bag["bm.use_case"] == "bill_explainer"
    assert bag["bm.run_id"] == run.run_id
    assert bag["bm.tenant_id"] == "t-1"


def test_resolve_tools_allow_list() -> None:
    pack = _FakePack(allow=["billing.refund", "kb.search"])
    available = [
        {"type": "function", "function": {"name": "billing.refund"}},
        {"type": "function", "function": {"name": "billing.escalate"}},
        {"type": "function", "function": {"name": "kb.search"}},
    ]
    resolved = resolve_tools(pack, available)
    names = [t["function"]["name"] for t in resolved]
    assert names == ["billing.refund", "kb.search"]


def test_resolve_tools_deny_list_wins() -> None:
    pack = _FakePack(deny=["billing.refund"])
    available = [
        {"type": "function", "function": {"name": "billing.refund"}},
        {"type": "function", "function": {"name": "kb.search"}},
    ]
    resolved = resolve_tools(pack, available)
    assert [t["function"]["name"] for t in resolved] == ["kb.search"]


@pytest.mark.asyncio
async def test_step_completes_on_text_reply() -> None:
    _queue_reply(content="The bill total is $42.")
    orch = Orchestrator(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=_FakeMCP(),  # type: ignore[arg-type]
        pack=_FakePack(),  # type: ignore[arg-type]
    )
    run = _make_run()
    run = await orch.step(run)
    assert run.status == "completed"
    assert run.result == {"reply": "The bill total is $42."}
    assert run.step == 1
    assert any(m.role == "assistant" and m.content for m in run.messages)


@pytest.mark.asyncio
async def test_step_dispatches_tool_call_then_completes() -> None:
    _queue_reply(
        tool_calls=[
            {
                "id": "tc-1",
                "function": {
                    "name": "billing.refund",
                    "arguments": json.dumps({"amount": 12.5}),
                },
            }
        ]
    )
    _queue_reply(content="Refund issued.")
    mcp = _FakeMCP()
    orch = Orchestrator(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=mcp,  # type: ignore[arg-type]
        pack=_FakePack(allow=["billing.refund"]),  # type: ignore[arg-type]
        available_tools=[{"type": "function", "function": {"name": "billing.refund"}}],
    )
    run = _make_run()
    run = await orch.run_until_done(run)
    assert run.status == "completed"
    assert mcp.calls == [("billing.refund", {"amount": 12.5})]
    # tool result must appear between the assistant turn and the final assistant
    roles = [m.role for m in run.messages]
    assert roles == ["user", "assistant", "tool", "assistant"]


@pytest.mark.asyncio
async def test_step_rejects_tool_not_in_allow_list() -> None:
    _queue_reply(
        tool_calls=[
            {
                "id": "tc-1",
                "function": {
                    "name": "billing.escalate",
                    "arguments": json.dumps({}),
                },
            }
        ]
    )
    orch = Orchestrator(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=_FakeMCP(),  # type: ignore[arg-type]
        pack=_FakePack(allow=["billing.refund"]),  # type: ignore[arg-type]
        available_tools=[{"type": "function", "function": {"name": "billing.refund"}}],
    )
    run = _make_run()
    with pytest.raises(ToolNotAllowedError):
        await orch.step(run)


@pytest.mark.asyncio
async def test_step_budget_failure_status() -> None:
    # Reply forever with a tool call so the run never completes naturally.
    for _ in range(10):
        _queue_reply(
            tool_calls=[
                {
                    "id": f"tc-{_}",
                    "function": {"name": "kb.search", "arguments": "{}"},
                }
            ]
        )
    orch = Orchestrator(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=_FakeMCP(),  # type: ignore[arg-type]
        pack=_FakePack(allow=["kb.search"]),  # type: ignore[arg-type]
        available_tools=[{"type": "function", "function": {"name": "kb.search"}}],
    )
    run = _make_run(max_steps=3)
    run = await orch.run_until_done(run)
    assert run.status == "failed"
    assert run.error is not None and "step budget" in run.error


@pytest.mark.asyncio
async def test_pause_and_resume_roundtrip() -> None:
    _queue_reply(content="back to work")
    store = MemoryCheckpointStore()
    orch = Orchestrator(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=_FakeMCP(),  # type: ignore[arg-type]
        pack=_FakePack(),  # type: ignore[arg-type]
        checkpoint_store=store,
    )
    run = _make_run()
    run = await orch.pause(run, reason="awaiting human approval")
    assert run.status == "paused"
    assert run.pause_reason == "awaiting human approval"
    resumed = await orch.resume(run.run_id)
    assert resumed.status == "running"
    assert resumed.pause_reason is None


@pytest.mark.asyncio
async def test_resume_missing_run_raises() -> None:
    orch = Orchestrator(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=_FakeMCP(),  # type: ignore[arg-type]
        pack=_FakePack(),  # type: ignore[arg-type]
    )
    with pytest.raises(CheckpointNotFoundError):
        await orch.resume("run-nope")


@pytest.mark.asyncio
async def test_resume_refuses_non_paused() -> None:
    store = MemoryCheckpointStore()
    orch = Orchestrator(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=_FakeMCP(),  # type: ignore[arg-type]
        pack=_FakePack(),  # type: ignore[arg-type]
        checkpoint_store=store,
    )
    run = _make_run()
    run.status = "running"
    await store.save(run)
    with pytest.raises(OrchestratorError):
        await orch.resume(run.run_id)


@pytest.mark.asyncio
async def test_file_jsonl_checkpoint_store_roundtrip(tmp_path: Path) -> None:
    store = FileJsonlCheckpointStore(tmp_path)
    run = _make_run()
    await store.save(run)
    run.step = 3
    run.touch()
    await store.save(run)
    reloaded = await store.load(run.run_id)
    assert reloaded is not None
    assert reloaded.step == 3
    assert reloaded.run_id == run.run_id
    assert reloaded.correlation_id == "cid-test"


@pytest.mark.asyncio
async def test_trail_sink_writes_per_step() -> None:
    _queue_reply(content="done")
    sink = MemoryTrailSink()
    orch = Orchestrator(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=_FakeMCP(),  # type: ignore[arg-type]
        pack=_FakePack(),  # type: ignore[arg-type]
        trail_sink=sink,
    )
    run = _make_run()
    await orch.step(run)
    assert any(e["event_type"] == "llm.call" for e in sink.events)


@pytest.mark.asyncio
async def test_run_use_case_end_to_end() -> None:
    _queue_reply(content="Hi there.")
    run = await run_use_case(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=_FakeMCP(),  # type: ignore[arg-type]
        pack=_FakePack(),  # type: ignore[arg-type]
        use_case_slug="greeter",
        use_case_version="1.0.0",
        correlation_id="cid-greet",
        tenant_id=None,
        session_id="sess-1",
        user_message="hello",
        system_prompt="be brief",
    )
    assert run.status == "completed"
    assert run.result == {"reply": "Hi there."}
    # System prompt + user + assistant
    assert [m.role for m in run.messages] == ["system", "user", "assistant"]


@pytest.mark.asyncio
async def test_streaming_completes_and_persists() -> None:
    # Streaming chunks shape: {"choices": [{"delta": {"content": "..."}, "finish_reason": None}]}
    chunks = [
        {"choices": [{"delta": {"content": "Hel"}, "finish_reason": None}]},
        {"choices": [{"delta": {"content": "lo"}, "finish_reason": None}]},
        {"choices": [{"delta": {"content": "!"}, "finish_reason": "stop"}]},
    ]
    _scripted_stream_chunks.extend(chunks)
    store = MemoryCheckpointStore()
    orch = Orchestrator(
        binding=_FakeBinding(),  # type: ignore[arg-type]
        mcp=_FakeMCP(),  # type: ignore[arg-type]
        pack=_FakePack(),  # type: ignore[arg-type]
        checkpoint_store=store,
    )
    run = _make_run()
    collected: list[str] = []
    async for chunk in orch.stream(run):
        if chunk["delta"]:
            collected.append(chunk["delta"])
    assert "".join(collected) == "Hello!"
    saved = await store.load(run.run_id)
    assert saved is not None
    assert saved.status == "completed"
    assert saved.result == {"reply": "Hello!"}
