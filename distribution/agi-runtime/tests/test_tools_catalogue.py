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
