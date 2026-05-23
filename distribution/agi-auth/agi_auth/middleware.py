# SPDX-License-Identifier: Apache-2.0
"""FastAPI auth dependencies."""

from __future__ import annotations

from typing import Callable, Iterable

from fastapi import Header, HTTPException, status

from agi_auth.adapter import AuthAdapter, Claims


def require_auth(
    scopes: Iterable[str] = (),
    *,
    adapter: AuthAdapter | None = None,
) -> Callable[..., object]:
    """Return a FastAPI dependency that verifies the bearer token + scopes.

    Usage::

        @router.get("/admin", dependencies=[Depends(require_auth(["AGI_ADMIN"]))])
        async def admin(): ...
    """
    required = frozenset(scopes)

    async def _dep(authorization: str = Header(...)) -> Claims:
        nonlocal adapter
        if not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        token = authorization.split(" ", 1)[1].strip()
        if adapter is None:
            from agi_auth import resolve_adapter

            adapter = resolve_adapter()
        try:
            claims = await adapter.verify_token(token)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=401, detail=str(exc)) from exc

        if required and not required.issubset(adapter.get_scopes(claims)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"missing required scopes: {sorted(required)}",
            )
        return claims

    return _dep
