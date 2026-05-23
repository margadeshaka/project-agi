# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Happy-path tests for ``agi.orchestrators.pydantic_ai``.

Guarded by ``pytest.importorskip("pydantic_ai")`` so the suite skips cleanly
when the ``agi-sdk[pydantic-ai]`` extra is not installed.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic_ai")

from agi.config import Pack  # noqa: E402
from agi.orchestrators.pydantic_ai import resolve_tools, set_pack_baggage  # noqa: E402


def _pack(allow: list[str] | None = None) -> Pack:
    return Pack(slug="care-demo", version="0.1.0", tool_allowlist=allow or [])


class _FakeTool:
    """Minimal stand-in for ``pydantic_ai.Tool`` — only ``.name`` is read."""

    def __init__(self, name: str) -> None:
        self.name = name


def test_set_pack_baggage_attaches_bm_keys() -> None:
    opentelemetry = pytest.importorskip("opentelemetry")
    baggage = opentelemetry.baggage  # type: ignore[attr-defined]

    pack = _pack()
    ctx = set_pack_baggage(None, pack)
    assert ctx is not None
    assert baggage.get_baggage("bm.pack", ctx) == "care-demo"
    assert baggage.get_baggage("bm.pack.version", ctx) == "0.1.0"


def test_resolve_tools_returns_allowlisted_in_order() -> None:
    pack = _pack(allow=["billing.refund", "kb.search"])
    tools = [_FakeTool("billing.refund"), _FakeTool("billing.escalate"), _FakeTool("kb.search")]
    resolved = resolve_tools(pack, tools)
    assert [t.name for t in resolved] == ["billing.refund", "kb.search"]


def test_resolve_tools_unknown_name_raises_keyerror() -> None:
    pack = _pack(allow=["does.not.exist"])
    with pytest.raises(KeyError):
        resolve_tools(pack, [_FakeTool("kb.search")])


def test_resolve_tools_empty_allowlist_passes_through() -> None:
    pack = _pack(allow=[])
    tools = [_FakeTool("kb.search")]
    assert resolve_tools(pack, tools) == tools
