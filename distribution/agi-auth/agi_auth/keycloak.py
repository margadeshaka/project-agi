# SPDX-License-Identifier: Apache-2.0
"""Keycloak reference adapter — JWKS-based JWT validation."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from jose import jwt
from jose.exceptions import JWTError

from agi_auth.adapter import Claims


class KeycloakAdapterError(Exception):
    """Raised when token verification fails."""


@dataclass
class _JwksCache:
    keys: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: float = 0.0
    ttl: float = 300.0  # seconds


@dataclass
class KeycloakAdapter:
    """Keycloak (and any OIDC-compliant) JWT verifier.

    Configurable via env or kwargs:

      * ``issuer`` — full URL, e.g. ``https://kc.example.com/realms/agi``
      * ``audience`` — expected ``aud`` claim
      * ``tenant_claim`` — JWT claim name carrying the tenant slug
        (default ``tenant_id``)
      * ``jwks_url`` — JWKS endpoint (auto-derived from ``issuer``)
    """

    issuer: str
    audience: str | None = None
    tenant_claim: str = "tenant_id"
    jwks_url: str | None = None
    _cache: _JwksCache = field(default_factory=_JwksCache)

    @classmethod
    def from_env(cls) -> "KeycloakAdapter":
        issuer = os.environ.get("AGI_OIDC_ISSUER")
        if not issuer:
            raise KeycloakAdapterError("AGI_OIDC_ISSUER not set")
        return cls(
            issuer=issuer,
            audience=os.environ.get("AGI_OIDC_AUDIENCE") or None,
            tenant_claim=os.environ.get("AGI_OIDC_TENANT_CLAIM", "tenant_id"),
            jwks_url=os.environ.get("AGI_OIDC_JWKS_URL") or None,
        )

    async def _get_jwks(self) -> list[dict[str, Any]]:
        if self._cache.keys and (time.time() - self._cache.fetched_at) < self._cache.ttl:
            return self._cache.keys

        url = self.jwks_url or f"{self.issuer.rstrip('/')}/protocol/openid-connect/certs"
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        keys = data.get("keys", [])
        if not keys:
            raise KeycloakAdapterError(f"JWKS at {url} returned no keys")
        self._cache.keys = keys
        self._cache.fetched_at = time.time()
        return keys

    async def verify_token(self, token: str) -> Claims:
        try:
            unverified_header = jwt.get_unverified_header(token)
        except JWTError as exc:
            raise KeycloakAdapterError(f"malformed JWT: {exc}") from exc

        kid = unverified_header.get("kid")
        keys = await self._get_jwks()
        key = next((k for k in keys if k.get("kid") == kid), None)
        if key is None:
            raise KeycloakAdapterError(f"no JWKS key matches kid={kid!r}")

        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=[key.get("alg", "RS256")],
                audience=self.audience,
                issuer=self.issuer,
            )
        except JWTError as exc:
            raise KeycloakAdapterError(f"JWT validation failed: {exc}") from exc

        tenant = payload.get(self.tenant_claim)
        if not tenant:
            raise KeycloakAdapterError(
                f"required tenant claim {self.tenant_claim!r} missing from token"
            )

        scopes_field = payload.get("scope", "")
        scopes = scopes_field.split() if isinstance(scopes_field, str) else list(scopes_field)
        # Keycloak realm/client roles can also represent scopes.
        for role in payload.get("realm_access", {}).get("roles", []):
            if role.startswith("AGI_") and role not in scopes:
                scopes.append(role)

        return Claims(
            sub=str(payload.get("sub", "")),
            tenant_id=str(tenant),
            scopes=scopes,
            raw=payload,
        )

    def get_scopes(self, claims: Claims) -> list[str]:
        return claims.scopes
