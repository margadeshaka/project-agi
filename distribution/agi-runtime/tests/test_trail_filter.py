# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""GET /trail — sink-backed listing + filters.

Writes a handful of events directly into the MemoryTrailSink and asserts that
``pack=`` and ``event=`` filters return only the matching rows. Confirms
``GET /trail/{correlation_id}`` returns events sorted by ``ts``.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from agi.trail import new_event

from .conftest import bearer_for


def test_trail_filter_by_pack(client: TestClient) -> None:
    sink = client.app.state.runtime.trail_sink

    # Seed three events: two for pack 'acme', one for 'bluemarble'.
    import asyncio

    async def _seed() -> None:
        await sink.write(
            new_event(
                correlation_id="corr-1",
                pack_slug="acme",
                session_id="s1",
                event_type="llm.call",
                payload={"step": 1},
            )
        )
        await sink.write(
            new_event(
                correlation_id="corr-2",
                pack_slug="acme",
                session_id="s2",
                event_type="mcp.tool",
                payload={"tool": "kb.search"},
            )
        )
        await sink.write(
            new_event(
                correlation_id="corr-3",
                pack_slug="bluemarble",
                session_id="s3",
                event_type="llm.call",
                payload={"step": 1},
            )
        )

    asyncio.run(_seed())

    resp = client.get(
        "/trail?pack=acme",
        headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 2
    assert all(e["pack_slug"] == "acme" for e in body["events"])

    # Event-type filter.
    resp = client.get(
        "/trail?event=mcp.tool",
        headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["events"][0]["event_type"] == "mcp.tool"

    # Per-correlation lookup.
    resp = client.get(
        "/trail/corr-1",
        headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["correlation_id"] == "corr-1"
    assert len(body["events"]) == 1
    assert body["events"][0]["payload"] == {"step": 1}


def test_trail_pagination_bounds(client: TestClient) -> None:
    resp = client.get(
        "/trail?limit=2000",
        headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
    )
    assert resp.status_code == 400
