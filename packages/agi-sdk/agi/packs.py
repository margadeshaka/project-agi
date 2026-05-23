# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.packs`` — load a pack folder into an immutable :class:`Pack`.

A pack folder layout::

    <pack>/
      pack.yaml        # slug, version, name, declared model roles
      tools.yaml       # tool allow-list (MCP tool names)
      prompts/         # YAML prompts (see agi.prompts)
      kb/              # KB seed JSON / Markdown

``load_pack`` is read-only: it never writes the pack and never reaches the
network. Missing optional files are tolerated and surface as empty defaults.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from agi.config import Pack


class PackLoadError(RuntimeError):
    """Raised when a pack folder is malformed (missing pack.yaml, bad shape)."""


def load_pack(path: str | Path) -> Pack:
    """Read ``<path>`` and return the immutable :class:`Pack` representation.

    Parameters
    ----------
    path:
        Filesystem path to the pack folder root (the one containing
        ``pack.yaml``).
    """
    root = Path(path)
    if not root.is_dir():
        raise PackLoadError(f"Pack path is not a directory: {root}")

    pack_yaml = root / "pack.yaml"
    if not pack_yaml.exists():
        raise PackLoadError(f"Missing pack.yaml under {root}")

    manifest = _load_yaml_mapping(pack_yaml, label="pack.yaml")

    slug = manifest.get("slug")
    if not isinstance(slug, str) or not slug:
        raise PackLoadError(f"pack.yaml under {root} must declare a non-empty 'slug'")
    version = manifest.get("version")
    if not isinstance(version, str) or not version:
        raise PackLoadError(f"pack.yaml under {root} must declare a non-empty 'version'")

    declared_roles_raw = manifest.get("models", [])
    declared_roles: list[str] = []
    if isinstance(declared_roles_raw, list):
        for entry in declared_roles_raw:
            if isinstance(entry, str):
                declared_roles.append(entry)
            elif isinstance(entry, dict) and isinstance(entry.get("role"), str):
                declared_roles.append(entry["role"])

    tools_yaml = root / "tools.yaml"
    tool_allowlist: list[str] = []
    if tools_yaml.exists():
        tools = _load_yaml_mapping(tools_yaml, label="tools.yaml")
        raw = tools.get("allow", [])
        if isinstance(raw, list):
            tool_allowlist = [t for t in raw if isinstance(t, str)]

    prompts_dir = root / "prompts"
    kb_dir = root / "kb"

    metadata: dict[str, Any] = {
        k: v for k, v in manifest.items() if k not in {"slug", "version", "name", "models"}
    }

    return Pack(
        slug=slug,
        version=version,
        name=manifest.get("name") if isinstance(manifest.get("name"), str) else None,
        declared_model_roles=declared_roles,
        tool_allowlist=tool_allowlist,
        prompts_dir=prompts_dir if prompts_dir.is_dir() else None,
        kb_dir=kb_dir if kb_dir.is_dir() else None,
        metadata=metadata,
    )


def _load_yaml_mapping(path: Path, *, label: str) -> dict[str, Any]:
    raw = yaml.safe_load(path.read_text()) or {}
    if not isinstance(raw, dict):
        raise PackLoadError(f"{label} at {path} must be a mapping; got {type(raw).__name__}")
    return raw


__all__ = ["PackLoadError", "load_pack"]
