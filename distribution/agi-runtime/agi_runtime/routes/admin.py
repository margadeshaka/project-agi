# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""Admin console endpoints (Console Requirements FR-IA).

Mutation-via-HTTP for the tool registry is intentionally out of scope (R6 in
the resolved-stack decisions); the only state-changing action is
``POST /admin/packs/{slug}/reload`` which re-runs the disk loader. Every
admin action writes an ``admin.*`` event to the audit sink so reviewers can
reconstruct who-did-what.
"""

from __future__ import annotations

from typing import Any

from agi.trail import new_event
from fastapi import APIRouter, HTTPException, Request

from agi_runtime.state import RuntimeState

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(request: Request) -> None:
    """Gate admin endpoints on the ``agi:admin`` scope."""
    claims = getattr(request.state, "claims", None)
    scopes: tuple[str, ...] = getattr(claims, "scopes", ()) if claims else ()
    if "agi:admin" not in scopes:
        raise HTTPException(status_code=403, detail="admin scope required")


async def _log_admin(
    request: Request,
    *,
    action: str,
    payload: dict[str, Any],
) -> None:
    runtime: RuntimeState = request.app.state.runtime
    event = new_event(
        correlation_id=request.state.correlation_id,
        pack_slug=request.state.pack.slug,
        session_id=request.headers.get("X-Session-Id") or "",
        event_type=f"admin.{action}",
        payload=payload,
    )
    await runtime.admin_sink.write(event)


@router.post("/packs/{slug}/reload")
async def reload_pack(slug: str, request: Request) -> dict[str, Any]:
    _require_admin(request)
    runtime: RuntimeState = request.app.state.runtime
    pack = runtime.pack_loader.reload(slug)
    sha = runtime.pack_loader.sha(slug)
    await _log_admin(
        request,
        action="pack_reload",
        payload={"slug": slug, "found": pack is not None, "sha": sha},
    )
    if pack is None:
        return {
            "pack": slug,
            "reloaded": False,
            "reason": "not_on_disk",
            "correlation_id": request.state.correlation_id,
        }
    return {
        "pack": slug,
        "reloaded": True,
        "version": pack.version,
        "sha": sha,
        "correlation_id": request.state.correlation_id,
    }


@router.post("/kb/{slug}/reindex")
async def reindex_kb(slug: str, request: Request) -> dict[str, Any]:
    _require_admin(request)
    await _log_admin(request, action="kb_reindex", payload={"slug": slug})
    return {
        "pack": slug,
        "reindex_queued": True,
        "correlation_id": request.state.correlation_id,
    }


@router.get("/llm/bindings")
async def llm_bindings(request: Request) -> dict[str, Any]:
    """Read-only view of role-to-model bindings (decision R6: no HTTP mutation)."""
    runtime: RuntimeState = request.app.state.runtime
    bindings = [
        {
            "role": cfg.role,
            "model_id": cfg.model_id,
            "region": cfg.region,
            "default_params": cfg.default_params,
        }
        for cfg in runtime.config.models.values()
    ]
    return {
        "pack": request.state.pack.slug,
        "bindings": bindings,
        "readonly": True,
        "provenance": runtime.config.provenance.get("models", "default"),
    }


@router.get("/use-cases")
async def use_cases(request: Request) -> dict[str, Any]:
    """List registered use-case slugs/versions per loaded pack."""
    runtime: RuntimeState = request.app.state.runtime
    out: list[dict[str, Any]] = []
    for slug in runtime.pack_loader.list_slugs():
        pack = runtime.pack_loader.get(slug)
        if pack is None:
            continue
        # Use-cases are declared in pack.yaml under ``use_cases:``. Surface
        # whatever shape is on disk — packs that didn't declare any return [].
        use_cases_raw = pack.metadata.get("use_cases") if pack.metadata else None
        out.append(
            {
                "pack": slug,
                "version": pack.version,
                "use_cases": list(use_cases_raw) if isinstance(use_cases_raw, list) else [],
            }
        )
    return {"pack": request.state.pack.slug, "packs": out}


@router.get("/log")
async def admin_log(request: Request, limit: int = 100, offset: int = 0) -> dict[str, Any]:
    """Append-only log of admin actions for this runtime."""
    _require_admin(request)
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be 1..1000")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")
    runtime: RuntimeState = request.app.state.runtime
    # The admin sink is always a MemoryTrailSink in this build — drains will
    # come once Mongo/Postgres sinks land in P4.
    events = getattr(runtime.admin_sink, "events", [])
    page = list(events)[offset : offset + limit]
    return {
        "pack": request.state.pack.slug,
        "total": len(events),
        "limit": limit,
        "offset": offset,
        "entries": page,
    }


@router.get("/status")
async def admin_status(request: Request) -> dict[str, Any]:
    runtime: RuntimeState = request.app.state.runtime
    import time

    return {
        "pack": request.state.pack.slug,
        "uptime_s": int(time.time() - runtime.started_at),
        "active_packs": runtime.pack_loader.list_slugs(),
        "loaded_bundles": runtime.bundle_loader.list_bundles(),
        "operator_id": runtime.config.operator_id,
    }


@router.get("/whoami")
async def whoami(request: Request) -> dict[str, Any]:
    """Resolve the bearer token to a Claims view.

    Consumed by the agi-ui shell to decide which sidebar items to render
    (scope-aware) and which pack-overview page to land an operator on after
    sign-in. Read-only; no scope gate beyond "must be authenticated."
    """
    claims = getattr(request.state, "claims", None)
    if claims is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return {
        "subject": getattr(claims, "subject", None),
        "tenant_id": getattr(claims, "tenant_id", None),
        "scopes": list(getattr(claims, "scopes", ()) or ()),
        "pack": request.state.pack.slug,
        "issuer": getattr(claims, "issuer", None),
    }


@router.get("/packs/{slug}/prompts")
async def list_pack_prompts(slug: str, request: Request) -> dict[str, Any]:
    """List the pack's prompts as read-only entries.

    Decision R3: prompts are YAML-in-pack, source of truth on disk; the
    runtime exposes them only for read. Editing is the pack-hotfix-branch
    flow, never an HTTP mutation.

    Returned entries carry ``name``, ``relative_path``, ``size_bytes``, and a
    short ``preview`` (first 400 characters). Full body fetch is a separate
    endpoint, deferred to fast-follow.
    """
    runtime: RuntimeState = request.app.state.runtime
    pack = runtime.pack_loader.get(slug)
    if pack is None:
        raise HTTPException(status_code=404, detail=f"pack {slug!r} not loaded")

    prompts_dir = getattr(pack, "prompts_dir", None)
    entries: list[dict[str, Any]] = []
    if prompts_dir is not None and prompts_dir.is_dir():
        for path in sorted(prompts_dir.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix not in {".yaml", ".yml", ".j2", ".md", ".txt"}:
                continue
            try:
                body = path.read_text(encoding="utf-8")
            except OSError:
                continue
            entries.append(
                {
                    "name": path.stem,
                    "relative_path": str(path.relative_to(prompts_dir)),
                    "size_bytes": path.stat().st_size,
                    "preview": body[:400],
                }
            )

    return {
        "pack": slug,
        "prompts_dir": str(prompts_dir) if prompts_dir is not None else None,
        "count": len(entries),
        "entries": entries,
        "readonly": True,
    }
