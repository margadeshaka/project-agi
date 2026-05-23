# SPDX-License-Identifier: Apache-2.0
"""Real Ollama round-trip via agi-sdk's native orchestrator.

Bypasses the agi-runtime server — exercises the SDK alone:

    pip install agi-sdk → import → run_use_case(...) → real Ollama call

Run from repo root:

    OLLAMA_API_BASE=http://localhost:11434 uv run python .smoke/sdk_ollama_smoke.py
"""

from __future__ import annotations

import asyncio
import os
import sys

from agi.config import Pack
from agi.models import ModelBinding
from agi.orchestrators.native import (
    FileJsonlCheckpointStore,
    run_use_case,
)
from agi.trail import FileJsonlTrailSink


class _MinimalMCP:
    """No-MCP smoke — the prompt doesn't need any tools."""

    def tool(self, name: str):  # type: ignore[no-untyped-def]
        raise RuntimeError(f"tool {name!r} requested but smoke runs tool-less")


async def main() -> int:
    base = os.environ.get("OLLAMA_API_BASE", "http://localhost:11434")
    model_id = os.environ.get("AGI_SMOKE_MODEL", "ollama/llama3.2:latest")

    print(f"[smoke] Ollama base: {base}")
    print(f"[smoke] Model:       {model_id}")

    binding = ModelBinding(
        role="reasoning",
        model_id=model_id,
        region=None,
        default_params={"temperature": 0.3, "max_tokens": 128, "api_base": base},
        extra={},
    )
    pack = Pack(
        slug="smoke",
        version="0.1.0",
        name="Smoke",
        tool_allowlist=[],
        tool_denylist=[],
    )
    trail = FileJsonlTrailSink(".smoke/trail.jsonl")
    store = FileJsonlCheckpointStore(".smoke/runs")

    print("[smoke] calling run_use_case ...")
    run = await run_use_case(
        binding=binding,
        mcp=_MinimalMCP(),  # type: ignore[arg-type]
        pack=pack,
        use_case_slug="smoke",
        use_case_version="0.1.0",
        correlation_id="smoke-1",
        tenant_id="t-smoke",
        session_id="sess-smoke",
        user_message=(
            "Reply with one sentence, under 20 words, "
            "stating that you are llama3.2 running locally via Ollama."
        ),
        system_prompt="You are a helpful, terse assistant.",
        checkpoint_store=store,
        trail_sink=trail,
        max_steps=4,
    )

    print()
    print(f"[smoke] status:        {run.status}")
    print(f"[smoke] step:          {run.step}")
    print(f"[smoke] run_id:        {run.run_id}")
    print(f"[smoke] correlation:   {run.correlation_id}")
    print(f"[smoke] reply:         {(run.result or {}).get('reply')!r}")
    print(f"[smoke] error:         {run.error!r}")

    return 0 if run.status == "completed" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
