# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Uvicorn-launchable FastAPI app.

Wiring:

1. Load `CoreSettings` from env (`AGI_CORE_*`).
2. Build a `Registry` (file-backed if `registry_path` is set).
3. Build a `HubProxy` populated from `hub_endpoints` (Phase 3 swaps the
   HTTP backend for the mcpfyer-generated MCP server proxy; Phase 2
   leaves it on the HTTP shape).
4. Mount routes from `agi_core.http_routes`.
5. Expose `/healthz` and `/readyz`.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from agi_core import __version__
from agi_core.http_routes import router as core_router
from agi_core.hub import HttpHubBackend, HubProxy
from agi_core.registry import Registry
from agi_core.settings import CoreSettings

log = logging.getLogger("agi_core")


def create_app(settings: CoreSettings | None = None) -> FastAPI:
    settings = settings or CoreSettings()
    logging.basicConfig(level=settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        registry = Registry.load(settings.registry_path) if settings.registry_path else Registry()
        hub = HubProxy()
        for domain, base_url in settings.hub_endpoints.items():
            hub.register_backend(
                domain,
                HttpHubBackend(base_url=base_url, timeout_s=settings.hub_timeout_s),
            )
            log.info("hub backend registered: %s → %s", domain, base_url)
        app.state.registry = registry
        app.state.hub = hub
        try:
            yield
        finally:
            await hub.close()

    app = FastAPI(
        title="project-agi · Intelligence Core",
        description="Registry + hub fronting MCP tool bundles.",
        version=__version__,
        lifespan=lifespan,
    )

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz() -> dict[str, str]:
        return {"status": "ready"}

    @app.get("/v1/info")
    async def info() -> dict[str, str]:
        return {"service": "agi-core", "version": __version__}

    app.include_router(core_router)
    return app


app = create_app()
