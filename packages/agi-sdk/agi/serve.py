# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.serve`` — boot a use-case as HTTP + MCP server.

``serve(MyUseCase, http=True, mcp=True)`` spins up FastAPI on ``/v1/invoke``
and the official MCP server, sharing the same use-case definition. Per-request
middleware sets OTel baggage (``bm.pack``, ``bm.use_case``, ``bm.tenant_id``,
``bm.flavor``) so the SpanProcessor and AI-Trail overlay every downstream
span correctly.

Phase 1 ships the typed surface + a working FastAPI app. The MCP server, the
streaming endpoint, and the durable-orchestrator dispatch land in Phase 1.5
and Phase 3.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from agi.use_case import get_use_case_slug, get_use_case_version

if TYPE_CHECKING:
    from fastapi import FastAPI  # noqa: F401


@dataclass
class ServeHandle:
    """Returned by :func:`serve` when ``block=False``.

    Power-users mount custom routers / middleware on ``fastapi_app`` before
    calling ``await start()``. ``shutdown()`` performs graceful teardown.
    """

    fastapi_app: Any  # FastAPI — typed Any to avoid hard import for stubs
    mcp_server: Any | None
    shutdown: Callable[[], Awaitable[None]]
    use_case_slug: str
    use_case_version: str


def serve(
    use_case_cls: type,
    *,
    http: bool = True,
    mcp: bool = True,
    port: int = 8080,
    block: bool = True,
) -> ServeHandle:
    """Boot ``use_case_cls`` as the named exposure(s).

    Parameters
    ----------
    use_case_cls:
        A class decorated with :func:`agi.use_case`.
    http, mcp:
        Toggle FastAPI / MCP exposure independently. Disabling both is an
        error.
    port:
        Listening port for the FastAPI app (the MCP server uses its own
        transport, set in config).
    block:
        When ``True`` (default), the call blocks on ``uvicorn.run``. When
        ``False``, the caller gets a :class:`ServeHandle` and runs the loop
        itself — used by tests and embedders.
    """
    slug = get_use_case_slug(use_case_cls)
    version = get_use_case_version(use_case_cls)
    if slug is None or version is None:
        raise TypeError(
            f"{use_case_cls.__name__} is not a @use_case-decorated class; "
            "decorate it with @use_case(slug, version) first."
        )
    if not http and not mcp:
        raise ValueError("serve() requires at least one of http=True or mcp=True")

    app = _build_fastapi_app(use_case_cls, slug=slug, version=version) if http else None
    mcp_server = _build_mcp_server(use_case_cls, slug=slug) if mcp else None

    async def _shutdown() -> None:
        # Phase 1 stub — Phase 1.5 wires uvicorn.Server.should_exit and MCP teardown.
        return None

    handle = ServeHandle(
        fastapi_app=app,
        mcp_server=mcp_server,
        shutdown=_shutdown,
        use_case_slug=slug,
        use_case_version=version,
    )

    if block and http and app is not None:
        _run_uvicorn(app, port=port)
    return handle


def _build_fastapi_app(use_case_cls: type, *, slug: str, version: str) -> Any:
    """Construct the FastAPI app with baggage middleware + ``/v1/invoke``."""
    try:
        from fastapi import FastAPI, Request
    except ImportError as exc:  # pragma: no cover - exercised when fastapi missing
        raise RuntimeError(
            "agi.serve() needs FastAPI installed. Add `fastapi` to your runtime deps."
        ) from exc

    app = FastAPI(title=f"agi: {slug}", version=version)

    @app.middleware("http")
    async def _baggage_middleware(request: "Request", call_next):  # type: ignore[no-untyped-def]
        token = _attach_baggage(request, slug=slug, version=version)
        try:
            return await call_next(request)
        finally:
            _detach_baggage(token)

    @app.get("/healthz")
    async def _healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    async def _readyz() -> dict[str, str]:
        return {"status": "ready"}

    @app.get("/v1/info")
    async def _info() -> dict[str, str]:
        return {"slug": slug, "version": version}

    @app.post("/v1/invoke")
    async def _invoke(request: "Request") -> dict[str, str]:
        # Phase 1 stub. Phase 1.5 wires the use-case instance + Pydantic
        # request/response models derived from the class signature.
        return {
            "status": "stub",
            "slug": slug,
            "version": version,
            "detail": "TODO: dispatch to use_case.handle() in Phase 1.5",
        }

    return app


def _attach_baggage(request: Any, *, slug: str, version: str) -> Any:
    """Push ``bm.use_case``, ``bm.use_case.version``, ``bm.pack``, ``bm.tenant_id``,
    ``bm.flavor`` onto OTel baggage for the duration of the request.

    Returns an opaque token for :func:`_detach_baggage`. No-ops gracefully when
    OpenTelemetry isn't installed (tests / minimal installs).
    """
    try:
        from opentelemetry import baggage, context  # type: ignore[import-not-found]
    except Exception:
        return None
    ctx = context.get_current()
    ctx = baggage.set_baggage("bm.use_case", slug, context=ctx)
    ctx = baggage.set_baggage("bm.use_case.version", version, context=ctx)
    pack = request.headers.get("X-Pack") if hasattr(request, "headers") else None
    if pack:
        ctx = baggage.set_baggage("bm.pack", pack, context=ctx)
    tenant = request.headers.get("X-Tenant") if hasattr(request, "headers") else None
    if tenant:
        ctx = baggage.set_baggage("bm.tenant_id", tenant, context=ctx)
    flavor = request.headers.get("X-Flavor") if hasattr(request, "headers") else None
    if flavor:
        ctx = baggage.set_baggage("bm.flavor", flavor, context=ctx)
    return context.attach(ctx)


def _detach_baggage(token: Any) -> None:
    if token is None:
        return
    try:
        from opentelemetry import context  # type: ignore[import-not-found]

        context.detach(token)
    except Exception:
        return


def _build_mcp_server(use_case_cls: type, *, slug: str) -> Any:
    """Build the MCP server exposure for ``use_case_cls``.

    Stubbed in Phase 1 — returns a placeholder dict. Phase 3 wires the real
    MCP server with one tool per public method on the use-case class.
    """
    return {"slug": slug, "status": "TODO: wire mcp.server in Phase 3"}


def _run_uvicorn(app: Any, *, port: int) -> None:  # pragma: no cover - integration only
    """Block on ``uvicorn.run``. Isolated so tests can call serve(block=False)."""
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=port)  # noqa: S104 - bind-all is intentional for K8s


__all__ = ["ServeHandle", "serve"]
