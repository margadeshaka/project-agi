# SPDX-License-Identifier: Apache-2.0
"""/healthz and /readyz behavior."""

from __future__ import annotations

from fastapi.testclient import TestClient

from agi_runtime.main import create_app


def test_healthz_200() -> None:
    with TestClient(create_app()) as c:
        resp = c.get("/healthz")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


def test_readyz_200_with_degraded_when_deps_absent() -> None:
    """In a bare test env none of the optional deps are configured;
    readyz must still return 200 and enumerate the missing components."""
    with TestClient(create_app()) as c:
        resp = c.get("/readyz")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] in {"ready", "degraded"}
        assert "checks" in body
        # At least one component is degraded in a vanilla CI env.
        if body["status"] == "degraded":
            assert isinstance(body["degraded"], list)
            assert len(body["degraded"]) > 0
