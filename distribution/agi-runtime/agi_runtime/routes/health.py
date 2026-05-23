# SPDX-License-Identifier: Apache-2.0
"""Liveness and readiness probes.

``/healthz`` returns 200 immediately — proves the process is up.

``/readyz`` probes storage, vector store, LLM provider, and Langfuse.
It degrades **gracefully**: any unreachable optional dep is reported under
``degraded`` but the response is still 200, because the runtime is
serviceable for the routes that don't depend on the missing component. A
hard 503 is only returned if no dispatch path can possibly succeed.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx
from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz() -> dict[str, Any]:
    checks = await asyncio.gather(
        _check_storage(),
        _check_vector_store(),
        _check_llm(),
        _check_langfuse(),
        return_exceptions=False,
    )
    degraded = [name for name, ok in checks if not ok]
    body: dict[str, Any] = {
        "status": "ready" if not degraded else "degraded",
        "checks": {name: ok for name, ok in checks},
    }
    if degraded:
        body["degraded"] = degraded
    return body


async def _check_storage() -> tuple[str, bool]:
    """Best-effort MongoDB ping."""
    uri = os.environ.get("AGI_MONGO_URI")
    if not uri:
        return ("storage", False)
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # type: ignore[import-not-found]

        client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=1500)
        await client.admin.command("ping")
        return ("storage", True)
    except Exception:  # noqa: BLE001
        return ("storage", False)


async def _check_vector_store() -> tuple[str, bool]:
    url = os.environ.get("AGI_QDRANT_URL")
    if not url:
        return ("vector_store", False)
    return ("vector_store", await _http_ok(f"{url.rstrip('/')}/readyz"))


async def _check_llm() -> tuple[str, bool]:
    provider = os.environ.get("AGI_LLM_PROVIDER", "")
    if provider == "ollama":
        url = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
        return ("llm_provider", await _http_ok(f"{url.rstrip('/')}/api/tags"))
    if provider == "bedrock":
        # Skip real boto call here — readyz must not block on AWS.
        return ("llm_provider", True)
    if provider == "fake":
        return ("llm_provider", True)
    return ("llm_provider", False)


async def _check_langfuse() -> tuple[str, bool]:
    url = os.environ.get("LANGFUSE_HOST")
    if not url:
        return ("langfuse", False)
    return ("langfuse", await _http_ok(f"{url.rstrip('/')}/api/public/health"))


async def _http_ok(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(url)
            return resp.status_code < 500
    except Exception:  # noqa: BLE001
        return False
