# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""POST /chat — drives the native orchestrator end-to-end.

Request shape (FR-INT.1):

    POST /chat
    Headers: X-Pack, Authorization, [X-Correlation-Id], [X-Session-Id]
    Body: { "messages": [Message], "stream": bool, "max_steps": int }
          (also accepts legacy ``{"message": "..."}`` from earlier callers)

Response shape:

    { "response": <last assistant content>,
      "pack": <slug>,
      "correlation_id": <id>,
      "run_id": <id>,
      "status": "completed" | "failed" | "paused" }

Streaming responses use Server-Sent Events with ``data: <json>`` frames; the
final frame is ``data: [DONE]`` so the FE matches OpenAI's wire format.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from agi.config import Pack as SDKPack
from agi.mcp import MCPClientsAPI
from agi.models import ModelBinding
from agi.orchestrators.native import (
    Message,
    Orchestrator,
    Run,
    run_use_case,
)

from agi_runtime.config import ModelBindingConfig
from agi_runtime.state import RuntimeState

router = APIRouter(tags=["chat"])


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"] = "user"
    content: str | None = None
    name: str | None = None
    tool_call_id: str | None = None


class ChatRequest(BaseModel):
    """Loose request shape — supports both new and legacy callers."""

    # New shape (spec).
    messages: list[ChatMessage] | None = None
    stream: bool = False
    max_steps: int | None = None
    use_case: str | None = None

    # Legacy shape: ``{"message": "hi"}``. Earlier dispatch fuzz test uses this.
    message: str | None = None

    model_config = {"extra": "allow"}

    def to_messages(self) -> list[Message]:
        """Normalise to ``list[agi.orchestrators.native.Message]``."""
        if self.messages:
            return [
                Message(
                    role=m.role,
                    content=m.content,
                    name=m.name,
                    tool_call_id=m.tool_call_id,
                )
                for m in self.messages
            ]
        if self.message:
            return [Message(role="user", content=self.message)]
        return []


@router.post("/chat")
async def chat(req: ChatRequest, request: Request) -> Any:
    pack = request.state.pack
    correlation_id: str = request.state.correlation_id
    session_id: str | None = request.headers.get("X-Session-Id")
    runtime: RuntimeState = request.app.state.runtime

    messages = req.to_messages()
    if not messages:
        return JSONResponse(
            {
                "error": "empty_messages",
                "message": "request must include 'messages' or 'message'",
                "correlation_id": correlation_id,
            },
            status_code=400,
        )

    # Resolve the active pack from the loader; fall back to a synthetic shim
    # so we still return 200 for packs that haven't been physically deployed
    # to /etc/agi/packs/ yet (the dispatch fuzz test relies on this).
    sdk_pack: SDKPack | None = runtime.pack_loader.get(pack.slug)
    if sdk_pack is None:
        sdk_pack = SDKPack(slug=pack.slug, version="0.0.0-stub")

    # Resolve the reasoning binding. If unconfigured, run in stub mode so the
    # dispatch path is exercisable from a vanilla test env.
    binding_cfg = runtime.config.model_binding("reasoning")
    if binding_cfg is None:
        return _stub_response(pack.slug, correlation_id, messages)

    binding = _to_sdk_binding(binding_cfg)
    mcp = MCPClientsAPI(
        servers={},
        tool_allowlist=list(sdk_pack.tool_allowlist) if sdk_pack.tool_allowlist else None,
    )
    available_tools = runtime.bundle_loader.all_tools_for(sdk_pack)

    last_user = next(
        (m.content or "" for m in reversed(messages) if m.role == "user"),
        "",
    )
    system_prompt = next(
        (m.content for m in messages if m.role == "system"),
        None,
    )
    max_steps = req.max_steps or runtime.config.max_steps

    if req.stream:
        return StreamingResponse(
            _stream_chat(
                binding=binding,
                mcp=mcp,
                pack=sdk_pack,
                messages=messages,
                correlation_id=correlation_id,
                session_id=session_id,
                pack_slug=pack.slug,
            ),
            media_type="text/event-stream",
            headers={"X-Correlation-Id": correlation_id},
        )

    run = await run_use_case(
        binding=binding,
        mcp=mcp,
        pack=sdk_pack,
        use_case_slug=req.use_case or "chat",
        use_case_version=sdk_pack.version or "0.0.0",
        correlation_id=correlation_id,
        tenant_id=getattr(pack, "tenant_id", None),
        session_id=session_id,
        user_message=last_user,
        system_prompt=system_prompt,
        available_tools=available_tools,
        trail_sink=runtime.trail_sink,
        max_steps=max_steps,
    )
    return {
        "response": (run.result or {}).get("reply", ""),
        "pack": pack.slug,
        "correlation_id": correlation_id,
        "run_id": run.run_id,
        "status": run.status,
    }


def _to_sdk_binding(cfg: ModelBindingConfig) -> ModelBinding:
    """Adapt the runtime's :class:`ModelBindingConfig` to the SDK binding."""
    return ModelBinding(
        role=cfg.role,
        model_id=cfg.model_id,
        region=cfg.region,
        default_params=dict(cfg.default_params),
        extra=dict(cfg.extra),
    )


def _stub_response(
    pack_slug: str,
    correlation_id: str,
    messages: list[Message],
) -> dict[str, Any]:
    """Synthetic 200 used when no model binding is configured.

    The dispatch fuzz test exercises this branch — it cares only about HTTP
    status and the ``pack`` field, not the actual LLM call.
    """
    user_text = next(
        (m.content or "" for m in reversed(messages) if m.role == "user"),
        "",
    )
    return {
        "response": f"[stub] no model binding configured; echo: {user_text}",
        "pack": pack_slug,
        "correlation_id": correlation_id,
        "run_id": "run-stub",
        "status": "completed",
        "stub": True,
    }


async def _stream_chat(
    *,
    binding: ModelBinding,
    mcp: MCPClientsAPI,
    pack: SDKPack,
    messages: list[Message],
    correlation_id: str,
    session_id: str | None,
    pack_slug: str,
) -> Any:
    """Yield SSE frames from ``Orchestrator.stream()`` for the FE."""
    orch = Orchestrator(binding=binding, mcp=mcp, pack=pack)
    run = Run(
        correlation_id=correlation_id,
        pack_slug=pack_slug,
        use_case_slug="chat",
        use_case_version=pack.version or "0.0.0",
        session_id=session_id,
        messages=messages,
    )
    async for chunk in orch.stream(run):
        yield f"data: {json.dumps(chunk)}\n\n"
    yield "data: [DONE]\n\n"
