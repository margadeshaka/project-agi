# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""MCP bundle loader + (stub) dispatcher.

Reads every subdirectory of ``${AGI_BUNDLES_DIR}`` (default
``/etc/agi/bundles/``) through :meth:`agi_mcpfyer.bundle.MCPBundle.from_disk`,
keeps them in memory, and exposes:

- :meth:`BundleLoader.all_tools_for(pack)` — OpenAI-format tool dicts, filtered
  through :func:`agi.orchestrators.native.resolve_tools` for the active pack.
- :meth:`BundleLoader.get_tool(name)` — single descriptor (cross-bundle).
- :meth:`BundleLoader.dispatch(name, args)` — STUBBED. Real MCP server
  invocation lands in the P3 fast-follow; for now returns a fixture envelope.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from agi.orchestrators.native import resolve_tools

logger = logging.getLogger("agi_runtime.tool_bundles")


class BundleLoader:
    """Load + cache MCP tool bundles from disk; expose them as OpenAI tools."""

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)
        # bundle_id -> bundle object
        self._bundles: dict[str, Any] = {}
        # tool_name -> (bundle_id, descriptor)
        self._tools_by_name: dict[str, tuple[str, Any]] = {}

    @property
    def root(self) -> Path:
        return self._root

    def load_all(self) -> None:
        """(Re)scan ``root`` and load every bundle subdirectory."""
        self._bundles.clear()
        self._tools_by_name.clear()
        if not self._root.is_dir():
            logger.info("BundleLoader: root %s does not exist; starting empty", self._root)
            return
        try:
            from agi_mcpfyer import MCPBundle
        except Exception as exc:  # noqa: BLE001
            logger.warning("agi_mcpfyer not importable; bundle loading skipped: %s", exc)
            return
        for entry in sorted(self._root.iterdir()):
            if not entry.is_dir():
                continue
            try:
                bundle = MCPBundle.from_disk(entry)
            except Exception as exc:  # noqa: BLE001
                logger.warning("skipping bundle at %s: %s", entry, exc)
                continue
            bundle_id = entry.name
            self._bundles[bundle_id] = bundle
            for descriptor in bundle.tools:
                self._tools_by_name[descriptor.name] = (bundle_id, descriptor)
            logger.info(
                "loaded bundle %s (%d tools) from %s",
                bundle_id,
                len(bundle.tools),
                entry,
            )

    def list_bundles(self) -> list[str]:
        return sorted(self._bundles.keys())

    def all_descriptors(self) -> list[Any]:
        """Return every tool descriptor across all bundles."""
        return [desc for _, desc in self._tools_by_name.values()]

    def all_tools_openai_schema(self) -> list[dict[str, Any]]:
        """Return every loaded tool as an OpenAI function-tool schema dict."""
        return [_to_openai_tool(desc) for desc in self.all_descriptors()]

    def all_tools_for(self, pack: Any) -> list[dict[str, Any]]:
        """Return OpenAI-format tool dicts filtered to ``pack``'s allow-list.

        ``agi.config.Pack`` exposes ``tool_allowlist`` and ``tool_denylist``
        directly (see consolidation pass 2026-05-22); pass through unchanged.
        """
        return resolve_tools(pack, self.all_tools_openai_schema())

    def get_tool(self, name: str) -> Any | None:
        entry = self._tools_by_name.get(name)
        return entry[1] if entry else None

    async def dispatch(
        self,
        name: str,
        args: dict[str, Any],
        *,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        """STUB dispatch — returns a fixture envelope.

        Real MCP server invocation (streamable-HTTP transport, claims-aware
        client) is the P3 fast-follow. The envelope shape mirrors what the
        real dispatch will return so callers don't need to change later.
        """
        descriptor = self.get_tool(name)
        if descriptor is None:
            return {
                "ok": False,
                "tool": name,
                "args": args,
                "stub": True,
                "error": "tool_not_found",
                "correlation_id": correlation_id,
            }
        return {
            "ok": True,
            "tool": name,
            "args": args,
            "stub": True,
            "side_effecting": bool(getattr(descriptor, "side_effecting", False)),
            "correlation_id": correlation_id,
        }


def _to_openai_tool(descriptor: Any) -> dict[str, Any]:
    """Convert a :class:`ToolDescriptor` to the OpenAI function-tool schema."""
    return {
        "type": "function",
        "function": {
            "name": descriptor.name,
            "description": getattr(descriptor, "description", "") or "",
            "parameters": getattr(descriptor, "input_schema", None) or {"type": "object"},
        },
    }


__all__ = ["BundleLoader"]
