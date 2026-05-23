# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""POST /chat — round-trip against a mocked LiteLLM.

Verifies:

  * The dispatch middleware passes through to the chat handler.
  * The handler drives ``run_use_case`` end-to-end.
  * Response includes ``response``, ``pack``, ``correlation_id``, ``run_id``,
    ``status``.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from agi_runtime.config import ModelBindingConfig
from agi_runtime.main import create_app
from agi_runtime.middleware import dispatch as dispatch_mod
from agi_runtime.state import RuntimeState

from .conftest import bearer_for


def _fake_completion(content: str) -> dict[str, Any]:
    """Return a LiteLLM-shaped dict that satisfies the native orchestrator."""
    return {
        "choices": [
            {
                "message": {"content": content, "tool_calls": []},
                "finish_reason": "stop",
            }
        ]
    }


@pytest.fixture
def configured_client(monkeypatch: pytest.MonkeyPatch, tmp_path) -> TestClient:  # type: ignore[no-untyped-def]
    """Build a TestClient with a model binding pre-wired so /chat is non-stub."""

    async def fake_verify(request):  # type: ignore[no-untyped-def]
        header = request.headers.get("Authorization", "")
        token = header.split(" ", 1)[1].strip()
        body = token.split(":", 1)[1]
        if ":" in body:
            tenant, scopes_raw = body.split(":", 1)
            scopes = tuple(s for s in scopes_raw.split(",") if s)
        else:
            tenant, scopes = body, ("AGI_VIEWER",)
        return dispatch_mod._Claims(sub="test", tenant_id=tenant, scopes=scopes)

    monkeypatch.setattr(dispatch_mod, "_verify_request_claims", fake_verify)

    async def fake_acompletion(**kwargs: Any) -> Any:
        # Return a deterministic assistant message with no tool calls — the
        # native orchestrator will mark the run completed.
        return _fake_completion("hello from fake litellm")

    monkeypatch.setattr("litellm.acompletion", fake_acompletion)

    app = create_app()
    # Replace runtime state with one that has a model binding bound.

    with TestClient(app) as c:
        state: RuntimeState = app.state.runtime
        state.config.models["reasoning"] = ModelBindingConfig(
            role="reasoning",
            model_id="openai/gpt-fake",
        )
        yield c


def test_chat_round_trips_with_fake_litellm(configured_client: TestClient) -> None:
    resp = configured_client.post(
        "/chat",
        json={"messages": [{"role": "user", "content": "say hi"}]},
        headers={
            "X-Pack": "bluemarble",
            "Authorization": bearer_for("bluemarble"),
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pack"] == "bluemarble"
    assert body["status"] == "completed"
    assert body["response"] == "hello from fake litellm"
    assert body["correlation_id"]
    assert body["run_id"].startswith("run-")


def test_chat_legacy_message_field(configured_client: TestClient) -> None:
    """Legacy ``{"message": "..."}`` body still works."""
    resp = configured_client.post(
        "/chat",
        json={"message": "ping"},
        headers={
            "X-Pack": "bluemarble",
            "Authorization": bearer_for("bluemarble"),
        },
    )
    assert resp.status_code == 200
    assert resp.json()["response"] == "hello from fake litellm"


def test_chat_empty_messages_400(configured_client: TestClient) -> None:
    resp = configured_client.post(
        "/chat",
        json={"messages": []},
        headers={
            "X-Pack": "bluemarble",
            "Authorization": bearer_for("bluemarble"),
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "empty_messages"


def test_chat_stub_when_no_binding(client: TestClient) -> None:
    """No model binding configured → handler returns 200 with stub envelope."""
    resp = client.post(
        "/chat",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={
            "X-Pack": "bluemarble",
            "Authorization": bearer_for("bluemarble"),
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["pack"] == "bluemarble"
    assert body.get("stub") is True
