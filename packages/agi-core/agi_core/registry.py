# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""In-memory registry of tools and use-cases.

Generalised from the v0 `bm_core.registry`. The v0 registry only modelled
upstream services; this version splits that into two clean concepts:

- `ToolDescriptor` — one MCP tool. Carries enough info to find, document,
  and dispatch it through the hub. Compatible-by-shape with the
  `agi_mcpfyer.ToolDescriptor` so bundles deserialise straight into the
  registry without translation.
- `UseCaseDescriptor` — a named flow that composes tools (think
  Care-Intelligence-style "deflect" / "resolve" / "escalate").

Persistence is optional. Pass `storage_path=` to `Registry()` and every
`register_*` call snapshots to JSON. Reload via `Registry.load(path)`.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path
from threading import RLock
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ToolDescriptor(BaseModel):
    """One MCP tool registered with Core.

    Field set is a superset of `agi_mcpfyer.ToolDescriptor` so a bundle
    deserialises straight in.
    """

    model_config = ConfigDict(extra="ignore")

    name: str = Field(description="Tool name surfaced to MCP clients.")
    domain: str = Field(default="default", description="Logical grouping for hub dispatch.")
    description: str = ""
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] | None = None
    side_effecting: bool = False
    rate_limit_class: str = "read"
    dry_run_supported: bool = False
    method: str = ""
    path_template: str = ""
    param_locations: dict[str, str] = Field(default_factory=dict)
    source_api: str = ""
    source_operation: str = ""


class UseCaseDescriptor(BaseModel):
    """A named flow composing one or more tools."""

    model_config = ConfigDict(extra="ignore")

    name: str
    domain: str = "default"
    description: str = ""
    entry_route: str = ""
    tools: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class Registry:
    """Thread-safe in-memory registry with optional JSON persistence."""

    def __init__(self, *, storage_path: str | Path | None = None) -> None:
        self._tools: dict[str, ToolDescriptor] = {}
        self._use_cases: dict[str, UseCaseDescriptor] = {}
        self._lock = RLock()
        self._storage_path: Path | None = Path(storage_path) if storage_path else None

    def register_tool(self, tool: ToolDescriptor) -> None:
        with self._lock:
            self._tools[tool.name] = tool
            self._maybe_persist()

    def register_tools(self, tools: Iterable[ToolDescriptor]) -> None:
        with self._lock:
            for t in tools:
                self._tools[t.name] = t
            self._maybe_persist()

    def register_use_case(self, use_case: UseCaseDescriptor) -> None:
        with self._lock:
            self._use_cases[use_case.name] = use_case
            self._maybe_persist()

    def list_tools(self, *, domain: str | None = None) -> list[ToolDescriptor]:
        with self._lock:
            if domain is None:
                return list(self._tools.values())
            return [t for t in self._tools.values() if t.domain == domain]

    def list_use_cases(self, *, domain: str | None = None) -> list[UseCaseDescriptor]:
        with self._lock:
            if domain is None:
                return list(self._use_cases.values())
            return [u for u in self._use_cases.values() if u.domain == domain]

    def find(self, name: str) -> ToolDescriptor | None:
        with self._lock:
            return self._tools.get(name)

    def find_use_case(self, name: str) -> UseCaseDescriptor | None:
        with self._lock:
            return self._use_cases.get(name)

    def domains(self) -> list[str]:
        with self._lock:
            return sorted({t.domain for t in self._tools.values()})

    # ------------------------------------------------------------------ persistence

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "tools": [t.model_dump() for t in self._tools.values()],
                "use_cases": [u.model_dump() for u in self._use_cases.values()],
            }

    def restore(self, data: dict[str, Any]) -> None:
        with self._lock:
            self._tools = {
                t["name"]: ToolDescriptor.model_validate(t) for t in data.get("tools", [])
            }
            self._use_cases = {
                u["name"]: UseCaseDescriptor.model_validate(u) for u in data.get("use_cases", [])
            }

    @classmethod
    def load(cls, path: str | Path) -> Registry:
        p = Path(path)
        reg = cls(storage_path=p)
        if p.exists():
            reg.restore(json.loads(p.read_text()))
        return reg

    def _maybe_persist(self) -> None:
        if self._storage_path is None:
            return
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._storage_path.write_text(json.dumps(self.snapshot(), indent=2, sort_keys=True))
