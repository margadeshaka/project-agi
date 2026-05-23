# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.trail`` — audit sink interface.

AI-Trail is an **audit sink**, not a telemetry API (see
``RESOLVED_STACK.md``). Use-case authors do not call this directly. The OTel
collector pipes spans into a :class:`TrailSink`; the schema overlay is the
regulator-grade record.

This module defines the abstract sink + two in-process implementations
(``MemoryTrailSink``, ``FileJsonlTrailSink``). Mongo / Postgres sinks are
stubbed for Phase 3.

Event schema (one row / one document per event):
    {
        "ts": ISO-8601 timestamp,
        "correlation_id": str,
        "pack_slug": str,
        "session_id": str,
        "event_type": str,        # "llm.call" | "mcp.tool" | "rag.search" | "error" | ...
        "payload": dict,          # event-specific
    }
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict


class TrailEvent(TypedDict):
    """One row in the audit sink."""

    ts: str
    correlation_id: str
    pack_slug: str
    session_id: str
    event_type: str
    payload: dict[str, Any]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_event(
    *,
    correlation_id: str,
    pack_slug: str,
    session_id: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> TrailEvent:
    """Construct a :class:`TrailEvent` with ``ts`` filled in."""
    return TrailEvent(
        ts=_now_iso(),
        correlation_id=correlation_id,
        pack_slug=pack_slug,
        session_id=session_id,
        event_type=event_type,
        payload=payload or {},
    )


class TrailSink(ABC):
    """Abstract audit sink. Implementations persist :class:`TrailEvent`s."""

    @abstractmethod
    async def write(self, event: TrailEvent) -> None:
        """Persist one event. Implementations must be safe to call concurrently."""

    async def flush(self) -> None:
        """Flush any in-memory buffer. Default: no-op."""
        return None

    async def close(self) -> None:
        """Release resources. Default: no-op."""
        return None


class MemoryTrailSink(TrailSink):
    """In-memory sink — for tests and dev. Stores every event in a list."""

    def __init__(self) -> None:
        self.events: list[TrailEvent] = []

    async def write(self, event: TrailEvent) -> None:
        self.events.append(event)


class FileJsonlTrailSink(TrailSink):
    """Append-only JSON-Lines file sink — suitable for single-pod dev/staging."""

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)

    async def write(self, event: TrailEvent) -> None:
        line = json.dumps(event, ensure_ascii=False, default=str)
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")


class MongoTrailSink(TrailSink):
    """Mongo-backed sink. Stubbed; wired in Phase 3 with ``motor``."""

    def __init__(self, *, uri: str, collection: str) -> None:
        self._uri = uri
        self._collection = collection

    async def write(self, event: TrailEvent) -> None:
        raise NotImplementedError("TODO: implement with motor in Phase 3.")


class PostgresTrailSink(TrailSink):
    """Postgres-backed sink. Stubbed; wired in Phase 3 with ``asyncpg``."""

    def __init__(self, *, dsn: str, table: str = "ai_trail") -> None:
        self._dsn = dsn
        self._table = table

    async def write(self, event: TrailEvent) -> None:
        raise NotImplementedError("TODO: implement with asyncpg in Phase 3.")


__all__ = [
    "FileJsonlTrailSink",
    "MemoryTrailSink",
    "MongoTrailSink",
    "PostgresTrailSink",
    "TrailEvent",
    "TrailSink",
    "new_event",
]
