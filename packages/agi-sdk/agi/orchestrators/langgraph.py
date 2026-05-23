# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.orchestrators.langgraph`` — thin adapter over LangGraph.

Job description (≤ ~150 LOC):

1. Set OTel baggage so spans emitted from within a LangGraph run carry
   ``bm.pack`` / ``bm.use_case`` / ``bm.tenant_id``.
2. Resolve the pack's tool allow-list to a filtered tool sequence the
   LangGraph node can pass to LiteLLM ``tools=...``.
3. Provide a ``CheckpointSaver`` factory honouring operator config.

The adapter does **not** wrap LangGraph state, nodes, or graphs. Use-cases
that adopt LangGraph use the upstream API directly; this module is the
boundary where SDK + LangGraph touch.

Heavy imports happen inside functions so importing this module never pulls
LangGraph into RAM.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from agi.config import Pack


class LangGraphNotInstalled(RuntimeError):
    """Raised when the ``[langgraph]`` extra isn't installed."""


def _require_langgraph() -> Any:
    """Import-or-raise. Used inside every public function so import is lazy."""
    try:
        import langgraph  # type: ignore[import-not-found]
    except ImportError as exc:
        raise LangGraphNotInstalled(
            "agi.orchestrators.langgraph requires the [langgraph] extra. "
            "Install with: pip install 'agi-sdk[langgraph]'"
        ) from exc
    return langgraph


def set_pack_baggage(span_ctx: Any, pack: Pack) -> Any:
    """Attach ``bm.pack`` + ``bm.use_case`` baggage to the current OTel context.

    Parameters
    ----------
    span_ctx:
        The OTel ``Context`` to overlay onto. Pass ``None`` to overlay on the
        currently-active context.
    pack:
        Active :class:`Pack`. Its ``slug`` becomes ``bm.pack``.

    Returns
    -------
    Context
        The new OTel context (or ``None`` if OTel isn't installed).
    """
    try:
        from opentelemetry import baggage, context  # type: ignore[import-not-found]
    except Exception:
        return None
    ctx = span_ctx if span_ctx is not None else context.get_current()
    ctx = baggage.set_baggage("bm.pack", pack.slug, context=ctx)
    ctx = baggage.set_baggage("bm.pack.version", pack.version, context=ctx)
    return ctx


def resolve_tools(pack: Pack, all_tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filter ``all_tools`` to the pack's ``tool_allowlist``.

    Tool dicts are expected in LiteLLM/OpenAI ``tools=[]`` schema —
    ``{"type": "function", "function": {"name": ...}}`` — and matched by name.
    Unknown names in the allow-list raise :class:`KeyError`.
    """
    if not pack.tool_allowlist:
        return list(all_tools)
    available = {t.get("function", {}).get("name"): t for t in all_tools if isinstance(t, dict)}
    missing = [name for name in pack.tool_allowlist if name not in available]
    if missing:
        raise KeyError(f"Pack {pack.slug!r} declares tools that aren't registered: {missing}")
    return [available[name] for name in pack.tool_allowlist if name in available]


def checkpoint_saver(operator_config: Any = None) -> Any:
    """Construct a LangGraph ``CheckpointSaver`` from operator config.

    Phase 1.5 default: a local SQLite-backed saver at
    ``${AGI_LANGGRAPH_CHECKPOINT_DB:-./.agi-cache/langgraph.sqlite3}`` when the
    optional ``langgraph-checkpoint-sqlite`` package is importable, otherwise
    an in-memory saver (``langgraph.checkpoint.memory.MemorySaver``) which is
    guaranteed-available with the base ``[langgraph]`` extra.

    Phase 3 will read ``operator_config.use_case['checkpointer']`` to pick
    Mongo / Postgres / SQLite explicitly; until then the default is sufficient
    for dev and single-pod use. ``operator_config`` is accepted for forward
    compatibility but currently unused.
    """
    _require_langgraph()
    try:
        from langgraph.checkpoint.sqlite import SqliteSaver  # type: ignore[import-not-found]
    except ImportError:
        from langgraph.checkpoint.memory import MemorySaver  # type: ignore[import-not-found]

        return MemorySaver()

    db_path = Path(os.environ.get("AGI_LANGGRAPH_CHECKPOINT_DB", "./.agi-cache/langgraph.sqlite3"))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return SqliteSaver.from_conn_string(str(db_path))


def compile_graph(graph: Any, *, pack: Pack, operator_config: Any = None) -> Any:
    """Compile a LangGraph ``StateGraph`` with the pack-aware checkpointer.

    Convenience wrapper that callers may use; not required.
    """
    _require_langgraph()
    if operator_config is None:
        return graph.compile()
    saver = checkpoint_saver(operator_config)
    return graph.compile(checkpointer=saver)


__all__ = [
    "LangGraphNotInstalled",
    "checkpoint_saver",
    "compile_graph",
    "resolve_tools",
    "set_pack_baggage",
]
