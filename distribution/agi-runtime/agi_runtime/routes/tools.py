# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""Tool surface — list, inspect, invoke.

- ``GET  /tools``                — cross-pack catalogue (every loaded bundle).
- ``GET  /packs/{slug}/tools``   — pack-scoped (post-allowlist) catalogue.
- ``GET  /tools/{name}``         — descriptor detail with input/output schemas.
- ``POST /tools/{name}``         — dispatch via :class:`BundleLoader` (stubbed).
                                   Gated on the ``agi:dev`` scope.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from agi.config import Pack as SDKPack

from agi_runtime.state import RuntimeState

router = APIRouter(tags=["tools"])


@router.get("/tools")
async def list_tools(request: Request) -> dict[str, Any]:
    """Cross-pack catalogue — every tool every bundle exposes."""
    runtime: RuntimeState = request.app.state.runtime
    descriptors = runtime.bundle_loader.all_descriptors()
    return {
        "pack": request.state.pack.slug,
        "tools": [_descriptor_summary(d) for d in descriptors],
    }


@router.get("/packs/{slug}/tools")
async def list_pack_tools(slug: str, request: Request) -> dict[str, Any]:
    """Pack-scoped catalogue (post-allowlist filter)."""
    runtime: RuntimeState = request.app.state.runtime
    sdk_pack: SDKPack | None = runtime.pack_loader.get(slug)
    if sdk_pack is None:
        raise HTTPException(status_code=404, detail=f"pack {slug!r} not loaded")
    schemas = runtime.bundle_loader.all_tools_for(sdk_pack)
    return {
        "pack": slug,
        "tools": [_openai_tool_summary(s) for s in schemas],
    }


@router.get("/tools/{name}")
async def get_tool(name: str, request: Request) -> dict[str, Any]:
    runtime: RuntimeState = request.app.state.runtime
    descriptor = runtime.bundle_loader.get_tool(name)
    if descriptor is None:
        raise HTTPException(status_code=404, detail=f"tool {name!r} not found")
    return {
        "pack": request.state.pack.slug,
        "tool": _descriptor_full(descriptor),
    }


@router.post("/tools/{name}")
async def invoke_tool(
    name: str,
    payload: dict[str, Any],
    request: Request,
) -> dict[str, Any]:
    """Invoke a tool. Gated on ``agi:dev``.

    Direct tool invocation is intentionally a developer-only surface; the
    real agent loop routes through ``/chat``. Operators with the ``agi:dev``
    claim use this for smoke-testing tool wiring during pack development.
    """
    claims = getattr(request.state, "claims", None)
    scopes: tuple[str, ...] = getattr(claims, "scopes", ()) if claims else ()
    if "agi:dev" not in scopes:
        raise HTTPException(status_code=403, detail="tool invocation requires agi:dev scope")

    runtime: RuntimeState = request.app.state.runtime
    result = await runtime.bundle_loader.dispatch(
        name,
        payload,
        correlation_id=request.state.correlation_id,
    )
    return {
        "pack": request.state.pack.slug,
        "tool": name,
        "result": result,
        "correlation_id": request.state.correlation_id,
    }


# ---- formatting helpers ---------------------------------------------------


def _descriptor_summary(descriptor: Any) -> dict[str, Any]:
    """Compact view used by ``GET /tools``."""
    return {
        "name": descriptor.name,
        "domain": getattr(descriptor, "domain", ""),
        "description": getattr(descriptor, "description", "") or "",
        "side_effecting": bool(getattr(descriptor, "side_effecting", False)),
        "rate_limit_class": getattr(descriptor, "rate_limit_class", ""),
    }


def _descriptor_full(descriptor: Any) -> dict[str, Any]:
    """Detailed view used by ``GET /tools/{name}``."""
    return {
        "name": descriptor.name,
        "domain": getattr(descriptor, "domain", ""),
        "description": getattr(descriptor, "description", "") or "",
        "input_schema": getattr(descriptor, "input_schema", {}),
        "output_schema": getattr(descriptor, "output_schema", None),
        "side_effecting": bool(getattr(descriptor, "side_effecting", False)),
        "rate_limit_class": getattr(descriptor, "rate_limit_class", ""),
        "dry_run_supported": bool(getattr(descriptor, "dry_run_supported", False)),
        "method": getattr(descriptor, "method", ""),
        "path_template": getattr(descriptor, "path_template", ""),
        "source_api": getattr(descriptor, "source_api", ""),
    }


def _openai_tool_summary(schema: dict[str, Any]) -> dict[str, Any]:
    fn = schema.get("function", {})
    return {
        "name": fn.get("name"),
        "description": fn.get("description", ""),
        "parameters": fn.get("parameters", {}),
    }
