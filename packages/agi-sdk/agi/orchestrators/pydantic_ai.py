# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.orchestrators.pydantic_ai`` — thin adapter over Pydantic AI.

Same shape and contract as the LangGraph adapter:

1. Set OTel baggage for the active pack/use-case.
2. Resolve the pack's tool allow-list to Pydantic-AI ``Tool`` instances.
3. (Phase 3) Provide a result-validation hook that calls a use-case's
   ``output_validator`` registry.

Heavy imports happen inside functions so importing this module never pulls
Pydantic AI into RAM.
"""

from __future__ import annotations

from typing import Any

from agi.config import Pack


class PydanticAINotInstalled(RuntimeError):
    """Raised when the ``[pydantic-ai]`` extra isn't installed."""


def _require_pydantic_ai() -> Any:
    """Import-or-raise. Used inside every public function so import is lazy."""
    try:
        import pydantic_ai  # type: ignore[import-not-found]
    except ImportError as exc:
        raise PydanticAINotInstalled(
            "agi.orchestrators.pydantic_ai requires the [pydantic-ai] extra. "
            "Install with: pip install 'agi-sdk[pydantic-ai]'"
        ) from exc
    return pydantic_ai


def set_pack_baggage(span_ctx: Any, pack: Pack) -> Any:
    """Attach ``bm.pack`` + ``bm.pack.version`` baggage to ``span_ctx``."""
    try:
        from opentelemetry import baggage, context  # type: ignore[import-not-found]
    except Exception:
        return None
    ctx = span_ctx if span_ctx is not None else context.get_current()
    ctx = baggage.set_baggage("bm.pack", pack.slug, context=ctx)
    ctx = baggage.set_baggage("bm.pack.version", pack.version, context=ctx)
    return ctx


def resolve_tools(pack: Pack, all_tools: list[Any]) -> list[Any]:
    """Filter Pydantic-AI ``Tool`` objects to the pack's ``tool_allowlist``.

    ``Tool`` objects in Pydantic-AI expose ``.name``; we match on that.
    Unknown names raise :class:`KeyError`.
    """
    if not pack.tool_allowlist:
        return list(all_tools)
    by_name = {getattr(t, "name", None): t for t in all_tools}
    missing = [name for name in pack.tool_allowlist if name not in by_name]
    if missing:
        raise KeyError(f"Pack {pack.slug!r} declares tools that aren't registered: {missing}")
    return [by_name[name] for name in pack.tool_allowlist if name in by_name]


def build_agent(*, model: str, pack: Pack, tools: list[Any] | None = None) -> Any:
    """Construct a Pydantic-AI ``Agent`` with pack-filtered tools.

    Phase 1 stub — Phase 3 will accept ``ModelBinding`` instead of a raw
    model string and wire LiteLLM as the runner.
    """
    pa = _require_pydantic_ai()
    filtered = resolve_tools(pack, tools or [])
    return pa.Agent(model, tools=filtered)


__all__ = [
    "PydanticAINotInstalled",
    "build_agent",
    "resolve_tools",
    "set_pack_baggage",
]
