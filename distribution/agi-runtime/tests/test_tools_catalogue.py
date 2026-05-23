# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""GET /tools — bundle-backed tool catalogue.

Builds a tiny generated bundle on disk, points the runtime at it, and
verifies:

  * ``GET /tools`` lists the descriptor.
  * ``GET /tools/{name}`` returns the input/output schema.
  * ``POST /tools/{name}`` is gated on the ``agi:dev`` scope.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from agi_runtime.main import create_app
from agi_runtime.middleware import dispatch as dispatch_mod
from agi_runtime.tool_bundles import BundleLoader

from .conftest import bearer_for


def _write_mini_bundle(root: Path) -> Path:
    """Write a single-tool MCPBundle to ``root`` and return the bundle dir."""
    bundle_dir = root / "billing-v4"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": "deadbeef",
        "source": "fixture",
        "generated_at": "2026-05-22T00:00:00Z",
        "source_api": "Billing_v4",
        "tool_count": 1,
        "extras": {},
    }
    (bundle_dir / "manifest.json").write_text(json.dumps(manifest))
    tools = [
        {
            "name": "billing.list_invoices",
            "domain": "billing",
            "description": "List invoices for a customer",
            "input_schema": {
                "type": "object",
                "properties": {"customer_id": {"type": "string"}},
                "required": ["customer_id"],
            },
            "output_schema": {"type": "object"},
            "side_effecting": False,
            "rate_limit_class": "read",
            "dry_run_supported": False,
            "method": "GET",
            "path_template": "/billing/v4/invoices",
            "param_locations": {"customer_id": "query"},
            "source_api": "Billing_v4",
            "source_operation": "listInvoices",
        }
    ]
    (bundle_dir / "tools.json").write_text(json.dumps(tools))
    return bundle_dir


def test_tools_listed_from_real_bundle(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _write_mini_bundle(tmp_path)

    async def fake_verify(request):  # type: ignore[no-untyped-def]
        header = request.headers.get("Authorization", "")
        token = header.split(" ", 1)[1].strip()
        body = token.split(":", 1)[1]
        if ":" in body:
            tenant, scopes_raw = body.split(":", 1)
            scopes = tuple(s for s in scopes_raw.split(",") if s)
        else:
            tenant, scopes = body, ("AGI_VIEWER",)
        return dispatch_mod._Claims(sub="t", tenant_id=tenant, scopes=scopes)

    monkeypatch.setattr(dispatch_mod, "_verify_request_claims", fake_verify)

    app = create_app()
    with TestClient(app) as c:
        # Replace the loader with one pointed at our fixture root.
        loader = BundleLoader(tmp_path)
        loader.load_all()
        app.state.runtime.bundle_loader = loader

        resp = c.get(
            "/tools",
            headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        names = [t["name"] for t in body["tools"]]
        assert "billing.list_invoices" in names

        resp = c.get(
            "/tools/billing.list_invoices",
            headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
        )
        assert resp.status_code == 200
        tool = resp.json()["tool"]
        assert tool["name"] == "billing.list_invoices"
        assert tool["input_schema"]["required"] == ["customer_id"]
        assert tool["side_effecting"] is False

        # Invoke without agi:dev → 403.
        resp = c.post(
            "/tools/billing.list_invoices",
            json={"customer_id": "C42"},
            headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
        )
        assert resp.status_code == 403

        # Invoke with agi:dev → 200, stub envelope returned.
        resp = c.post(
            "/tools/billing.list_invoices",
            json={"customer_id": "C42"},
            headers={
                "X-Pack": "acme",
                "Authorization": bearer_for("acme", "agi:dev"),
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["tool"] == "billing.list_invoices"
        assert body["result"]["ok"] is True
        assert body["result"]["stub"] is True


def test_unknown_tool_404(client: TestClient) -> None:
    resp = client.get(
        "/tools/does.not.exist",
        headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# _descriptor_summary fields (consumed by the FE tool catalogue table)
# ---------------------------------------------------------------------------


def _write_multi_bundle(root: Path) -> None:
    """Write a bundle with one read-only + one write tool for summary tests."""
    bundle_dir = root / "billing-v4"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": "ver-cafebabe",
        "source": "fixture",
        "generated_at": "2026-05-22T00:00:00Z",
        "source_api": "Billing_v4",
        "tool_count": 2,
        "extras": {},
    }
    (bundle_dir / "manifest.json").write_text(json.dumps(manifest))
    tools = [
        {
            "name": "billing.list_invoices",
            "domain": "billing",
            "description": "List invoices",
            "input_schema": {"type": "object", "properties": {}},
            "output_schema": None,
            "side_effecting": False,
            "rate_limit_class": "read",
            "dry_run_supported": False,
            "method": "GET",
            "path_template": "/billing/v4/invoices",
            "param_locations": {},
            "source_api": "Billing_v4",
            "source_operation": "listInvoices",
        },
        {
            "name": "billing.adjust_charge",
            "domain": "billing",
            "description": "Adjust a charge",
            "input_schema": {"type": "object", "properties": {}},
            "output_schema": None,
            "side_effecting": True,
            "rate_limit_class": "write_high",
            "dry_run_supported": True,
            "method": "POST",
            "path_template": "/billing/v4/charges/adjust",
            "param_locations": {},
            "source_api": "Billing_v4",
            "source_operation": "adjustCharge",
        },
    ]
    (bundle_dir / "tools.json").write_text(json.dumps(tools))


def _summary_client(tmp_path: Path, monkeypatch, *, allowlists: dict[str, list[str]]) -> TestClient:
    """Boot a TestClient with a real bundle + pre-seeded pack allow-lists."""
    from agi.config import Pack
    from agi_runtime.main import create_app
    from agi_runtime.tool_bundles import BundleLoader

    _write_multi_bundle(tmp_path)

    async def fake_verify(request):  # type: ignore[no-untyped-def]
        header = request.headers.get("Authorization", "")
        token = header.split(" ", 1)[1].strip()
        body = token.split(":", 1)[1]
        if ":" in body:
            tenant, scopes_raw = body.split(":", 1)
            scopes = tuple(s for s in scopes_raw.split(",") if s)
        else:
            tenant, scopes = body, ("AGI_VIEWER",)
        return dispatch_mod._Claims(sub="t", tenant_id=tenant, scopes=scopes)

    monkeypatch.setattr(dispatch_mod, "_verify_request_claims", fake_verify)
    app = create_app()
    c = TestClient(app)
    c.__enter__()
    loader = BundleLoader(tmp_path)
    loader.load_all()
    app.state.runtime.bundle_loader = loader
    for slug, allow in allowlists.items():
        app.state.runtime.pack_loader._cache[slug] = Pack(  # noqa: SLF001
            slug=slug,
            version="1.0.0",
            name=slug.title(),
            tool_allowlist=allow,
            metadata={},
        )
        app.state.runtime.pack_loader._shas[slug] = f"sha-{slug}"  # noqa: SLF001
    return c


def test_descriptor_summary_includes_bundle_version(tmp_path: Path, monkeypatch) -> None:
    c = _summary_client(tmp_path, monkeypatch, allowlists={"acme": []})
    try:
        resp = c.get(
            "/tools",
            headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
        )
        assert resp.status_code == 200, resp.text
        tools = resp.json()["tools"]
        for t in tools:
            assert "bundle_version" in t
            assert t["bundle_version"] == "ver-cafebabe"
    finally:
        c.__exit__(None, None, None)


def test_descriptor_summary_includes_consuming_pack_count(tmp_path: Path, monkeypatch) -> None:
    c = _summary_client(
        tmp_path,
        monkeypatch,
        allowlists={
            "acme": ["billing.list_invoices"],
            "beta": ["billing.list_invoices", "billing.adjust_charge"],
            "gamma": [],
        },
    )
    try:
        resp = c.get(
            "/tools",
            headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
        )
        assert resp.status_code == 200, resp.text
        by_name = {t["name"]: t for t in resp.json()["tools"]}
        # billing.list_invoices is allow-listed by acme + beta → 2.
        assert by_name["billing.list_invoices"]["consuming_pack_count"] == 2
        # billing.adjust_charge only by beta → 1.
        assert by_name["billing.adjust_charge"]["consuming_pack_count"] == 1
    finally:
        c.__exit__(None, None, None)


def test_descriptor_summary_includes_dry_run_supported(tmp_path: Path, monkeypatch) -> None:
    c = _summary_client(tmp_path, monkeypatch, allowlists={"acme": []})
    try:
        resp = c.get(
            "/tools",
            headers={"X-Pack": "acme", "Authorization": bearer_for("acme")},
        )
        assert resp.status_code == 200, resp.text
        by_name = {t["name"]: t for t in resp.json()["tools"]}
        # write tool with explicit dry-run flag → True.
        assert by_name["billing.adjust_charge"]["dry_run_supported"] is True
        # read tool — descriptor sets ``False`` explicitly, summary should
        # surface ``True`` because read-only tools are trivially dry-runnable.
        assert by_name["billing.list_invoices"]["dry_run_supported"] is True
    finally:
        c.__exit__(None, None, None)
