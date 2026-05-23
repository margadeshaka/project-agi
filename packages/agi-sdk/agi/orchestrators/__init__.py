# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.orchestrators`` — built-in plus blessed adapters.

Three orchestration paths ship in the SDK:

- ``native`` — **built-in**, always available. Multi-step tool loop, pluggable
  checkpoint store, HITL ``pause``/``resume``, streaming. No external
  orchestration framework dependency. Use for multi-step tool flows when you
  want zero-LC-types and zero-framework-gravity.
- ``langgraph`` (extra ``[langgraph]``) — durable checkpointing, HITL,
  streaming, full graph state-machine.
- ``pydantic_ai`` (extra ``[pydantic-ai]``) — type-first, Pydantic-native.

The blessed externals stay ~150 LOC adapter each — they set OpenLLMetry
baggage and resolve the active pack's tool allow-list. The ``native``
orchestrator is owned in-tree; it depends only on what ``agi-sdk`` already
imports (LiteLLM, MCP, Pydantic, OpenTelemetry).

Default for new use-cases is still **plain ``async def`` + Pydantic state**.
``native`` is the next step up when plain async isn't enough but you don't
want a heavyweight orchestrator.

Importing this module never imports the optional frameworks; the
``langgraph`` and ``pydantic_ai`` submodules import lazily inside their
functions. When an extra isn't installed, the attribute resolves to ``None``
— callers should guard.
"""

from __future__ import annotations

from importlib import import_module
from types import ModuleType

from agi.orchestrators import native as native  # always available


def _try_import(name: str) -> ModuleType | None:
    """Best-effort import of an optional-extra adapter submodule.

    Returns ``None`` if the optional dependency or its adapter shim isn't
    installed. Callers must guard for ``None`` before use.
    """
    try:
        return import_module(f"agi.orchestrators.{name}")
    except Exception:
        return None


langgraph: ModuleType | None = _try_import("langgraph")
pydantic_ai: ModuleType | None = _try_import("pydantic_ai")

__all__ = ["langgraph", "native", "pydantic_ai"]
