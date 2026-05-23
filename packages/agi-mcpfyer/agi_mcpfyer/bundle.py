# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Versioned MCP tool bundle — on-disk artefact produced by `build_bundle`.

Layout written by `to_disk(path)`:

    <path>/
      manifest.json        # bundle metadata (version, source, generated_at, source_api)
      tools.json           # list[ToolDescriptor] as JSON

That's it. Two files. Read+write round-trip is the only invariant.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agi_mcpfyer.generator import ToolDescriptor


@dataclass
class MCPBundle:
    """A frozen-on-disk snapshot of tools derived from one OpenAPI spec.

    `version` is the SHA-256 of the canonicalised input spec — change a
    byte of input, get a new bundle ID. This is what makes the "build-time"
    generator promise true: bundles are content-addressed, not timestamped.
    """

    tools: list[ToolDescriptor]
    version: str
    source: str
    generated_at: str
    source_api: str = ""
    extras: dict[str, Any] = field(default_factory=dict)

    def to_disk(self, path: str | Path) -> Path:
        out = Path(path)
        out.mkdir(parents=True, exist_ok=True)
        manifest = {
            "version": self.version,
            "source": self.source,
            "generated_at": self.generated_at,
            "source_api": self.source_api,
            "tool_count": len(self.tools),
            "extras": self.extras,
        }
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
        (out / "tools.json").write_text(
            json.dumps([asdict(t) for t in self.tools], indent=2, sort_keys=True)
        )
        return out

    @classmethod
    def from_disk(cls, path: str | Path) -> MCPBundle:
        # Late import to avoid a circular dep at module load.
        from agi_mcpfyer.generator import ToolDescriptor

        src = Path(path)
        manifest = json.loads((src / "manifest.json").read_text())
        tools_raw = json.loads((src / "tools.json").read_text())
        tools = [ToolDescriptor(**t) for t in tools_raw]
        return cls(
            tools=tools,
            version=manifest["version"],
            source=manifest["source"],
            generated_at=manifest["generated_at"],
            source_api=manifest.get("source_api", ""),
            extras=manifest.get("extras") or {},
        )

    def summary(self) -> dict[str, Any]:
        """Human-friendly summary printed by the CLI's `inspect` subcommand."""
        side_effecting = sum(1 for t in self.tools if t.side_effecting)
        by_domain: dict[str, int] = {}
        for t in self.tools:
            by_domain[t.domain] = by_domain.get(t.domain, 0) + 1
        return {
            "version": self.version,
            "source": self.source,
            "source_api": self.source_api,
            "generated_at": self.generated_at,
            "tool_count": len(self.tools),
            "side_effecting_count": side_effecting,
            "tools_by_domain": by_domain,
        }
