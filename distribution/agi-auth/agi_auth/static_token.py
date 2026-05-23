# SPDX-License-Identifier: Apache-2.0
"""Static-token adapter — single hard-coded bearer ⇄ claims. Dev/CI only."""

from __future__ import annotations

import os
from dataclasses import dataclass

from agi_auth.adapter import Claims


class StaticTokenError(Exception):
    """Raised when static token verification fails."""


@dataclass
class StaticTokenAdapter:
    """One bearer token, one claims set. Useful for fixtures and CI runs."""

    token: str
    claims: Claims

    @classmethod
    def from_env(cls) -> "StaticTokenAdapter":
        token = os.environ.get("AGI_STATIC_TOKEN")
        tenant = os.environ.get("AGI_STATIC_TENANT")
        sub = os.environ.get("AGI_STATIC_SUB", "static-user")
        scopes = os.environ.get("AGI_STATIC_SCOPES", "AGI_VIEWER").split(",")
        if not token or not tenant:
            raise StaticTokenError(
                "AGI_STATIC_TOKEN and AGI_STATIC_TENANT must be set for static adapter"
            )
        return cls(
            token=token,
            claims=Claims(sub=sub, tenant_id=tenant, scopes=[s.strip() for s in scopes if s]),
        )

    async def verify_token(self, token: str) -> Claims:
        if token != self.token:
            raise StaticTokenError("static token mismatch")
        return self.claims

    def get_scopes(self, claims: Claims) -> list[str]:
        return claims.scopes
