# SPDX-License-Identifier: Apache-2.0
"""Dev-noop adapter — accepts any token, returns max-scope claims.

**Refuses to construct when ``AGI_ENV=production``.** This is the only thing
between a misconfigured deployment and an open-door runtime, so the check
runs at construction (not at first verify) and cannot be bypassed by
late env overrides.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from agi_auth.adapter import Claims


class DevNoopRefusedInProductionError(RuntimeError):
    """Raised if a dev-noop adapter is instantiated when AGI_ENV=production."""


@dataclass
class DevNoopAdapter:
    """No-op auth — never use outside dev/CI."""

    tenant_id: str = "dev"
    sub: str = "dev-user"
    scopes: tuple[str, ...] = ("AGI_ADMIN", "AGI_DEVELOPER", "AGI_VIEWER")

    def __post_init__(self) -> None:
        env = os.environ.get("AGI_ENV", "dev").lower()
        if env == "production":
            raise DevNoopRefusedInProductionError(
                "DevNoopAdapter refuses to start when AGI_ENV=production. "
                "Configure AGI_AUTH=keycloak (or another real adapter)."
            )

    async def verify_token(self, token: str) -> Claims:  # noqa: ARG002 — token ignored by design
        return Claims(
            sub=self.sub,
            tenant_id=self.tenant_id,
            scopes=list(self.scopes),
        )

    def get_scopes(self, claims: Claims) -> list[str]:
        return claims.scopes
