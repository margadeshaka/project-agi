# SPDX-License-Identifier: Apache-2.0
"""Fuzz test for claims-validated X-Pack dispatch.

Generates 100 random (header_pack, claim_tenant) pairs and asserts:

  * Every pair where header == claim returns 200 (and never leaks data
    intended for another tenant).
  * Every pair where header != claim returns 401 with
    ``pack_claim_mismatch``.
  * Missing header → 400. Missing token → 401.

Zero leaks past 401 is the non-negotiable invariant from RESOLVED_STACK R1.
"""

from __future__ import annotations

import random
import string
from dataclasses import dataclass
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from agi_runtime.main import create_app
from agi_runtime.middleware import dispatch as dispatch_mod


@dataclass
class _FakeClaims:
    sub: str
    tenant_id: str
    scopes: tuple[str, ...] = ("AGI_VIEWER",)


def _random_slug(rng: random.Random) -> str:
    return "".join(rng.choices(string.ascii_lowercase, k=rng.randint(4, 10)))


def _pairs(rng: random.Random, n: int) -> Iterator[tuple[str, str]]:
    for _ in range(n):
        a = _random_slug(rng)
        # 50/50 same vs different
        b = a if rng.random() < 0.5 else _random_slug(rng)
        yield (a, b)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """Build a TestClient with a fake claims verifier driven by the Bearer token.

    Bearer token format: ``tenant:<slug>`` — the fake verifier echoes it
    back as the tenant_id claim. This lets the test directly control the
    claim half of each fuzzed pair.
    """

    async def fake_verify(request):  # type: ignore[no-untyped-def]
        header = request.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "):
            raise dispatch_mod._AuthError(401, "missing_bearer", "no bearer")
        token = header.split(" ", 1)[1].strip()
        if not token.startswith("tenant:"):
            raise dispatch_mod._AuthError(401, "bad_token", "fake token format")
        tenant = token.split(":", 1)[1]
        return dispatch_mod._Claims(sub="fuzz", tenant_id=tenant, scopes=("AGI_VIEWER",))

    monkeypatch.setattr(dispatch_mod, "_verify_request_claims", fake_verify)
    app = create_app()
    with TestClient(app) as c:
        yield c


def test_health_passthrough(client: TestClient) -> None:
    assert client.get("/healthz").status_code == 200
    assert client.get("/readyz").status_code == 200


def test_missing_xpack_400(client: TestClient) -> None:
    resp = client.post(
        "/chat",
        json={"message": "hi"},
        headers={"Authorization": "Bearer tenant:acme"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "missing_x_pack"


def test_missing_token_401(client: TestClient) -> None:
    resp = client.post(
        "/chat",
        json={"message": "hi"},
        headers={"X-Pack": "acme"},
    )
    assert resp.status_code == 401


def test_fuzz_zero_leaks(client: TestClient) -> None:
    rng = random.Random(0xC0FFEE)
    leaks = 0
    matched = 0
    mismatched = 0
    for header_pack, claim_tenant in _pairs(rng, 100):
        resp = client.post(
            "/chat",
            json={"message": "hi"},
            headers={
                "X-Pack": header_pack,
                "Authorization": f"Bearer tenant:{claim_tenant}",
            },
        )
        if header_pack == claim_tenant:
            matched += 1
            assert resp.status_code == 200, (header_pack, claim_tenant, resp.text)
            body = resp.json()
            # The response must reflect the claim, never an arbitrary pack.
            assert body["pack"] == claim_tenant
        else:
            mismatched += 1
            if resp.status_code != 401:
                leaks += 1
            else:
                assert resp.json()["error"] == "pack_claim_mismatch"

    assert leaks == 0, f"{leaks} leaks across {mismatched} mismatched requests"
    # Sanity — we hit both halves of the distribution.
    assert matched > 0
    assert mismatched > 0
