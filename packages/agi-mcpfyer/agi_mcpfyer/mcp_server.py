# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Bundle → MCP server stub.

This module takes an `MCPBundle` and exposes each tool through the
official MCP Python SDK's `FastMCP`. **Real upstream HTTP forwarding is
deliberately out of scope for Phase 2** — that lives in agi-core's hub
proxy and lands in Phase 3.

What this stub does today:
- Registers every tool with FastMCP using the descriptor's name + input
  schema + MCP annotations (readOnlyHint / destructiveHint / title).
- On invocation, returns a fixture envelope describing what would have
  been called upstream. This makes the bundle inspectable end-to-end
  (Inspector, smoke tests, dry-run UI) without a live backend.

Phase 3 (agi-core) will swap the fixture handler for the live proxy
without changing this surface.
"""

from __future__ import annotations

import inspect
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from agi_mcpfyer.bundle import MCPBundle
from agi_mcpfyer.generator import ToolDescriptor

_JSON_TYPE_TO_PY: dict[str, type] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "array": list,
    "object": dict,
}


def build_mcp_server(
    bundle: MCPBundle,
    *,
    name: str | None = None,
) -> FastMCP:
    """Materialise a FastMCP server from a bundle.

    `name` defaults to `bundle.source_api` or `"agi-mcpfyer"`.
    """
    server_name = name or bundle.source_api or "agi-mcpfyer"
    server = FastMCP(server_name)
    for tool in bundle.tools:
        _register_stub_tool(server, tool=tool)
    return server


def _register_stub_tool(server: FastMCP, *, tool: ToolDescriptor) -> None:
    async def _handler(**arguments: Any) -> dict[str, Any]:
        # Stub: return a fixture envelope describing the call. Phase 3 swaps
        # this for the real `UpstreamProxy.invoke(tool, arguments)`.
        return {
            "stub": True,
            "tool": tool.name,
            "method": tool.method,
            "path_template": tool.path_template,
            "arguments": arguments,
            "source_api": tool.source_api,
        }

    _handler.__name__ = tool.name
    _handler.__doc__ = tool.description
    _handler.__signature__ = _build_signature(tool)  # type: ignore[attr-defined]
    _handler.__annotations__ = _build_annotations(tool)

    server.add_tool(
        _handler,
        name=tool.name,
        description=tool.description,
        annotations=_mcp_annotations(tool),
        structured_output=True,
    )


def _build_signature(tool: ToolDescriptor) -> inspect.Signature:
    props: dict[str, Any] = tool.input_schema.get("properties") or {}
    required = set(tool.input_schema.get("required") or [])
    params: list[inspect.Parameter] = []
    for name, schema in props.items():
        py_type = _resolve_py_type(schema)
        default = inspect.Parameter.empty if name in required else None
        params.append(
            inspect.Parameter(
                name,
                kind=inspect.Parameter.KEYWORD_ONLY,
                default=default,
                annotation=py_type,
            )
        )
    return inspect.Signature(parameters=params, return_annotation=dict[str, Any])


def _build_annotations(tool: ToolDescriptor) -> dict[str, Any]:
    props: dict[str, Any] = tool.input_schema.get("properties") or {}
    annotations: dict[str, Any] = {name: _resolve_py_type(schema) for name, schema in props.items()}
    annotations["return"] = dict[str, Any]
    return annotations


def _resolve_py_type(schema: dict[str, Any]) -> Any:
    if not isinstance(schema, dict):
        return str
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        for cand in schema_type:
            if cand != "null":
                return _JSON_TYPE_TO_PY.get(cand, str)
        return str
    if isinstance(schema_type, str):
        return _JSON_TYPE_TO_PY.get(schema_type, str)
    return str


def _mcp_annotations(tool: ToolDescriptor) -> ToolAnnotations:
    return ToolAnnotations(
        destructiveHint=tool.side_effecting,
        readOnlyHint=not tool.side_effecting,
        title=tool.name.replace("_", " ").title(),
    )
