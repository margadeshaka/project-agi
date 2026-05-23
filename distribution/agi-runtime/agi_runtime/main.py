# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""FastAPI application entrypoint for agi-runtime.

Boots OpenTelemetry (Traceloop) early, mounts routers, and wires the
claims-validated X-Pack dispatch middleware. Designed to start cleanly even
when optional dependencies (Langfuse, Qdrant, LLM provider) are unreachable;
the readyz probe reports them as degraded rather than failing the boot.

The FastAPI lifespan handler builds the shared :class:`RuntimeState`
container (pack loader, bundle loader, trail sink) once at startup; routes
read it from ``request.app.state.runtime``.
"""

from __future__ import annotations

import contextlib
import logging
import os
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI

from agi_runtime import __version__
from agi_runtime.middleware.dispatch import XPackDispatchMiddleware
from agi_runtime.routes import admin, chat, health, kb, tools, trail
from agi_runtime.state import build_runtime_state

logger = logging.getLogger("agi_runtime")


def _boot_telemetry() -> None:
    """Initialize Traceloop OTel SDK if configured. Best-effort.

    Honours ``OTEL_EXPORTER_OTLP_ENDPOINT`` — point it at Langfuse v3's
    ``/api/public/otel`` to ship traces straight to the audit UI. Setting
    ``AGI_OTEL_DISABLED=1`` skips this entirely (use in unit tests).
    """
    if os.environ.get("AGI_OTEL_DISABLED") == "1":
        logger.info("OTel disabled via AGI_OTEL_DISABLED=1")
        return
    try:
        from traceloop.sdk import Traceloop  # type: ignore[import-not-found]

        Traceloop.init(
            app_name=os.environ.get("AGI_APP_NAME", "agi-runtime"),
            disable_batch=os.environ.get("AGI_ENV", "dev") == "dev",
        )
    except Exception as exc:  # noqa: BLE001 — boot must not fail on telemetry
        logger.warning("Traceloop init skipped: %s", exc)


@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Build (and expose) the runtime state container for the app's lifetime."""
    app.state.runtime = build_runtime_state()
    try:
        yield
    finally:
        # Best-effort sink close; sinks are no-op by default.
        sink = getattr(app.state.runtime, "trail_sink", None)
        if sink is not None:
            with contextlib.suppress(Exception):
                await sink.close()


def create_app() -> FastAPI:
    """Application factory."""
    _boot_telemetry()

    app = FastAPI(
        title="agi-runtime",
        version=__version__,
        description="project-agi reference runtime — claims-validated X-Pack dispatch",
        lifespan=_lifespan,
    )

    # Dispatch middleware runs before route handlers; health endpoints are exempt.
    app.add_middleware(XPackDispatchMiddleware)

    app.include_router(health.router)
    app.include_router(chat.router)
    app.include_router(tools.router)
    app.include_router(kb.router)
    app.include_router(trail.router)
    app.include_router(admin.router)

    @app.get("/")
    async def root() -> dict[str, Any]:
        return {"name": "agi-runtime", "version": __version__}

    return app


app = create_app()


def run() -> None:
    """uvicorn entrypoint for the `agi-runtime` console script."""
    import uvicorn

    uvicorn.run(
        "agi_runtime.main:app",
        host=os.environ.get("AGI_HOST", "0.0.0.0"),
        port=int(os.environ.get("AGI_PORT", "9000")),
        reload=os.environ.get("AGI_RELOAD") == "1",
    )


if __name__ == "__main__":
    run()
