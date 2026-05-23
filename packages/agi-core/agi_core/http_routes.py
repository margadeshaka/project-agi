# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""HTTP surface for the registry + hub.

Routes are read-mostly: register new tools/use-cases via the SDK (or
during boot from a bundle), inspect + dispatch through these endpoints.

    GET  /registry/tools                 → list tools (optional ?domain=)
    GET  /registry/tools/{name}          → one tool
    POST /registry/tools                 → upsert one tool
    GET  /registry/use-cases             → list use-cases
    POST /registry/use-cases             → upsert one use-case
    GET  /hub/domains                    → list domains with backends
    POST /hub/{domain}/invoke            → forward {tool, arguments} to backend
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from agi_core.hub import HubProxy, HubProxyError
from agi_core.registry import Registry, ToolDescriptor, UseCaseDescriptor


def get_registry(request: Request) -> Registry:
    reg = getattr(request.app.state, "registry", None)
    if not isinstance(reg, Registry):
        raise HTTPException(status_code=500, detail="registry not initialised")
    return reg


def get_hub(request: Request) -> HubProxy:
    hub = getattr(request.app.state, "hub", None)
    if not isinstance(hub, HubProxy):
        raise HTTPException(status_code=500, detail="hub not initialised")
    return hub


router = APIRouter(tags=["agi-core"])


# ----------------------------------------------------------------- registry routes


@router.get("/registry/tools")
async def list_tools(request: Request, domain: str | None = None) -> list[dict[str, Any]]:
    reg = get_registry(request)
    return [t.model_dump() for t in reg.list_tools(domain=domain)]


@router.get("/registry/tools/{name}")
async def get_tool(name: str, request: Request) -> dict[str, Any]:
    reg = get_registry(request)
    tool = reg.find(name)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"tool {name!r} not registered")
    return tool.model_dump()


@router.post("/registry/tools", status_code=201)
async def upsert_tool(tool: ToolDescriptor, request: Request) -> dict[str, Any]:
    reg = get_registry(request)
    reg.register_tool(tool)
    return tool.model_dump()


@router.get("/registry/use-cases")
async def list_use_cases(request: Request, domain: str | None = None) -> list[dict[str, Any]]:
    reg = get_registry(request)
    return [u.model_dump() for u in reg.list_use_cases(domain=domain)]


@router.post("/registry/use-cases", status_code=201)
async def upsert_use_case(use_case: UseCaseDescriptor, request: Request) -> dict[str, Any]:
    reg = get_registry(request)
    reg.register_use_case(use_case)
    return use_case.model_dump()


# ----------------------------------------------------------------- hub routes


class InvokeRequest(BaseModel):
    tool: str
    arguments: dict[str, Any] = {}


@router.get("/hub/domains")
async def hub_domains(request: Request) -> list[str]:
    return get_hub(request).domains()


@router.post("/hub/{domain}/invoke")
async def hub_invoke(domain: str, body: InvokeRequest, request: Request) -> Any:
    hub = get_hub(request)
    try:
        return await hub.invoke(domain, body.tool, body.arguments)
    except HubProxyError as exc:
        if exc.status_code is None:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
