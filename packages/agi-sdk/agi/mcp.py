# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.mcp`` — MCP tool clients.

Thin wrapper over the official ``mcp`` Python SDK. Every tool call goes
through this surface so the SDK can:

1. Resolve endpoints from ``operator.yaml``.
2. Enforce the pack's tool allow-list (set at SDK construction time).
3. Enrich the OTel span with tool name, args (redacted), side-effecting flag,
   per-tool budget breach attributes.
4. Wrap transient failures with a single, framework-typed retry path.

Phase 1 ships the typed surface and a stub call path. Phase 3 wires the
actual ``mcp.ClientSession`` lifecycle.
"""

from __future__ import annotations

from typing import Any


class NotConfigured(Exception):
    """Raised by an optional tool's ``.call()`` when not present in this deployment.

    Use cases that want a softer signal should call ``.call_or(default=...)``.
    """


class MCPToolClient:
    """Client handle for one MCP tool. Returned by :meth:`MCPClientsAPI.tool`.

    Phase 1 stub — every ``.call`` raises :class:`NotImplementedError`. Phase 3
    fills in the real transport.
    """

    def __init__(
        self,
        name: str,
        *,
        side_effecting: bool = False,
        schema: dict[str, Any] | None = None,
        available: bool = True,
    ) -> None:
        self.name = name
        self.side_effecting = side_effecting
        self.schema = schema or {}
        self.available = available

    async def call(self, method: str = "default", **kwargs: Any) -> Any:
        """Invoke ``method`` on the underlying MCP tool with span enrichment."""
        if not self.available:
            raise NotConfigured(f"MCP tool {self.name!r} is not configured for this deployment")
        raise NotImplementedError(
            "TODO: wire ClientSession.call_tool() with OTel span + per-tool budget overlay."
        )

    async def call_or(self, method: str, default: Any = None, **kwargs: Any) -> Any:
        """Like :meth:`call`, but returns ``default`` when the tool is not configured."""
        if not self.available:
            return default
        return await self.call(method, **kwargs)

    async def bulk_call(
        self,
        method: str,
        args_list: list[dict[str, Any]],
        max_concurrency: int = 10,
    ) -> list[Any]:
        """Read-only fan-out — one parent span + one child per request.

        Runtime-asserts ``side_effecting=False``; raises :class:`AssertionError`
        otherwise so a write tool can't accidentally enter the bulk path.
        """
        if self.side_effecting:
            raise AssertionError(f"bulk_call() is read-only; {self.name!r} is side-effecting")
        raise NotImplementedError("TODO: dedup args + asyncio.gather with semaphore.")


class MCPClientsAPI:
    """Thin wrapper over the official MCP Python SDK.

    Constructed by the SDK facade with the active operator MCP server registry
    and the active pack's tool allow-list. Use cases call ``sdk.mcp.tool(name)``.
    """

    def __init__(
        self,
        *,
        servers: dict[str, Any] | None = None,
        tool_allowlist: list[str] | None = None,
    ) -> None:
        self._servers = servers or {}
        self._allowlist = set(tool_allowlist) if tool_allowlist is not None else None

    def tool(self, name: str, *, optional: bool = False) -> MCPToolClient:
        """Return a client for the named MCP tool.

        When the pack has a tool allow-list and ``name`` isn't in it, the
        client comes back with ``available=False`` regardless of operator
        config — packs can only use what they declare.
        """
        in_allowlist = self._allowlist is None or name in self._allowlist
        if not in_allowlist:
            if optional:
                return MCPToolClient(name, available=False)
            raise PermissionError(
                f"MCP tool {name!r} is not declared in the active pack's tool_allowlist"
            )
        return MCPToolClient(name, available=True)


__all__ = [
    "MCPClientsAPI",
    "MCPToolClient",
    "NotConfigured",
]
