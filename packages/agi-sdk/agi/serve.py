# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.serve`` — boot a use-case as HTTP + MCP server.

``serve(MyUseCase, http=True, mcp=True)`` spins up FastAPI on ``/v1/invoke``
and the official MCP server, sharing the same use-case definition. Per-request
middleware sets OTel baggage (``bm.pack``, ``bm.use_case``, ``bm.tenant_id``,
``bm.flavor``) so the SpanProcessor and AI-Trail overlay every downstream
span correctly.

Per ADR-0002, ``serve()`` is a **single-pack, single-use-case process boot**.
The orchestrator-driving code is in :mod:`agi.dispatch`; ``serve()`` is the
HTTP/MCP transport. ``serve()`` performs no multi-pack dispatch and contains
zero imports from ``agi_runtime.*``.

Pack resolution at process-boot time (highest → lowest):
    explicit ``pack=`` kwarg  →  ``AGI_PACK_PATH`` env  →  ``blank`` reference pack.

Environment variables read by ``serve()``:

- ``AGI_PACK_PATH`` — filesystem path to a pack folder, used when no explicit
  ``pack=`` kwarg is supplied.
- ``AGI_SERVE_STATIC_TOKEN`` — when set, opt-in to a static-bearer auth hook
  (Phase 1.5 wiring; today the dev-noop hook is the default).
- ``AGI_TRAIL_SINK`` — selects the in-process trail sink. ``"memory"`` (default)
  uses :class:`agi.trail.MemoryTrailSink`; ``"file"`` uses
  :class:`agi.trail.FileJsonlTrailSink` at ``AGI_TRAIL_PATH``.
- ``AGI_TRAIL_PATH`` — file path for the JSONL trail sink (only when
  ``AGI_TRAIL_SINK=file``). Defaults to ``./agi-trail.jsonl``.

The MCP exposure is a typed :class:`MCPServerHandle` with
``status="pending-phase-3"`` until Phase 3 wires the real ``mcp.ClientSession``
server. The handle is shaped so the public type signature is stable across
the Phase-1 → Phase-3 transition.
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Literal

from agi.dispatch import (
    InvokeRequest,
    InvokeResponse,
    invoke_use_case,
    stream_use_case,
)
from agi.packs import load_pack
from agi.trail import FileJsonlTrailSink, MemoryTrailSink, TrailSink
from agi.use_case import get_use_case_slug, get_use_case_version

# FastAPI is a required runtime dep for ``serve()`` — import eagerly so route
# annotations like ``Request`` resolve via module globals (FastAPI uses
# ``typing.get_type_hints`` on the route, which only sees module-level names
# under ``from __future__ import annotations``).
try:
    from fastapi import Body as _Body
    from fastapi import FastAPI as _FastAPI
    from fastapi import HTTPException as _HTTPException
    from fastapi import Request
    from fastapi.responses import StreamingResponse
except ImportError as _exc:  # pragma: no cover - exercised when fastapi missing
    raise RuntimeError(
        "agi.serve() needs FastAPI installed. Add `fastapi` to your runtime deps."
    ) from _exc

if TYPE_CHECKING:
    from agi.config import Pack
    from agi.models import ModelBinding


# ---------------------------------------------------------------------------
# Auth hook
# ---------------------------------------------------------------------------


Claims = dict[str, Any]
"""Synthetic claims dict — ``{"tenant_id": ..., "subject": ..., ...}``.

When ``serve()`` is embedded inside ``agi-runtime``, the runtime's claims
middleware runs first and the hook here is a no-op. In SDK-embedded mode the
``dev-noop`` default fills in ``tenant_id = pack.slug``.
"""

AuthHook = Callable[[Any], Claims | None]
"""Pluggable authn callable. Receives the FastAPI ``Request``, returns
``Claims`` or ``None``. Defaults to a dev-noop that synthesises claims with
``tenant_id = pack.slug``."""


def _dev_noop_auth_hook_factory(*, pack_slug: str) -> AuthHook:
    """Build the default dev-noop auth hook bound to ``pack_slug``."""

    def _hook(_request: Any) -> Claims:
        return {"tenant_id": pack_slug, "subject": "dev-noop"}

    return _hook


# ---------------------------------------------------------------------------
# MCP server handle (Phase 1 placeholder shape; Phase 3 fills it in)
# ---------------------------------------------------------------------------


@dataclass
class MCPServerHandle:
    """Typed handle returned by :func:`_build_mcp_server`.

    Phase 1 closure ships ``status="pending-phase-3"`` and the public method
    names of the decorated use-case as ``tools``. Phase 3 swaps this for a
    real :class:`mcp.ClientSession`-backed server with the same public shape.
    """

    status: Literal["pending-phase-3", "ready"]
    tools: list[str] = field(default_factory=list)
    use_case_slug: str = ""

    def shutdown(self) -> None:
        """Release MCP server resources. No-op in Phase 1."""
        return None


# ---------------------------------------------------------------------------
# Public serve() surface
# ---------------------------------------------------------------------------


@dataclass
class ServeHandle:
    """Returned by :func:`serve` when ``block=False``.

    Power-users mount custom routers / middleware on ``fastapi_app`` before
    calling ``await start()``. ``shutdown()`` performs graceful teardown.
    """

    fastapi_app: Any  # FastAPI — typed Any to avoid hard import for stubs
    mcp_server: MCPServerHandle | None
    shutdown: Callable[[], Awaitable[None]]
    use_case_slug: str
    use_case_version: str
    pack: "Pack"
    trail_sink: TrailSink


def serve(
    use_case_cls: type,
    *,
    pack: "Pack | str | None" = None,
    auth: AuthHook | None = None,
    model_binding: "ModelBinding | None" = None,
    trail_sink: TrailSink | None = None,
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
    pack:
        Explicit pack source — either a :class:`agi.config.Pack` instance or a
        filesystem path to a pack folder. When ``None``, the ``AGI_PACK_PATH``
        env var is consulted; when that's also absent, the bundled ``blank``
        reference pack is loaded.
    auth:
        Pluggable authn callable ``(request) -> Claims | None``. Defaults to a
        dev-noop hook that synthesises ``tenant_id = pack.slug``.
    model_binding:
        Resolved :class:`agi.models.ModelBinding` used for every invoke. When
        ``None``, the dispatch seam still receives a binding constructed from
        defaults (Phase 1 — Phase 1.5 wires this off the operator config).
    trail_sink:
        Explicit :class:`agi.trail.TrailSink`. When ``None``, an in-process
        sink is chosen from ``AGI_TRAIL_SINK`` (default ``MemoryTrailSink``).
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

    resolved_pack = _resolve_pack(pack)
    resolved_sink = trail_sink if trail_sink is not None else _resolve_trail_sink()
    resolved_auth = (
        auth if auth is not None else _dev_noop_auth_hook_factory(pack_slug=resolved_pack.slug)
    )
    resolved_binding = model_binding if model_binding is not None else _default_binding()

    app = (
        _build_fastapi_app(
            use_case_cls,
            slug=slug,
            version=version,
            pack=resolved_pack,
            auth_hook=resolved_auth,
            model_binding=resolved_binding,
            trail_sink=resolved_sink,
        )
        if http
        else None
    )
    mcp_server = _build_mcp_server(use_case_cls, slug=slug) if mcp else None

    async def _shutdown() -> None:
        # Phase 1 stub — Phase 1.5 wires uvicorn.Server.should_exit and MCP teardown.
        if mcp_server is not None:
            mcp_server.shutdown()
        return None

    handle = ServeHandle(
        fastapi_app=app,
        mcp_server=mcp_server,
        shutdown=_shutdown,
        use_case_slug=slug,
        use_case_version=version,
        pack=resolved_pack,
        trail_sink=resolved_sink,
    )

    if block and http and app is not None:
        _run_uvicorn(app, port=port)
    return handle


# ---------------------------------------------------------------------------
# Pack / trail-sink / model-binding resolution
# ---------------------------------------------------------------------------


def _resolve_pack(source: "Pack | str | None") -> "Pack":
    """Pack source precedence: explicit kwarg → ``AGI_PACK_PATH`` env → blank."""
    from agi.config import Pack

    if isinstance(source, Pack):
        return source
    if isinstance(source, (str, Path)):
        return load_pack(source)
    env_path = os.environ.get("AGI_PACK_PATH")
    if env_path:
        return load_pack(env_path)
    return load_pack(_blank_pack_root())


def _blank_pack_root() -> Path:
    """Filesystem path to the bundled ``blank`` reference pack."""
    # serve.py → agi/ → agi-sdk/ → packages/ → repo root → packages/agi-packs/blank
    sdk_root = Path(__file__).resolve().parent.parent.parent.parent
    candidate = sdk_root / "packages" / "agi-packs" / "blank"
    if candidate.is_dir():
        return candidate
    # Fallback for non-monorepo installs — the agi-packs distribution is sibling.
    alt = Path(__file__).resolve().parent.parent / "agi-packs" / "blank"
    if alt.is_dir():
        return alt
    raise RuntimeError(
        "Could not locate the bundled 'blank' reference pack on disk; "
        "set AGI_PACK_PATH or pass pack=<Pack|path> to serve()."
    )


def _resolve_trail_sink() -> TrailSink:
    """Pick a sink from ``AGI_TRAIL_SINK`` env. Defaults to ``MemoryTrailSink``."""
    sink_kind = os.environ.get("AGI_TRAIL_SINK", "memory").strip().lower()
    if sink_kind == "file":
        path = os.environ.get("AGI_TRAIL_PATH", "./agi-trail.jsonl")
        return FileJsonlTrailSink(path)
    return MemoryTrailSink()


def _default_binding() -> "ModelBinding":
    """Build a placeholder :class:`ModelBinding` for Phase-1 serve() boots.

    Phase 1.5 will read this off the operator config + active pack's declared
    roles. For now the binding is constructed with a benign default model id —
    tests inject a fake ``litellm.acompletion`` so the id is never honoured.
    """
    from agi.models import ModelBinding

    return ModelBinding(role="reasoning", model_id="openai/gpt-4o-mini")


# ---------------------------------------------------------------------------
# FastAPI app builder
# ---------------------------------------------------------------------------


def _build_fastapi_app(
    use_case_cls: type,
    *,
    slug: str,
    version: str,
    pack: "Pack",
    auth_hook: AuthHook,
    model_binding: "ModelBinding",
    trail_sink: TrailSink,
) -> Any:
    """Construct the FastAPI app with baggage middleware + ``/v1/*`` routes."""
    Body = _Body
    FastAPI = _FastAPI
    HTTPException = _HTTPException

    app = FastAPI(title=f"agi: {slug}", version=version)
    app.state.pack = pack
    app.state.trail_sink = trail_sink
    app.state.auth_hook = auth_hook
    app.state.model_binding = model_binding
    app.state.use_case_cls = use_case_cls

    @app.middleware("http")
    async def _baggage_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
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
    async def _info() -> dict[str, Any]:
        return {
            "slug": slug,
            "version": version,
            "pack": pack.slug,
            "pack_version": pack.version,
        }

    def _claims_for(request: Request) -> Claims:
        """Run the auth hook; default to dev-noop claims if it returns ``None``."""
        claims = auth_hook(request)
        if claims is None:
            claims = {"tenant_id": pack.slug, "subject": "dev-noop"}
        return claims

    def _correlation_id(request: Request, body: InvokeRequest | None) -> str:
        if body is not None and body.correlation_id:
            return body.correlation_id
        header = request.headers.get("X-Correlation-Id")
        if header:
            return header
        return uuid.uuid4().hex

    def _available_tools() -> Mapping[str, Any]:
        """The in-process tool surface — empty for Phase 1; phase 3 wires MCP."""
        return {"tools": []}

    @app.post("/v1/invoke")
    async def _invoke(
        request: Request,
        invoke_req: InvokeRequest = Body(...),
    ) -> dict[str, Any]:
        claims = _claims_for(request)
        tenant_id = str(claims.get("tenant_id") or pack.slug)
        correlation_id = _correlation_id(request, invoke_req)
        try:
            response: InvokeResponse = await invoke_use_case(
                use_case_cls=use_case_cls,
                pack=pack,
                request=invoke_req,
                model_binding=model_binding,
                available_tools=_available_tools(),
                trail_sink=trail_sink,
                correlation_id=correlation_id,
                tenant_id=tenant_id,
                session_id=invoke_req.session_id,
            )
        except (TypeError, ValueError) as exc:
            # Undecorated class / empty messages / use-case slug mismatch.
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — orchestrator failure surfaces as 500
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return response.model_dump()

    @app.post("/v1/invoke/stream")
    async def _invoke_stream(
        request: Request,
        invoke_req: InvokeRequest = Body(...),
    ) -> StreamingResponse:
        claims = _claims_for(request)
        tenant_id = str(claims.get("tenant_id") or pack.slug)
        correlation_id = _correlation_id(request, invoke_req)

        async def _gen() -> Any:
            try:
                iterator = await stream_use_case(
                    use_case_cls=use_case_cls,
                    pack=pack,
                    request=invoke_req,
                    model_binding=model_binding,
                    available_tools=_available_tools(),
                    trail_sink=trail_sink,
                    correlation_id=correlation_id,
                    tenant_id=tenant_id,
                    session_id=invoke_req.session_id,
                )
                async for row in iterator:
                    yield f"data: {json.dumps(row, default=str)}\n\n"
            except (TypeError, ValueError) as exc:
                err = {"event_type": "error", "status": 400, "detail": str(exc)}
                yield f"data: {json.dumps(err)}\n\n"
            except Exception as exc:  # noqa: BLE001
                err = {"event_type": "error", "status": 500, "detail": str(exc)}
                yield f"data: {json.dumps(err)}\n\n"

        return StreamingResponse(_gen(), media_type="text/event-stream")

    @app.get("/v1/tools")
    async def _tools() -> dict[str, Any]:
        # Phase 1: the SDK's MCP exposure is a placeholder. We surface the
        # pack's declared allow-list so operators can see what would be wired
        # up once the real MCP server lands in Phase 3.
        return {
            "tools": [{"name": name, "json_schema": {}} for name in (pack.tool_allowlist or [])],
            "status": "pending-phase-3",
        }

    @app.get("/v1/trail/{correlation_id}")
    async def _trail(correlation_id: str) -> dict[str, Any]:
        events = _read_trail_events(trail_sink, correlation_id=correlation_id)
        return {"events": events}

    return app


def _read_trail_events(sink: TrailSink, *, correlation_id: str) -> list[dict[str, Any]]:
    """Pull events for ``correlation_id`` out of the in-process sink.

    Only ``MemoryTrailSink`` is queryable in Phase 1 — file/Mongo/Postgres
    sinks return an empty list (the runtime owns the queryable trail).
    """
    if isinstance(sink, MemoryTrailSink):
        return [
            dict(event) for event in sink.events if event.get("correlation_id") == correlation_id
        ]
    return []


# ---------------------------------------------------------------------------
# OTel baggage middleware
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# MCP server builder
# ---------------------------------------------------------------------------


def _build_mcp_server(use_case_cls: type, *, slug: str) -> MCPServerHandle:
    """Build the MCP server exposure for ``use_case_cls``.

    Phase 1 closure registers the surface (public methods on the decorated
    class) and returns a typed :class:`MCPServerHandle` with
    ``status="pending-phase-3"``. Phase 3 wires the real ``mcp.ClientSession``
    backend — the public type signature stays stable across the transition.
    """
    public_methods = [
        name
        for name in dir(use_case_cls)
        if not name.startswith("_") and callable(getattr(use_case_cls, name, None))
    ]
    return MCPServerHandle(
        status="pending-phase-3",
        tools=public_methods,
        use_case_slug=slug,
    )


def _run_uvicorn(app: Any, *, port: int) -> None:  # pragma: no cover - integration only
    """Block on ``uvicorn.run``. Isolated so tests can call serve(block=False)."""
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=port)  # noqa: S104 - bind-all is intentional for K8s


__all__ = [
    "AuthHook",
    "Claims",
    "MCPServerHandle",
    "ServeHandle",
    "serve",
]
