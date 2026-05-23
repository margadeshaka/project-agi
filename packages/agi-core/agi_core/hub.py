# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Hub proxy — forwards MCP tool calls to per-domain backends.

Generalised from v0's `hub.proxy.UpstreamProxy`. v0 hard-coded one HTTP
proxy per service; this version is pluggable so the same proxy front-end
can sit in front of:

- a mcpfyer-generated MCP server (Phase 3, the real shape)
- a raw OpenAPI upstream (legacy parity with v0)
- a fixture/echo backend (used in Phase 2 and tests)

Domain → backend resolution is config-driven via `HubProxy.register_backend`
or by loading `CoreSettings.hub_endpoints`.
"""

from __future__ import annotations

from typing import Any, Protocol

import httpx


class HubProxyError(RuntimeError):
    """The hub could not forward the call — backend missing, transport error, or 5xx."""

    def __init__(
        self,
        message: str,
        *,
        domain: str | None = None,
        status_code: int | None = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.domain = domain
        self.status_code = status_code
        self.body = body


class HubBackend(Protocol):
    """A backend the hub forwards calls to. Real upstreams + stubs both implement this."""

    async def call(self, tool: str, arguments: dict[str, Any]) -> Any: ...

    async def close(self) -> None: ...


class HttpHubBackend:
    """HTTP backend: POSTs `{tool, arguments}` to `<base_url>/invoke`.

    Intended for Phase 3, where each domain has a mcpfyer-generated MCP
    server reachable over HTTP. In Phase 2 this is unused by default —
    `EchoHubBackend` is wired in tests + smoke runs.
    """

    def __init__(self, *, base_url: str, timeout_s: float = 15.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=timeout_s)

    async def call(self, tool: str, arguments: dict[str, Any]) -> Any:
        try:
            resp = await self._client.post("/invoke", json={"tool": tool, "arguments": arguments})
        except httpx.HTTPError as exc:
            raise HubProxyError(
                f"transport error calling {tool} on {self._base_url}: {exc}"
            ) from exc
        if resp.status_code >= 400:
            try:
                body_payload: Any = resp.json()
            except Exception:
                body_payload = resp.text
            raise HubProxyError(
                f"{tool} → {self._base_url} returned {resp.status_code}",
                status_code=resp.status_code,
                body=body_payload,
            )
        if not resp.content:
            return None
        ctype = resp.headers.get("content-type", "")
        if "application/json" in ctype:
            return resp.json()
        return resp.text

    async def close(self) -> None:
        await self._client.aclose()


class EchoHubBackend:
    """Test/stub backend — returns a fixture envelope describing the call.

    Useful for wiring the HTTP surface end-to-end in Phase 2 without a
    real upstream behind it.
    """

    def __init__(self, *, name: str = "echo") -> None:
        self._name = name

    async def call(self, tool: str, arguments: dict[str, Any]) -> Any:
        return {"backend": self._name, "tool": tool, "arguments": arguments, "stub": True}

    async def close(self) -> None:
        return None


class HubProxy:
    """Domain-dispatching front for MCP tool calls."""

    def __init__(self) -> None:
        self._backends: dict[str, HubBackend] = {}

    def register_backend(self, domain: str, backend: HubBackend) -> None:
        self._backends[domain] = backend

    def has_backend(self, domain: str) -> bool:
        return domain in self._backends

    def domains(self) -> list[str]:
        return sorted(self._backends.keys())

    async def invoke(self, domain: str, tool: str, arguments: dict[str, Any]) -> Any:
        backend = self._backends.get(domain)
        if backend is None:
            raise HubProxyError(f"no backend registered for domain {domain!r}", domain=domain)
        return await backend.call(tool, arguments)

    async def close(self) -> None:
        for backend in self._backends.values():
            await backend.close()
