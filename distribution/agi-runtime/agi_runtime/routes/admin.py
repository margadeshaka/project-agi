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

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

from agi.trail import new_event
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from agi_runtime import __version__ as runtime_version
from agi_runtime.state import RuntimeState

router = APIRouter(prefix="/admin", tags=["admin"])


def _scopes_of(request: Request) -> tuple[str, ...]:
    """Return the tuple of scopes attached to ``request.state.claims`` (or empty)."""
    claims = getattr(request.state, "claims", None)
    return tuple(getattr(claims, "scopes", ()) or ()) if claims else ()


def _is_admin(scopes: tuple[str, ...]) -> bool:
    return "agi:admin" in scopes


def _is_viewer(scopes: tuple[str, ...]) -> bool:
    return "agi:viewer" in scopes


def _operator_slugs(scopes: tuple[str, ...]) -> set[str]:
    """Return the set of pack slugs the caller has ``agi:operator:<slug>`` for."""
    out: set[str] = set()
    for s in scopes:
        if s.startswith("agi:operator:"):
            slug = s[len("agi:operator:") :].strip()
            if slug:
                out.add(slug)
    return out


def _require_admin(request: Request) -> None:
    """Gate admin endpoints on the ``agi:admin`` scope."""
    if not _is_admin(_scopes_of(request)):
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


# ---------------------------------------------------------------------------
# KB reindex — JSON (sync) or SSE progress stream
# ---------------------------------------------------------------------------


_REINDEX_TICK_SECONDS = 0.05  # small delay between SSE ticks; tests rely on it staying small
_REINDEX_TICKS = (0, 25, 50, 75, 100)  # 3–5 ticks per ADMIN_CONSOLE.md §3.4


def _wants_sse(request: Request) -> bool:
    """Did the caller ask for ``text/event-stream`` in the ``Accept`` header?"""
    accept = request.headers.get("accept", "")
    return "text/event-stream" in accept.lower()


def _count_kb_articles(pack: Any) -> int:
    """Count ``.md``/``.json``/``.txt`` files under ``pack.kb_dir`` (zero if missing)."""
    kb_dir = getattr(pack, "kb_dir", None)
    if kb_dir is None or not kb_dir.is_dir():
        return 0
    total = 0
    for path in kb_dir.rglob("*"):
        if path.is_file() and path.suffix in {".md", ".markdown", ".json", ".txt"}:
            total += 1
    return total


def _sse_frame(event: str, data: dict[str, Any]) -> bytes:
    """Encode a single SSE event/data pair as bytes."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")


@router.post("/kb/{slug}/reindex")
async def reindex_kb(slug: str, request: Request) -> Any:
    """Trigger a KB reindex.

    Two response modes share this handler:

    * **JSON (default)** — no ``Accept: text/event-stream``; returns the
      synchronous ``{pack, reindex_queued, correlation_id}`` envelope. This is
      the legacy shape the FE poll fallback consumes byte-for-byte.
    * **SSE** — ``Accept: text/event-stream``; returns a ``StreamingResponse``
      that emits ``start`` / ``progress`` (3–5 ticks) / ``complete`` events.
      On failure it emits a single ``error`` event then closes.

    The real vector-store/Qdrant integration lands in P5–P6; v1 simulates
    progress by ticking percentages over the article count so the FE
    progress UI is exercised end-to-end.
    """
    _require_admin(request)

    runtime: RuntimeState = request.app.state.runtime
    pack = runtime.pack_loader.get(slug)
    sse = _wants_sse(request)

    # Decision: unknown pack → 404 *up-front*, even on the SSE path. We could
    # alternatively open the stream then emit a single ``error`` event, but
    # mid-stream errors are harder for the FE to surface (the SSE parser is
    # already inside its reader loop). A pre-stream 404 lets the FE's catch
    # branch hit ``RuntimeError`` and toast normally. Tests document this.
    if pack is None:
        await _log_admin(
            request,
            action="kb_reindex",
            payload={"slug": slug, "sse": sse, "found": False},
        )
        raise HTTPException(status_code=404, detail=f"pack {slug!r} not loaded")

    await _log_admin(request, action="kb_reindex", payload={"slug": slug, "sse": sse})

    if not sse:
        return {
            "pack": slug,
            "reindex_queued": True,
            "correlation_id": request.state.correlation_id,
        }

    correlation_id = request.state.correlation_id
    article_total = _count_kb_articles(pack)

    async def _stream() -> AsyncIterator[bytes]:
        try:
            started_iso = datetime.now(timezone.utc).isoformat()
            yield _sse_frame("start", {"slug": slug, "started_iso": started_iso})
            for percent in _REINDEX_TICKS:
                articles_done = (
                    article_total if percent == 100 else (article_total * percent) // 100
                )
                yield _sse_frame(
                    "progress",
                    {
                        "slug": slug,
                        "percent": percent,
                        "progress": percent,  # FE consumes ``progress`` directly
                        "articles_done": articles_done,
                        "articles_total": article_total,
                    },
                )
                await asyncio.sleep(_REINDEX_TICK_SECONDS)
            completed_iso = datetime.now(timezone.utc).isoformat()
            yield _sse_frame(
                "complete",
                {
                    "slug": slug,
                    "completed_iso": completed_iso,
                    "articles_indexed": article_total,
                    # ``done`` + ``chunks`` keep the FE toast path happy
                    # (kb-browser.tsx looks for these keys directly).
                    "done": True,
                    "chunks": article_total,
                    "correlation_id": correlation_id,
                },
            )
        except Exception as exc:  # noqa: BLE001 — stream must close cleanly
            yield _sse_frame(
                "error",
                {
                    "type": "about:blank",
                    "title": "kb_reindex_failed",
                    "detail": str(exc),
                    "status": 500,
                    "slug": slug,
                    "correlation_id": correlation_id,
                },
            )

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"X-Correlation-Id": correlation_id},
    )


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
    """List registered use-case services aggregated across loaded packs.

    Scope rule (ADMIN_CONSOLE.md §4): ``agi:admin`` and ``agi:viewer`` see
    every (name, version) pair across every loaded pack; ``agi:operator:<slug>``
    sees only the services their pack offers. Anything else → 403.

    Pack-side use-case shape (``pack.metadata.use_cases``) is a list of
    ``{name, version, tools: [...]}`` dicts; packs that didn't declare any
    contribute nothing. ``health`` is hard-coded ``"ok"`` until P5 wires a
    live probe (no telemetry yet to drive it).
    """
    scopes = _scopes_of(request)
    op_slugs = _operator_slugs(scopes)
    if not (_is_admin(scopes) or _is_viewer(scopes) or op_slugs):
        raise HTTPException(status_code=403, detail="admin, viewer, or operator scope required")
    privileged = _is_admin(scopes) or _is_viewer(scopes)

    runtime: RuntimeState = request.app.state.runtime
    # Aggregate by (name, version): packs that offer the same service show up
    # as multiple entries in ``packs`` rather than duplicating the row.
    aggregated: dict[tuple[str, str], dict[str, Any]] = {}
    for slug in runtime.pack_loader.list_slugs():
        if not privileged and slug not in op_slugs:
            continue
        pack = runtime.pack_loader.get(slug)
        if pack is None:
            continue
        raw = pack.metadata.get("use_cases") if pack.metadata else None
        if not isinstance(raw, list):
            continue
        for uc in raw:
            if not isinstance(uc, dict):
                continue
            name = uc.get("name")
            version = uc.get("version")
            if not isinstance(name, str) or not isinstance(version, str):
                continue
            key = (name, version)
            entry = aggregated.get(key)
            raw_tools = uc.get("tools")
            tool_list: list[Any] = raw_tools if isinstance(raw_tools, list) else []
            if entry is None:
                aggregated[key] = {
                    "name": name,
                    "version": version,
                    "packs": [{"slug": slug}],
                    "health": "ok",
                    "tool_count": len(tool_list),
                }
            else:
                if not any(p["slug"] == slug for p in entry["packs"]):
                    entry["packs"].append({"slug": slug})
                # Keep the largest declared tool_count across packs — services
                # that allow-list a superset on one pack still surface their
                # full tool span here.
                entry["tool_count"] = max(entry["tool_count"], len(tool_list))

    langfuse_url = os.environ.get("LANGFUSE_HOST") or os.environ.get("AGI_LANGFUSE_URL")
    return {
        "use_cases": sorted(aggregated.values(), key=lambda u: (u["name"], u["version"])),
        "langfuse_url": langfuse_url,
    }


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


# ---------------------------------------------------------------------------
# Pack list + detail (Console FR-PACK)
# ---------------------------------------------------------------------------


def _pack_theme(pack: Any) -> dict[str, Any]:
    """Pull a {primary, secondary, accent, mode} theme blob out of ``pack.metadata``.

    Packs may declare theme either flat under ``theme`` or absent entirely.
    Missing values stay ``None`` rather than guessing colours.
    """
    raw = pack.metadata.get("theme") if getattr(pack, "metadata", None) else None
    if not isinstance(raw, dict):
        return {"primary": None, "secondary": None, "accent": None, "mode": None}
    return {
        "primary": raw.get("primary"),
        "secondary": raw.get("secondary"),
        "accent": raw.get("accent"),
        "mode": raw.get("mode"),
    }


def _pack_card(pack: Any, *, sha: str | None) -> dict[str, Any]:
    """One row in the ``GET /admin/packs`` response."""
    meta = pack.metadata or {}
    return {
        "slug": pack.slug,
        "name": pack.name,
        "display_name": pack.name or pack.slug,
        "version": pack.version,
        "vertical": meta.get("vertical"),
        "theme": _pack_theme(pack),
        "sha": sha,
        # No on-disk mtime is tracked by the loader today; surface ``None`` so
        # the UI can hide the column. P5 will wire watcher-driven timestamps.
        "updated_at": None,
    }


@router.get("/packs")
async def list_packs(request: Request) -> dict[str, Any]:
    """List every loaded pack — administrators only.

    Scope rule (per ADMIN_CONSOLE.md §4):
      * ``agi:admin`` → 200 with all loaded packs.
      * Anything else (including ``agi:viewer`` and ``agi:operator:<slug>``)
        → 403.

    Operators and viewers learn which packs they may operate via
    ``GET /admin/whoami``'s claims — enumerating peer packs through
    ``/admin/packs`` would be a small multi-tenant leak.
    """
    scopes = _scopes_of(request)
    if not _is_admin(scopes):
        raise HTTPException(status_code=403, detail="agi:admin scope required")

    runtime: RuntimeState = request.app.state.runtime
    out: list[dict[str, Any]] = []
    for slug in runtime.pack_loader.list_slugs():
        pack = runtime.pack_loader.get(slug)
        if pack is None:
            continue
        out.append(_pack_card(pack, sha=runtime.pack_loader.sha(slug)))
    return {"packs": out, "count": len(out)}


def _allowed_tools(pack: Any) -> list[str]:
    """Pack tool allow-list. ``pack.tool_allowlist`` is the source of truth."""
    raw = getattr(pack, "tool_allowlist", None) or []
    return [t for t in raw if isinstance(t, str)]


def _kb_summary(pack: Any) -> dict[str, Any]:
    """Cheap KB summary — counts files under ``pack.kb_dir`` if present."""
    kb_dir = getattr(pack, "kb_dir", None)
    if kb_dir is None or not kb_dir.is_dir():
        return {"article_count": 0, "locale": "en"}
    count = 0
    for path in kb_dir.rglob("*"):
        if path.is_file() and path.suffix in {".md", ".markdown", ".json", ".txt"}:
            count += 1
    return {"article_count": count, "locale": "en"}


def _scenarios(pack: Any) -> list[str]:
    """Best-effort scenario list. Packs may declare them in ``pack.yaml`` metadata."""
    raw = pack.metadata.get("scenarios") if getattr(pack, "metadata", None) else None
    if isinstance(raw, list):
        return [s for s in raw if isinstance(s, str)]
    return []


def _activity_24h(runtime: RuntimeState, slug: str) -> dict[str, int]:
    """Count chats / tool calls / errors for ``slug`` in the last 24h.

    Reads from the in-process MemoryTrailSink. File-backed sinks are not
    re-scanned here — surfaces zeros + TODO. Mongo/Postgres sinks land in P4.
    """
    sink = runtime.trail_sink
    events = getattr(sink, "events", None)
    if events is None:
        # TODO(P5): teach FileJsonlTrailSink / Mongo / Postgres sinks to back
        # a counts API. For now the admin overview gets zeros from non-memory
        # sinks rather than blocking the screen.
        return {"chats": 0, "tool_calls": 0, "errors": 0}

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    chats = tool_calls = errors = 0
    for ev in events:
        if ev.get("pack_slug") != slug:
            continue
        ts_raw = ev.get("ts")
        if isinstance(ts_raw, str):
            try:
                ts = datetime.fromisoformat(ts_raw)
            except ValueError:
                continue
            if ts < cutoff:
                continue
        et = ev.get("event_type", "")
        if et.startswith("llm."):
            chats += 1
        elif et.startswith("mcp.") or et.startswith("tool."):
            tool_calls += 1
        if et == "error" or et.endswith(".error"):
            errors += 1
    return {"chats": chats, "tool_calls": tool_calls, "errors": errors}


@router.get("/packs/{slug}")
async def pack_detail(slug: str, request: Request) -> dict[str, Any]:
    """Per-pack overview for ``/packs/:slug/overview`` (Console FR-PACK).

    Scope rules:
      * ``agi:admin`` or ``agi:viewer`` → any slug.
      * ``agi:operator:<slug>`` → only the slug they operate.

    Returns identity, theme, role bindings (read-only), allow-listed tools,
    a tiny KB summary, scenario list, and 24h activity counters. The counters
    are best-effort against the in-process trail sink — non-memory sinks
    return zeros until P5 wires a counts API.
    """
    scopes = _scopes_of(request)
    op_slugs = _operator_slugs(scopes)
    if not (_is_admin(scopes) or _is_viewer(scopes) or slug in op_slugs):
        raise HTTPException(status_code=403, detail="not authorised for this pack")

    runtime: RuntimeState = request.app.state.runtime
    pack = runtime.pack_loader.get(slug)
    if pack is None:
        raise HTTPException(status_code=404, detail=f"pack {slug!r} not loaded")

    role_bindings = {
        "declared_roles": list(getattr(pack, "declared_model_roles", []) or []),
        "system_prompt": pack.metadata.get("system_prompt") if pack.metadata else None,
        "scenarios": pack.metadata.get("scenario_bindings", {}) if pack.metadata else {},
    }

    return {
        "slug": pack.slug,
        "name": pack.name,
        "display_name": pack.name or pack.slug,
        "version": pack.version,
        "vertical": (pack.metadata or {}).get("vertical"),
        "metadata": pack.metadata or {},
        "models": list(getattr(pack, "declared_model_roles", []) or []),
        "theme": _pack_theme(pack),
        "role_bindings": role_bindings,
        "allowed_tools": _allowed_tools(pack),
        "kb": _kb_summary(pack),
        "scenarios": _scenarios(pack),
        "activity_24h": _activity_24h(runtime, slug),
        "sha": runtime.pack_loader.sha(slug),
    }


# ---------------------------------------------------------------------------
# Users (Console FR-AUTH) — dev-noop synthetic user
# ---------------------------------------------------------------------------


@router.get("/users")
async def list_users(request: Request) -> dict[str, Any]:
    """List users known to the runtime.

    In 4a we ship the dev-noop / static-token case: there is exactly one
    bearer-resolved identity per request, so we return a single synthetic
    user representing the current caller. A proper directory listing requires
    a round-trip to the Keycloak Admin API (or whichever OIDC IdP is wired)
    and is deferred to P6 — when that lands, this endpoint will fan out to
    the adapter's ``list_users()`` method.
    """
    _require_admin(request)
    claims = getattr(request.state, "claims", None)
    if claims is None:
        raise HTTPException(status_code=401, detail="not authenticated")

    subject = getattr(claims, "sub", None) or getattr(claims, "subject", None)
    tenant_id = getattr(claims, "tenant_id", None)
    scopes = list(getattr(claims, "scopes", ()) or ())
    # The dev-noop adapter doesn't carry email/name fields — synthesise.
    user = {
        "subject": subject,
        "email": f"{subject}@dev.local" if subject else None,
        "name": subject,
        "scopes": scopes,
        "tenant_id": tenant_id,
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }
    return {
        "users": [user],
        "count": 1,
        "source": "synthetic-from-bearer",
        "note": (
            "Proper user listing requires Keycloak Admin API integration; "
            "deferred to P6. This response reflects only the current bearer."
        ),
    }


# ---------------------------------------------------------------------------
# Settings (Console FR-ADM) — read-only operator config snapshot
# ---------------------------------------------------------------------------


def _detect_trail_sink_type(sink: Any) -> tuple[str, str | None]:
    """Classify the runtime's trail sink for the settings page."""
    cls = type(sink).__name__
    if cls == "MemoryTrailSink":
        return ("memory", None)
    if cls == "FileJsonlTrailSink":
        path = getattr(sink, "_path", None)
        return ("file", str(path) if path is not None else None)
    if cls == "MongoTrailSink":
        return ("mongo", None)
    if cls == "PostgresTrailSink":
        return ("postgres", None)
    return (cls.lower(), None)


@router.get("/settings")
async def admin_settings(request: Request) -> dict[str, Any]:
    """Read-only snapshot of how the runtime was configured.

    Surface for ``/admin/settings`` in the console. There is no write
    counterpart in 4a — operators change settings by editing
    ``operator.yaml`` + restarting (the documented hardening flow).
    """
    _require_admin(request)
    runtime: RuntimeState = request.app.state.runtime
    sink_type, sink_path = _detect_trail_sink_type(runtime.trail_sink)
    return {
        "settings": {
            "version": runtime_version,
            "env": os.environ.get("AGI_ENV", "dev"),
            "auth_mode": os.environ.get("AGI_AUTH_MODE", "dev-noop"),
            "otel_endpoint": os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
            "langfuse_url": os.environ.get("LANGFUSE_HOST") or os.environ.get("AGI_LANGFUSE_URL"),
            "trail_sink_type": sink_type,
            "trail_sink_path": sink_path,
            "hardening_mode": os.environ.get("AGI_HARDEN") == "1",
            "hot_reload_enabled": False,
            "operator_id": runtime.config.operator_id,
            "packs_dir": str(runtime.config.packs_dir),
            "bundles_dir": str(runtime.config.bundles_dir),
            "max_steps": runtime.config.max_steps,
        }
    }


# ---------------------------------------------------------------------------
# LLM provider health (Console FR-LLM)
# ---------------------------------------------------------------------------


_PROVIDER_PREFIXES: tuple[tuple[str, str], ...] = (
    ("openai/", "openai"),
    ("anthropic/", "anthropic"),
    ("bedrock/", "bedrock"),
    ("ollama/", "ollama"),
    ("ollama_chat/", "ollama"),
    ("fake/", "fake"),
    ("azure/", "azure"),
    ("vertex_ai/", "vertex"),
)


def _classify_provider(model_id: str) -> str:
    for prefix, kind in _PROVIDER_PREFIXES:
        if model_id.startswith(prefix):
            return kind
    # bare model id — assume openai-compat
    return "openai"


def _ping_provider(model_id: str) -> str:
    """Best-effort ``litellm`` ping. Returns ``ready|degraded|unreachable``.

    Only called outside test/dev. In test/dev we hard-code ``ready`` to keep
    the suite hermetic — see :func:`llm_providers_health`.
    """
    try:
        import litellm  # type: ignore[import-not-found]

        litellm.completion(
            model=model_id, messages=[{"role": "user", "content": "."}], max_tokens=1
        )
    except Exception:  # noqa: BLE001 — health probes must never raise
        return "unreachable"
    return "ready"


@router.get("/llm/providers")
async def llm_providers_health(request: Request) -> dict[str, Any]:
    """LLM provider health + which roles each one is primary for.

    Scope rules:
      * ``agi:admin`` or ``agi:viewer`` → 200.
      * anything else → 403.

    In ``AGI_ENV in {"test", "dev"}`` (the default) we hard-code ``ready``
    for the configured providers so tests stay hermetic. Set
    ``AGI_ENV=staging`` (or anything else) to do real ping-tests. There is no
    explicit ping flag in 4a — the env gate is the only switch.
    """
    scopes = _scopes_of(request)
    if not (_is_admin(scopes) or _is_viewer(scopes)):
        raise HTTPException(status_code=403, detail="admin or viewer scope required")

    runtime: RuntimeState = request.app.state.runtime
    env = os.environ.get("AGI_ENV", "test").lower()
    do_ping = env not in {"test", "dev"}

    # Group role bindings by provider kind.
    by_kind: dict[str, dict[str, Any]] = {}
    for role, cfg in runtime.config.models.items():
        kind = _classify_provider(cfg.model_id)
        slot = by_kind.setdefault(
            kind,
            {
                "name": kind,
                "kind": kind,
                "status": "ready",
                "configured_models": [],
                "primary_for_roles": [],
            },
        )
        if cfg.model_id not in slot["configured_models"]:
            slot["configured_models"].append(cfg.model_id)
        if role not in slot["primary_for_roles"]:
            slot["primary_for_roles"].append(role)

    now = datetime.now(timezone.utc).isoformat()
    providers: list[dict[str, Any]] = []
    for slot in by_kind.values():
        if do_ping and slot["configured_models"]:
            slot["status"] = _ping_provider(slot["configured_models"][0])
        slot["last_checked_at"] = now
        providers.append(slot)

    return {"providers": providers, "count": len(providers), "probed": do_ping}
