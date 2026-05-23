# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""Admin console GET endpoints — packs list/detail, users, settings, llm providers.

These are the read-only endpoints consumed by the agi-ui shell (Console
FR-PACK, FR-AUTH, FR-ADM, FR-LLM). All five require ``X-Pack`` + a valid
bearer to clear the dispatch middleware; scope gating is per-endpoint.

The fixture pattern mirrors ``test_chat_end_to_end.py``: patch the claims
verifier with a bearer-token fake, then seed ``app.state.runtime`` with
in-memory packs, model bindings, and trail events.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from agi.config import Pack
from agi.trail import MemoryTrailSink, new_event
from agi_runtime.config import ModelBindingConfig
from agi_runtime.main import create_app
from agi_runtime.middleware import dispatch as dispatch_mod
from agi_runtime.state import RuntimeState


def _bearer(tenant: str, *scopes: str) -> str:
    if scopes:
        return f"Bearer tenant:{tenant}:{','.join(scopes)}"
    return f"Bearer tenant:{tenant}"


def _hdr(tenant: str, *scopes: str) -> dict[str, str]:
    return {"X-Pack": tenant, "Authorization": _bearer(tenant, *scopes)}


def _seed_pack(
    state: RuntimeState,
    slug: str,
    *,
    version: str = "1.0.0",
    name: str | None = None,
    declared_roles: list[str] | None = None,
    tool_allowlist: list[str] | None = None,
    metadata: dict | None = None,
    kb_dir: Path | None = None,
) -> None:
    """Inject a fully-formed :class:`Pack` into the loader cache."""
    pack = Pack(
        slug=slug,
        version=version,
        name=name or slug.title(),
        declared_model_roles=declared_roles or ["reasoning", "fast"],
        tool_allowlist=tool_allowlist or [],
        prompts_dir=None,
        kb_dir=kb_dir,
        metadata=metadata or {},
    )
    state.pack_loader._cache[slug] = pack  # noqa: SLF001 — direct seed
    state.pack_loader._shas[slug] = f"sha-{slug}"  # noqa: SLF001


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """TestClient with bearer-token-driven claims and pre-seeded packs."""

    async def fake_verify(request):  # type: ignore[no-untyped-def]
        header = request.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "):
            raise dispatch_mod._AuthError(401, "missing_bearer", "no bearer")
        token = header.split(" ", 1)[1].strip()
        if not token.startswith("tenant:"):
            raise dispatch_mod._AuthError(401, "bad_token", "fake token")
        body = token.split(":", 1)[1]
        if ":" in body:
            tenant, scopes_raw = body.split(":", 1)
            scopes = tuple(s for s in scopes_raw.split(",") if s)
        else:
            tenant, scopes = body, ()
        return dispatch_mod._Claims(sub=f"user-{tenant}", tenant_id=tenant, scopes=scopes)

    monkeypatch.setattr(dispatch_mod, "_verify_request_claims", fake_verify)
    # Keep AGI_ENV in a known state so the LLM-providers endpoint stays hermetic.
    monkeypatch.setenv("AGI_ENV", "test")

    app = create_app()
    with TestClient(app) as c:
        state: RuntimeState = app.state.runtime
        # Ensure a clean memory sink so activity counts are deterministic.
        state.trail_sink = MemoryTrailSink()
        _seed_pack(
            state,
            "telco-demo",
            version="2.0.0",
            name="Telco Demo",
            declared_roles=["reasoning", "fast", "extractor"],
            tool_allowlist=["billing.adjust_charge", "billing.list_invoices"],
            metadata={
                "vertical": "telco",
                "theme": {
                    "primary": "#0066CC",
                    "secondary": "#003366",
                    "accent": "#FF9900",
                    "mode": "light",
                },
                "scenarios": ["deflect", "resolve"],
                "system_prompt": "You are a telco assistant.",
            },
        )
        _seed_pack(
            state,
            "fleet-demo",
            version="1.0.0",
            name="Fleet Demo",
            declared_roles=["reasoning"],
            tool_allowlist=["fleet.list_vehicles"],
            metadata={"vertical": "logistics"},
        )
        # Seed model bindings so /admin/llm/providers has something to group.
        state.config.models["reasoning"] = ModelBindingConfig(
            role="reasoning", model_id="openai/gpt-4o"
        )
        state.config.models["fast"] = ModelBindingConfig(role="fast", model_id="ollama/llama3.2")
        yield c


# ---------------------------------------------------------------------------
# /admin/packs
# ---------------------------------------------------------------------------


def test_packs_list_returns_loaded_packs(configured: TestClient) -> None:
    # admin sees both
    resp = configured.get("/admin/packs", headers=_hdr("telco-demo", "agi:admin"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    slugs = {p["slug"] for p in body["packs"]}
    assert slugs == {"telco-demo", "fleet-demo"}
    assert body["count"] == 2
    # Shape contract
    sample = next(p for p in body["packs"] if p["slug"] == "telco-demo")
    for key in (
        "slug",
        "name",
        "display_name",
        "version",
        "vertical",
        "theme",
        "updated_at",
    ):
        assert key in sample
    assert sample["theme"]["primary"] == "#0066CC"
    assert sample["vertical"] == "telco"


def test_packs_list_operator_403(configured: TestClient) -> None:
    """Operators don't enumerate peer packs — /admin/whoami carries their slug."""
    resp = configured.get(
        "/admin/packs",
        headers=_hdr("telco-demo", "agi:operator:telco-demo"),
    )
    assert resp.status_code == 403


def test_packs_list_no_scope_403(configured: TestClient) -> None:
    resp = configured.get("/admin/packs", headers=_hdr("telco-demo"))
    assert resp.status_code == 403


def test_packs_list_viewer_403(configured: TestClient) -> None:
    """Viewers don't enumerate the pack catalogue at the platform level."""
    resp = configured.get(
        "/admin/packs",
        headers=_hdr("telco-demo", "agi:viewer"),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# /admin/packs/{slug}
# ---------------------------------------------------------------------------


def test_packs_detail_404_unknown_slug(configured: TestClient) -> None:
    resp = configured.get(
        "/admin/packs/ghost",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 404


def test_packs_detail_returns_role_bindings_and_allowed_tools(
    configured: TestClient,
) -> None:
    resp = configured.get(
        "/admin/packs/telco-demo",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Required keys from the contract.
    for key in (
        "slug",
        "name",
        "version",
        "metadata",
        "models",
        "theme",
        "role_bindings",
        "allowed_tools",
        "kb",
        "scenarios",
        "activity_24h",
    ):
        assert key in body, f"missing key {key}"
    assert body["slug"] == "telco-demo"
    assert "billing.adjust_charge" in body["allowed_tools"]
    assert body["role_bindings"]["system_prompt"] == "You are a telco assistant."
    assert "reasoning" in body["models"]
    assert body["scenarios"] == ["deflect", "resolve"]
    assert body["activity_24h"] == {"chats": 0, "tool_calls": 0, "errors": 0}


def test_packs_detail_operator_blocked_on_other_pack(configured: TestClient) -> None:
    # operator for fleet-demo can't read telco-demo's detail. Their X-Pack
    # has to match their own claim, so we hit the endpoint via fleet-demo
    # and request the telco-demo slug in-path.
    resp = configured.get(
        "/admin/packs/telco-demo",
        headers=_hdr("fleet-demo", "agi:operator:fleet-demo"),
    )
    assert resp.status_code == 403


def test_packs_detail_counts_recent_activity(configured: TestClient) -> None:
    """Memory sink events for the slug feed activity_24h."""
    import asyncio

    sink = configured.app.state.runtime.trail_sink

    async def seed() -> None:
        await sink.write(
            new_event(
                correlation_id="c1",
                pack_slug="telco-demo",
                session_id="s",
                event_type="llm.call",
                payload={},
            )
        )
        await sink.write(
            new_event(
                correlation_id="c2",
                pack_slug="telco-demo",
                session_id="s",
                event_type="mcp.tool",
                payload={},
            )
        )
        await sink.write(
            new_event(
                correlation_id="c3",
                pack_slug="telco-demo",
                session_id="s",
                event_type="error",
                payload={},
            )
        )

    asyncio.run(seed())
    resp = configured.get(
        "/admin/packs/telco-demo",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 200
    assert resp.json()["activity_24h"] == {"chats": 1, "tool_calls": 1, "errors": 1}


# ---------------------------------------------------------------------------
# /admin/users
# ---------------------------------------------------------------------------


def test_users_admin_only(configured: TestClient) -> None:
    # viewer → 403
    resp = configured.get(
        "/admin/users",
        headers=_hdr("telco-demo", "agi:viewer"),
    )
    assert resp.status_code == 403
    # operator → 403
    resp = configured.get(
        "/admin/users",
        headers=_hdr("telco-demo", "agi:operator:telco-demo"),
    )
    assert resp.status_code == 403
    # admin → 200
    resp = configured.get(
        "/admin/users",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 200


def test_users_returns_synthetic_user_dev_noop(configured: TestClient) -> None:
    resp = configured.get(
        "/admin/users",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["count"] == 1
    assert body["source"] == "synthetic-from-bearer"
    user = body["users"][0]
    assert user["subject"] == "user-telco-demo"
    assert "agi:admin" in user["scopes"]
    assert user["tenant_id"] == "telco-demo"


# ---------------------------------------------------------------------------
# /admin/settings
# ---------------------------------------------------------------------------


def test_settings_admin_only(configured: TestClient) -> None:
    resp = configured.get(
        "/admin/settings",
        headers=_hdr("telco-demo", "agi:viewer"),
    )
    assert resp.status_code == 403
    resp = configured.get(
        "/admin/settings",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 200


def test_settings_includes_version_and_env(configured: TestClient) -> None:
    resp = configured.get(
        "/admin/settings",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 200, resp.text
    settings = resp.json()["settings"]
    for key in (
        "version",
        "env",
        "auth_mode",
        "otel_endpoint",
        "langfuse_url",
        "trail_sink_type",
        "trail_sink_path",
        "hardening_mode",
        "hot_reload_enabled",
    ):
        assert key in settings, f"missing key {key}"
    assert settings["env"] == "test"
    assert settings["trail_sink_type"] == "memory"
    assert settings["trail_sink_path"] is None
    assert settings["hardening_mode"] is False
    assert isinstance(settings["version"], str) and settings["version"]


# ---------------------------------------------------------------------------
# /admin/use-cases
# ---------------------------------------------------------------------------


def _seed_use_cases(state: RuntimeState) -> None:
    """Mutate the pre-seeded telco/fleet packs so they declare ``use_cases``."""
    telco = state.pack_loader.get("telco-demo")
    fleet = state.pack_loader.get("fleet-demo")
    assert telco is not None and fleet is not None
    # bill_explainer lives on both packs (same name+version) — must aggregate.
    telco.metadata["use_cases"] = [
        {
            "name": "bill_explainer",
            "version": "0.3.0",
            "tools": ["billing.list_invoices", "billing.adjust_charge", "billing.suspend_line"],
        },
        {
            "name": "deflect",
            "version": "1.0.0",
            "tools": ["faq.lookup"],
        },
    ]
    fleet.metadata["use_cases"] = [
        {
            "name": "bill_explainer",
            "version": "0.3.0",
            "tools": ["billing.list_invoices", "billing.adjust_charge"],
        },
        {
            "name": "route_incident",
            "version": "0.2.0",
            "tools": ["fleet.list_vehicles", "fleet.flag_incident"],
        },
    ]


def test_use_cases_returns_flat_service_list(configured: TestClient) -> None:
    """Response is ``{use_cases: [...], langfuse_url}`` — not the legacy
    ``{pack, packs: [...]}`` shape the FE never consumed."""
    _seed_use_cases(configured.app.state.runtime)
    resp = configured.get(
        "/admin/use-cases",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "use_cases" in body and isinstance(body["use_cases"], list)
    assert "langfuse_url" in body
    # Shape: every row carries the keys the FE ToolSummary-shaped use-case row needs.
    for row in body["use_cases"]:
        for key in ("name", "version", "packs", "health", "tool_count"):
            assert key in row, f"missing key {key} in {row}"
        assert all(isinstance(p, dict) and "slug" in p for p in row["packs"])
        assert row["health"] == "ok"


def test_use_cases_aggregates_across_packs(configured: TestClient) -> None:
    """A use-case offered by N packs becomes a single row with len(packs)=N."""
    _seed_use_cases(configured.app.state.runtime)
    resp = configured.get(
        "/admin/use-cases",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    body = resp.json()
    rows_by_name = {(r["name"], r["version"]): r for r in body["use_cases"]}
    bill = rows_by_name[("bill_explainer", "0.3.0")]
    pack_slugs = {p["slug"] for p in bill["packs"]}
    assert pack_slugs == {"telco-demo", "fleet-demo"}
    # tool_count is the max declared across packs — telco lists 3 tools.
    assert bill["tool_count"] == 3
    # Use-cases on a single pack stay single-row.
    deflect = rows_by_name[("deflect", "1.0.0")]
    assert [p["slug"] for p in deflect["packs"]] == ["telco-demo"]
    assert deflect["tool_count"] == 1


def test_use_cases_includes_langfuse_url_when_configured(
    configured: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_use_cases(configured.app.state.runtime)
    monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.example.com")
    resp = configured.get(
        "/admin/use-cases",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.json()["langfuse_url"] == "https://langfuse.example.com"

    monkeypatch.delenv("LANGFUSE_HOST", raising=False)
    monkeypatch.delenv("AGI_LANGFUSE_URL", raising=False)
    resp = configured.get(
        "/admin/use-cases",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.json()["langfuse_url"] is None


def test_use_cases_operator_filtered(configured: TestClient) -> None:
    """``agi:operator:<slug>`` only sees use-cases offered by their own pack."""
    _seed_use_cases(configured.app.state.runtime)
    resp = configured.get(
        "/admin/use-cases",
        headers=_hdr("fleet-demo", "agi:operator:fleet-demo"),
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()["use_cases"]
    names = {r["name"] for r in rows}
    # fleet-demo only — telco-only ``deflect`` must not leak in.
    assert "deflect" not in names
    # bill_explainer appears (fleet declares it) but only fleet-demo in packs.
    bill = next(r for r in rows if r["name"] == "bill_explainer")
    assert [p["slug"] for p in bill["packs"]] == ["fleet-demo"]
    assert "route_incident" in names


def test_use_cases_admin_sees_all(configured: TestClient) -> None:
    """Admin and viewer both see every use-case across every loaded pack."""
    _seed_use_cases(configured.app.state.runtime)
    for scope in ("agi:admin", "agi:viewer"):
        resp = configured.get(
            "/admin/use-cases",
            headers=_hdr("telco-demo", scope),
        )
        assert resp.status_code == 200, resp.text
        rows = resp.json()["use_cases"]
        names = {r["name"] for r in rows}
        assert names == {"bill_explainer", "deflect", "route_incident"}, scope
    # Bare caller without any qualifying scope → 403.
    resp = configured.get(
        "/admin/use-cases",
        headers=_hdr("telco-demo"),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# /admin/llm/providers
# ---------------------------------------------------------------------------


def test_llm_providers_returns_ready_in_test_env(configured: TestClient) -> None:
    resp = configured.get(
        "/admin/llm/providers",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["probed"] is False
    kinds = {p["kind"] for p in body["providers"]}
    assert "openai" in kinds
    assert "ollama" in kinds
    for p in body["providers"]:
        assert p["status"] == "ready"
        assert p["last_checked_at"]
        assert isinstance(p["configured_models"], list) and p["configured_models"]
        assert isinstance(p["primary_for_roles"], list) and p["primary_for_roles"]
    # viewer also allowed
    resp = configured.get(
        "/admin/llm/providers",
        headers=_hdr("telco-demo", "agi:viewer"),
    )
    assert resp.status_code == 200
    # bare caller → 403
    resp = configured.get(
        "/admin/llm/providers",
        headers=_hdr("telco-demo"),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# /admin/kb/{slug}/reindex — JSON (sync) + SSE progress stream
# ---------------------------------------------------------------------------


def _parse_sse_events(body: str) -> list[tuple[str, dict]]:
    """Tiny SSE parser: turn the raw body into ``[(event_name, data_dict), ...]``."""
    import json as _json

    out: list[tuple[str, dict]] = []
    event_name = "message"
    data_lines: list[str] = []
    for line in body.split("\n"):
        if line == "":
            if data_lines:
                try:
                    payload = _json.loads("\n".join(data_lines))
                except _json.JSONDecodeError:
                    payload = {}
                out.append((event_name, payload))
            event_name = "message"
            data_lines = []
            continue
        if line.startswith("event:"):
            event_name = line[len("event:") :].strip()
        elif line.startswith("data:"):
            data_lines.append(line[len("data:") :].strip())
    return out


def test_reindex_json_default_response(configured: TestClient) -> None:
    """Regression: no ``Accept: text/event-stream`` → legacy synchronous JSON."""
    resp = configured.post(
        "/admin/kb/telco-demo/reindex",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pack"] == "telco-demo"
    assert body["reindex_queued"] is True
    assert body["correlation_id"]
    # Shape stays byte-for-byte stable — no SSE-only fields leaking into JSON.
    assert set(body.keys()) == {"pack", "reindex_queued", "correlation_id"}


def test_reindex_json_with_application_json_accept(configured: TestClient) -> None:
    """``Accept: application/json`` still routes to the sync JSON envelope."""
    resp = configured.post(
        "/admin/kb/telco-demo/reindex",
        headers={
            **_hdr("telco-demo", "agi:admin"),
            "Accept": "application/json",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reindex_queued"] is True


def test_reindex_sse_emits_start_progress_complete(configured: TestClient) -> None:
    """SSE path emits a ``start``, one+ ``progress``, and one ``complete``."""
    headers = {
        **_hdr("telco-demo", "agi:admin"),
        "Accept": "text/event-stream",
    }
    with configured.stream(
        "POST",
        "/admin/kb/telco-demo/reindex",
        headers=headers,
    ) as resp:
        assert resp.status_code == 200, resp.read().decode()
        assert "text/event-stream" in resp.headers["content-type"]
        body = resp.read().decode("utf-8")

    events = _parse_sse_events(body)
    names = [name for name, _ in events]
    assert "start" in names, names
    assert names.count("progress") >= 1, names
    assert names[-1] == "complete", names

    start = next(payload for name, payload in events if name == "start")
    assert start["slug"] == "telco-demo"
    assert start["started_iso"]

    progress = [payload for name, payload in events if name == "progress"]
    assert progress[0]["percent"] == 0
    assert progress[-1]["percent"] == 100
    for tick in progress:
        assert tick["slug"] == "telco-demo"
        assert "articles_done" in tick
        assert "articles_total" in tick
        # FE kb-browser.tsx reads ``progress`` directly off the data line.
        assert isinstance(tick["progress"], int)

    complete = next(payload for name, payload in events if name == "complete")
    assert complete["slug"] == "telco-demo"
    assert complete["completed_iso"]
    assert "articles_indexed" in complete
    assert complete["correlation_id"]
    # FE also checks ``done`` to fire its success toast.
    assert complete["done"] is True


def test_reindex_sse_non_admin_403(configured: TestClient) -> None:
    """Viewer / operator / bare-caller all 403 — consistent with the JSON path."""
    for scope_args in (
        ("agi:viewer",),
        ("agi:operator:telco-demo",),
        (),
    ):
        resp = configured.post(
            "/admin/kb/telco-demo/reindex",
            headers={
                **_hdr("telco-demo", *scope_args),
                "Accept": "text/event-stream",
            },
        )
        assert resp.status_code == 403, f"scope={scope_args} got {resp.status_code}"


def test_reindex_sse_unknown_pack_emits_error_event_or_500(configured: TestClient) -> None:
    """Decision: unknown pack returns 404 BEFORE the stream opens.

    The alternative is to open the stream then emit a single ``event: error``
    frame — but mid-stream errors are harder for the FE SSE reader to surface
    (kb-browser.tsx is inside its ``while (true) reader.read()`` loop when the
    frame would arrive). A pre-stream 404 lets the FE's ``catch`` branch hit
    ``RuntimeError`` and toast normally, matching how every other admin
    endpoint reports missing packs. This test pins that contract.
    """
    resp = configured.post(
        "/admin/kb/ghost-pack/reindex",
        headers={
            **_hdr("telco-demo", "agi:admin"),  # X-Pack must match the bearer tenant
            "Accept": "text/event-stream",
        },
    )
    assert resp.status_code == 404, resp.text
    detail = resp.json().get("detail", "")
    assert "ghost-pack" in detail


def test_reindex_writes_admin_log_event(configured: TestClient) -> None:
    """``_log_admin`` still fires for both JSON and SSE paths; ``sse`` flag distinguishes."""
    sink = configured.app.state.runtime.admin_sink
    before = len(getattr(sink, "events", []))

    # JSON path
    configured.post(
        "/admin/kb/telco-demo/reindex",
        headers=_hdr("telco-demo", "agi:admin"),
    )
    # SSE path (drain stream so the generator completes)
    with configured.stream(
        "POST",
        "/admin/kb/telco-demo/reindex",
        headers={
            **_hdr("telco-demo", "agi:admin"),
            "Accept": "text/event-stream",
        },
    ) as resp:
        resp.read()

    events = list(getattr(sink, "events", []))[before:]
    kb_events = [e for e in events if e.get("event_type") == "admin.kb_reindex"]
    assert len(kb_events) >= 2
    sse_flags = sorted(e["payload"]["sse"] for e in kb_events)
    assert sse_flags == [False, True]
