# SPDX-License-Identifier: Apache-2.0
"""Claims-validated X-Pack dispatch middleware.

This middleware is the single enforcement point for project-agi's multi-tenant
isolation guarantee (RESOLVED_STACK Decision R1). On every non-health request:

  1. The ``X-Pack`` header MUST be present. Missing → HTTP 400.
  2. The caller's bearer token is verified by the configured auth adapter
     (agi-auth). Missing/invalid → HTTP 401.
  3. The ``tenant_id`` claim in the verified token MUST equal the requested
     pack slug. Mismatch → HTTP 401. **Header-only trust is never permitted.**
  4. The resolved Pack object is attached to ``request.state.pack`` for
     downstream handlers.

Pack-group-per-pod is the default: one runtime process can serve multiple
packs whose tenant claims match the verified token. Hardening mode (single
pack per pod, ``AGI_HARDEN=1``) is enforced here by rejecting any pack slug
that doesn't equal ``AGI_HARDEN_PACK``.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

_HEALTH_PATHS = frozenset({"/healthz", "/readyz", "/", "/openapi.json", "/docs", "/redoc"})


@dataclass
class Pack:
    """Lightweight pack handle attached to request.state during dispatch.

    The full Pack object lives in agi-sdk; this is the minimal view the
    runtime needs for dispatch + downstream handler access.
    """

    slug: str
    tenant_id: str


class XPackDispatchMiddleware(BaseHTTPMiddleware):
    """Enforce ``X-Pack`` header + claim consistency on every non-health request."""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self._harden = os.environ.get("AGI_HARDEN") == "1"
        self._harden_pack = os.environ.get("AGI_HARDEN_PACK", "")

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[JSONResponse]],
    ) -> JSONResponse:
        # Generate / propagate correlation_id for the whole request lifecycle.
        correlation_id = request.headers.get("X-Correlation-Id") or str(uuid.uuid4())
        request.state.correlation_id = correlation_id

        if request.url.path in _HEALTH_PATHS or request.url.path.startswith("/static"):
            response = await call_next(request)
            response.headers["X-Correlation-Id"] = correlation_id
            return response

        pack_slug = request.headers.get("X-Pack")
        if not pack_slug:
            return JSONResponse(
                {"error": "missing_x_pack", "message": "X-Pack header is required"},
                status_code=400,
                headers={"X-Correlation-Id": correlation_id},
            )

        # Verify token via auth adapter.
        try:
            claims = await _verify_request_claims(request)
        except _AuthError as exc:
            return JSONResponse(
                {"error": exc.code, "message": exc.message},
                status_code=exc.status,
                headers={"X-Correlation-Id": correlation_id},
            )

        # Hardening mode: only one pack permitted per pod.
        if self._harden and pack_slug != self._harden_pack:
            return JSONResponse(
                {
                    "error": "harden_mode_rejected",
                    "message": "this pod serves a single pack",
                },
                status_code=401,
                headers={"X-Correlation-Id": correlation_id},
            )

        # Claims-based dispatch — header MUST match tenant claim.
        if claims.tenant_id != pack_slug:
            return JSONResponse(
                {
                    "error": "pack_claim_mismatch",
                    "message": "X-Pack header does not match authenticated tenant claim",
                },
                status_code=401,
                headers={"X-Correlation-Id": correlation_id},
            )

        request.state.pack = Pack(slug=pack_slug, tenant_id=claims.tenant_id)
        request.state.claims = claims

        response = await call_next(request)
        response.headers["X-Correlation-Id"] = correlation_id
        return response


# ---- internal auth shim ---------------------------------------------------
# agi-auth provides the real adapters; tests can monkeypatch
# ``_verify_request_claims`` to inject a fake claim without touching the
# middleware's enforcement code.


class _AuthError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status = status
        self.code = code
        self.message = message


@dataclass
class _Claims:
    sub: str
    tenant_id: str
    scopes: tuple[str, ...]


async def _verify_request_claims(request: Request) -> _Claims:
    """Verify the bearer token from ``Authorization`` and return its claims.

    This is a thin shim over agi-auth so dispatch logic stays unit-testable
    without spinning up an OIDC adapter. In production, the configured
    adapter (Keycloak / OIDC / static-token / dev-noop) is invoked.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise _AuthError(401, "missing_bearer", "Authorization: Bearer <token> required")
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        raise _AuthError(401, "empty_token", "bearer token is empty")

    try:
        from agi_auth import resolve_adapter  # type: ignore[import-not-found]

        adapter = resolve_adapter()
        claims = await adapter.verify_token(token)
        return _Claims(
            sub=claims.sub,
            tenant_id=claims.tenant_id,
            scopes=tuple(claims.scopes),
        )
    except _AuthError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _AuthError(401, "token_verification_failed", str(exc)) from exc
