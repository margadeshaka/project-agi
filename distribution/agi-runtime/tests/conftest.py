# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""Shared fixtures for the agi-runtime test suite.

Boots a TestClient with a fake claims verifier so individual tests don't have
to wire OIDC. Bearer-token format: ``tenant:<slug>[:<scope>,<scope>,...]``;
the fake verifier echoes ``<slug>`` as ``tenant_id`` and ``<scope,...>`` as
the scope tuple. This mirrors the format used by ``test_dispatch.py``.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

# Belt-and-suspenders: silence telemetry before any agi import wakes it up.
os.environ.setdefault("AGI_OTEL_DISABLED", "1")
os.environ.setdefault("AGI_DISABLE_TRACELOOP", "1")

from agi_runtime.main import create_app  # noqa: E402
from agi_runtime.middleware import dispatch as dispatch_mod  # noqa: E402


@pytest.fixture
def patched_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch the dispatch claim verifier with the bearer-token fake.

    Use directly in tests that need a configured TestClient — pair with the
    ``client`` factory fixture below.
    """

    async def fake_verify(request):  # type: ignore[no-untyped-def]
        header = request.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "):
            raise dispatch_mod._AuthError(401, "missing_bearer", "no bearer")
        token = header.split(" ", 1)[1].strip()
        if not token.startswith("tenant:"):
            raise dispatch_mod._AuthError(401, "bad_token", "fake token format")
        body = token.split(":", 1)[1]
        if ":" in body:
            tenant, scopes_raw = body.split(":", 1)
            scopes = tuple(s for s in scopes_raw.split(",") if s)
        else:
            tenant = body
            scopes = ("AGI_VIEWER",)
        return dispatch_mod._Claims(sub="test", tenant_id=tenant, scopes=scopes)

    monkeypatch.setattr(dispatch_mod, "_verify_request_claims", fake_verify)


@pytest.fixture
def client(patched_auth: None) -> Iterator[TestClient]:
    app = create_app()
    with TestClient(app) as c:
        yield c


def bearer_for(tenant: str, *scopes: str) -> str:
    """Return a fake bearer token that the conftest verifier accepts."""
    if scopes:
        return f"Bearer tenant:{tenant}:{','.join(scopes)}"
    return f"Bearer tenant:{tenant}"
