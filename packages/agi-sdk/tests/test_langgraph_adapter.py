# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Happy-path tests for ``agi.orchestrators.langgraph``.

The whole module is guarded by ``pytest.importorskip("langgraph")`` so the
suite skips cleanly when the optional extra (``agi-sdk[langgraph]``) is not
installed — the SDK must be usable without it.
"""

from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("langgraph")

from agi.config import Pack  # noqa: E402
from agi.orchestrators.langgraph import (  # noqa: E402
    checkpoint_saver,
    resolve_tools,
    set_pack_baggage,
)


def _pack(allow: list[str] | None = None) -> Pack:
    return Pack(slug="telco-demo", version="0.1.0", tool_allowlist=allow or [])


def test_set_pack_baggage_attaches_bm_keys() -> None:
    """``set_pack_baggage`` overlays ``bm.pack`` / ``bm.pack.version`` baggage.

    The adapter mirrors the OTel baggage convention used by ``native`` and
    ``pydantic_ai``; the runtime middleware separately sets ``bm.use_case``
    and ``bm.tenant_id`` per request.
    """
    opentelemetry = pytest.importorskip("opentelemetry")
    baggage = opentelemetry.baggage  # type: ignore[attr-defined]

    pack = _pack()
    ctx = set_pack_baggage(None, pack)
    assert ctx is not None, "expected an OTel Context, got None"
    assert baggage.get_baggage("bm.pack", ctx) == "telco-demo"
    assert baggage.get_baggage("bm.pack.version", ctx) == "0.1.0"


def test_resolve_tools_returns_allowlisted_names() -> None:
    pack = _pack(allow=["billing.refund", "kb.search"])
    available: list[dict[str, Any]] = [
        {"type": "function", "function": {"name": "billing.refund"}},
        {"type": "function", "function": {"name": "billing.escalate"}},
        {"type": "function", "function": {"name": "kb.search"}},
    ]
    resolved = resolve_tools(pack, available)
    assert [t["function"]["name"] for t in resolved] == ["billing.refund", "kb.search"]


def test_resolve_tools_empty_allowlist_passes_through() -> None:
    pack = _pack(allow=[])
    available: list[dict[str, Any]] = [
        {"type": "function", "function": {"name": "kb.search"}},
    ]
    assert resolve_tools(pack, available) == available


def test_checkpoint_saver_returns_non_none_default() -> None:
    """Default saver must be importable + constructible without operator config.

    When ``langgraph-checkpoint-sqlite`` is installed, this is a sqlite-backed
    saver; otherwise it falls back to the in-memory saver shipped with the
    base ``[langgraph]`` extra. Either way the result must be non-None and
    have the basic LangGraph saver shape.
    """
    saver = checkpoint_saver()
    assert saver is not None
    # Every LangGraph checkpoint saver exposes ``get`` / ``put`` (sync or async).
    assert hasattr(saver, "get") or hasattr(saver, "aget")
    assert hasattr(saver, "put") or hasattr(saver, "aput")
