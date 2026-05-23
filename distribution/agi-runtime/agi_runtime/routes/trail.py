# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""AI Trail audit log — read-only inspection.

Backed by whichever :class:`agi.trail.TrailSink` the runtime is configured
with. The default :class:`agi.trail.MemoryTrailSink` lets unit tests exercise
the filter logic without a real store; production deployments swap in
``FileJsonlTrailSink`` (set ``AGI_TRAIL_FILE``) or a Mongo/Postgres sink
once those land.

Filters:

- ``pack``  — only events whose ``pack_slug`` matches.
- ``event`` — only events whose ``event_type`` equals.
- ``from``  — ISO-8601 lower bound on ``ts``.
- ``to``    — ISO-8601 upper bound on ``ts``.

Pagination uses ``limit`` (default 100, max 1000) and ``offset``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from agi.trail import FileJsonlTrailSink, MemoryTrailSink, TrailEvent, TrailSink
from fastapi import APIRouter, HTTPException, Request

from agi_runtime.state import RuntimeState

router = APIRouter(tags=["trail"])


@router.get("/trail")
async def list_trail(
    request: Request,
    pack: str | None = None,
    event: str | None = None,
    from_: str | None = None,
    to: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Paginated list of trail events with optional filters.

    Note: ``from_`` is bound from the ``from`` query string parameter (Python
    keyword collision); FastAPI handles the alias when the routing layer sees
    the trailing underscore.
    """
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be 1..1000")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")

    # Resolve ``from`` → ``from_`` so the public API stays clean.
    if from_ is None:
        from_ = request.query_params.get("from")

    runtime: RuntimeState = request.app.state.runtime
    events = await _read_all_events(runtime.trail_sink)
    filtered = [
        e
        for e in events
        if (pack is None or e["pack_slug"] == pack)
        and (event is None or e["event_type"] == event)
        and (from_ is None or e["ts"] >= from_)
        and (to is None or e["ts"] <= to)
    ]
    page = filtered[offset : offset + limit]
    return {
        "pack": request.state.pack.slug,
        "total": len(filtered),
        "limit": limit,
        "offset": offset,
        "events": page,
    }


@router.get("/trail/{correlation_id}")
async def get_trail(correlation_id: str, request: Request) -> dict[str, Any]:
    """All events for one ``correlation_id``, sorted by ``ts`` ascending."""
    runtime: RuntimeState = request.app.state.runtime
    events = await _read_all_events(runtime.trail_sink)
    matched = [e for e in events if e["correlation_id"] == correlation_id]
    matched.sort(key=lambda e: e["ts"])
    return {
        "pack": request.state.pack.slug,
        "correlation_id": correlation_id,
        "events": matched,
    }


async def _read_all_events(sink: TrailSink) -> list[TrailEvent]:
    """Snapshot helper — read every event currently in the configured sink."""
    if isinstance(sink, MemoryTrailSink):
        return list(sink.events)
    if isinstance(sink, FileJsonlTrailSink):
        path = Path(sink._path)  # noqa: SLF001 — read-only access to file path
        if not path.exists():
            return []
        out: list[TrailEvent] = []
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return out
    # Mongo/Postgres sinks — once those land, route through their own readers.
    return []
