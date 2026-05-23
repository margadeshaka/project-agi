# SPDX-License-Identifier: Apache-2.0
"""project-agi auth adapters."""

from __future__ import annotations

import os

from agi_auth.adapter import AuthAdapter, Claims
from agi_auth.dev_noop import DevNoopAdapter
from agi_auth.keycloak import KeycloakAdapter
from agi_auth.middleware import require_auth
from agi_auth.static_token import StaticTokenAdapter

__all__ = [
    "AuthAdapter",
    "Claims",
    "DevNoopAdapter",
    "KeycloakAdapter",
    "StaticTokenAdapter",
    "require_auth",
    "resolve_adapter",
]

__version__ = "1.0.0rc1"


def resolve_adapter() -> AuthAdapter:
    """Return the configured adapter based on env vars.

    Selection:
      * ``AGI_AUTH=keycloak`` — KeycloakAdapter (default in production)
      * ``AGI_AUTH=static`` — StaticTokenAdapter
      * ``AGI_AUTH=dev-noop`` — DevNoopAdapter (refuses to start in production)
    """
    mode = os.environ.get("AGI_AUTH", "dev-noop").lower()
    if mode == "keycloak":
        return KeycloakAdapter.from_env()
    if mode == "static":
        return StaticTokenAdapter.from_env()
    if mode == "dev-noop":
        return DevNoopAdapter()
    raise ValueError(f"unknown AGI_AUTH mode: {mode!r}")
