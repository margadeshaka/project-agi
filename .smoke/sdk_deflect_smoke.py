# SPDX-License-Identifier: Apache-2.0
"""C · Care-intelligence Deflect scenario retrofitted onto agi-sdk.

Source scenario:
    backend/ai-poc-backend/app/solutions/care_intelligence/demo/scenarios/
        deflect-esim-install.scenario.json

Original shape:
    customer asks "How do I install my eSIM on iPhone 15?"
    → agent calls search_knowledge_base
    → KB returns matching article
    → agent drafts a personalised reply
    → conversation closes (no ticket, no human)

This port stays faithful to the scenario semantics but exercises only
agi-sdk: the native orchestrator drives the loop, a small Python shim
plays the role of the MCP transport for the search_knowledge_base tool,
and the KB content is loaded verbatim from the care-intelligence seed.

What this proves:
    - The native orchestrator's tool-dispatch loop works against a real
      multi-step pattern (model → tool_call → tool_result → final reply).
    - Pack tool_allowlist correctly gates tool availability.
    - The MCP-shim contract (tool(name).call(**args)) is enough for a real
      consumer to integrate without holding an MCP SDK dependency.

What this does NOT prove (yet, captured in C5):
    - Runtime-layer KB tool dispatch — BundleLoader.dispatch() is still a
      fixture-envelope stub.
    - Real vector search — this smoke uses a tiny keyword-match shim; the
      production path would index the KB into Qdrant/pgvector/Mongo Atlas.

Run from repo root:

    AGI_DISABLE_TRACELOOP=1 \\
    OLLAMA_API_BASE=http://localhost:11434 \\
    uv run python .smoke/sdk_deflect_smoke.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from agi.config import Pack
from agi.models import ModelBinding
from agi.orchestrators.native import (
    FileJsonlCheckpointStore,
    run_use_case,
)
from agi.trail import FileJsonlTrailSink

REPO_ROOT = Path(__file__).resolve().parent.parent
KB_PATH = (
    REPO_ROOT.parent
    / "care-intelligence"
    / "backend"
    / "ai-poc-backend"
    / "app"
    / "solutions"
    / "care_intelligence"
    / "data"
    / "seed"
    / "kb"
    / "bluemarble.json"
)


# ---------------------------------------------------------------------------
# search_knowledge_base — a Python shim playing the role of the MCP tool.
# ---------------------------------------------------------------------------


def _load_kb() -> list[dict[str, Any]]:
    if not KB_PATH.exists():
        raise FileNotFoundError(
            f"care-intelligence KB seed not found at {KB_PATH}. "
            "Ensure the care-intelligence repo is checked out alongside project-agi."
        )
    return json.loads(KB_PATH.read_text())


def _kb_score(article: dict[str, Any], query: str) -> float:
    """Tiny keyword scorer — title + tags + content. Real path uses Qdrant."""
    q = query.lower()
    hay = " ".join(
        [
            article.get("title", ""),
            " ".join(article.get("tags") or []),
            article.get("summary", ""),
            article.get("content", ""),
        ]
    ).lower()
    # ratio of query tokens that appear in the haystack
    tokens = [t for t in q.replace("?", "").replace(".", "").split() if t and len(t) > 2]
    if not tokens:
        return 0.0
    hits = sum(1 for t in tokens if t in hay)
    return hits / len(tokens)


def search_knowledge_base(query: str, category: str | None = None) -> dict[str, Any]:
    """Same name + arg shape as the care-intelligence MCP tool."""
    kb = _load_kb()
    if category:
        kb = [a for a in kb if a.get("category") == category]
    scored = sorted(
        ((art, _kb_score(art, query)) for art in kb if art.get("is_active", True)),
        key=lambda pair: pair[1],
        reverse=True,
    )
    if not scored or scored[0][1] < 0.3:
        return {"matched": False, "results": [], "confidence": 0.0}
    top, score = scored[0]
    return {
        "matched": True,
        "confidence": round(score, 3),
        "article": {
            "id": top["id"],
            "title": top["title"],
            "summary": top.get("summary", ""),
            "content": top.get("content", ""),
        },
        "results": [{"id": top["id"], "title": top["title"], "score": round(score, 3)}],
    }


# ---------------------------------------------------------------------------
# MCP shim — what the orchestrator actually calls.
# ---------------------------------------------------------------------------


class _ToolClient:
    def __init__(self, name: str, calls: list[tuple[str, dict[str, Any]]]) -> None:
        self._name = name
        self._calls = calls

    async def call(self, **kwargs: Any) -> dict[str, Any]:
        self._calls.append((self._name, kwargs))
        if self._name == "search_knowledge_base":
            return search_knowledge_base(**kwargs)
        return {"ok": False, "tool": self._name, "error": "unknown_tool", "args": kwargs}


class _DeflectMCP:
    """The contract the orchestrator needs: ``tool(name).call(**args)``."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def tool(self, name: str) -> _ToolClient:
        return _ToolClient(name, self.calls)


# ---------------------------------------------------------------------------
# Scenario driver
# ---------------------------------------------------------------------------


SCENARIO = {
    "id": "deflect-esim-install",
    "customer_opening": "How do I install my eSIM on iPhone 15?",
    "expected_response_phrases": ["BlueMarble", "eSIM"],
    "expected_response_not_contains": ["ticket", "specialist"],
    "expected_tool_sequence": ["search_knowledge_base"],
}

SYSTEM_PROMPT = (
    "You are a customer-care assistant for BlueMarble, a mobile network operator.\n\n"
    "Tool use protocol (FOLLOW EXACTLY):\n"
    "  Turn 1: Call search_knowledge_base ONE time with the user's question as the query.\n"
    "  Turn 2: You will receive the article in a tool message. Do NOT call the tool again. "
    "Read the article and write your reply directly. Your reply must be plain text, "
    "no tool calls.\n\n"
    "Reply rules: cite BlueMarble by name, use the article's exact steps, keep under 80 words, "
    "never invent ticket numbers, never mention a specialist when the KB already answers "
    "the question."
)


TOOLS_OPENAI_SCHEMA: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": (
                "Search the BlueMarble Knowledge Base for an article matching the user's question."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The user's question, verbatim."},
                    "category": {
                        "type": "string",
                        "description": (
                            "Optional filter: device, plan, billing, roaming, voicemail."
                        ),
                    },
                },
                "required": ["query"],
            },
        },
    }
]


async def main() -> int:
    base = os.environ.get("OLLAMA_API_BASE", "http://localhost:11434")
    model_id = os.environ.get("AGI_SMOKE_MODEL", "ollama/llama3.2:latest")

    print(f"[deflect] Ollama base: {base}")
    print(f"[deflect] Model:       {model_id}")
    print(f"[deflect] KB seed:     {KB_PATH}")
    print(f"[deflect] Scenario:    {SCENARIO['id']}")
    print()

    binding = ModelBinding(
        role="reasoning",
        model_id=model_id,
        region=None,
        default_params={"temperature": 0.2, "max_tokens": 256, "api_base": base},
        extra={},
    )
    pack = Pack(
        slug="bluemarble",
        version="0.1.0",
        name="BlueMarble (port)",
        tool_allowlist=["search_knowledge_base"],
        tool_denylist=[],
    )
    trail = FileJsonlTrailSink(".smoke/deflect-trail.jsonl")
    store = FileJsonlCheckpointStore(".smoke/deflect-runs")
    mcp = _DeflectMCP()

    print("[deflect] driving run_use_case ...")
    run = await run_use_case(
        binding=binding,
        mcp=mcp,  # type: ignore[arg-type]
        pack=pack,
        use_case_slug="deflect_esim_install",
        use_case_version="0.1.0",
        correlation_id="deflect-esim-1",
        tenant_id="bluemarble",
        session_id="sess-deflect",
        user_message=SCENARIO["customer_opening"],
        system_prompt=SYSTEM_PROMPT,
        available_tools=TOOLS_OPENAI_SCHEMA,
        checkpoint_store=store,
        trail_sink=trail,
        max_steps=6,
        max_tool_calls=1,  # scenario expects ONE search; force text reply after
    )

    print()
    print("--- run summary ---")
    print(f"  status:       {run.status}")
    print(f"  steps:        {run.step}")
    print(f"  run_id:       {run.run_id}")
    print(f"  message tree: {[m.role for m in run.messages]}")
    print(f"  tool calls:   {mcp.calls}")
    reply = (run.result or {}).get("reply", "")
    print(f"  reply:        {reply!r}")
    print()

    # ---- Scenario expectations vs reality -------------------------------
    print("--- scenario verdict ---")
    passes = 0
    fails = 0

    def check(label: str, cond: bool, detail: str = "") -> None:
        nonlocal passes, fails
        mark = "PASS" if cond else "FAIL"
        if cond:
            passes += 1
        else:
            fails += 1
        print(f"  [{mark}] {label}{(' · ' + detail) if detail else ''}")

    check("run completed", run.status == "completed")
    check(
        "expected_tool_sequence == [search_knowledge_base]",
        [c[0] for c in mcp.calls] == SCENARIO["expected_tool_sequence"],
        detail=str([c[0] for c in mcp.calls]),
    )
    for phrase in SCENARIO["expected_response_phrases"]:
        check(f"reply contains '{phrase}'", phrase.lower() in reply.lower())
    for phrase in SCENARIO["expected_response_not_contains"]:
        check(
            f"reply does NOT contain '{phrase}'",
            phrase.lower() not in reply.lower(),
        )

    print(f"\n  passes: {passes}   fails: {fails}")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
