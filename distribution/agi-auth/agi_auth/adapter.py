# SPDX-License-Identifier: Apache-2.0
"""Auth adapter protocol — implemented by Keycloak / OIDC / static / dev-noop."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import BaseModel


class Claims(BaseModel):
    """Normalized claims surface used by every adapter."""

    sub: str
    tenant_id: str
    scopes: list[str] = []
    raw: dict | None = None


@runtime_checkable
class AuthAdapter(Protocol):
    """Minimal contract every adapter must satisfy."""

    async def verify_token(self, token: str) -> Claims:
        """Verify a bearer token and return normalized Claims. Raises on invalid."""
        ...

    def get_scopes(self, claims: Claims) -> list[str]:
        """Return the effective scopes for a claim (default = ``claims.scopes``)."""
        return claims.scopes
