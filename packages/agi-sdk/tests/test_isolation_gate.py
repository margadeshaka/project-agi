# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""Isolation gate — fails if any SDK source imports a banned package.

Bans two classes of imports:

1. **Distribution packages (band-2)** — ``agi_runtime``, ``agi_ui``,
   ``agi_auth``, ``agi_chart``. The SDK is band-1 (the library); it must
   never pull in any band-2 distribution component.
2. **Native LLM provider SDKs** — ``openai``, ``anthropic``, ``boto3``.
   Roles-not-providers (RESOLVED_STACK Decision 2): use cases call LiteLLM,
   never a native SDK.

The gate is a string scan (not a runtime import scan) so it works without
the optional deps installed.
"""

from __future__ import annotations

import ast
from pathlib import Path

# Modules the SDK must never reach for.
BANNED_TOP_LEVEL = {
    # Distribution packages (band-2) — SDK is band-1, never the reverse
    "agi_runtime",
    "agi_ui",
    "agi_auth",
    "agi_chart",
    # Native LLM provider SDKs
    "openai",
    "anthropic",
    "boto3",
}

# Banned namespace prefixes (dotted). A hit on `agi_runtime.foo` should also
# fail the gate, not just bare `import agi_runtime`.
BANNED_PREFIXES = tuple(BANNED_TOP_LEVEL)


def _sdk_root() -> Path:
    # tests/test_isolation_gate.py → tests/ → agi-sdk/ → agi/
    return Path(__file__).resolve().parent.parent / "agi"


def _iter_py_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.py") if p.is_file())


def _imported_top_levels(source: str) -> set[str]:
    """Return every top-level module name imported anywhere in ``source``.

    Uses AST so docstrings and string literals don't trip the scan.
    """
    out: set[str] = set()
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return out
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                out.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                # Relative import — never references a banned top-level.
                continue
            if node.module:
                out.add(node.module.split(".")[0])
    return out


def test_no_banned_imports_in_sdk() -> None:
    """Every .py under agi/ must avoid the banned namespaces."""
    root = _sdk_root()
    assert root.is_dir(), f"Expected SDK root at {root}"

    offenders: list[tuple[str, str]] = []
    for path in _iter_py_files(root):
        source = path.read_text(encoding="utf-8")
        imports = _imported_top_levels(source)
        hits = imports & BANNED_TOP_LEVEL
        if hits:
            offenders.append((str(path.relative_to(root.parent)), ", ".join(sorted(hits))))

    assert not offenders, (
        "agi-sdk source files import banned packages — the SDK must stay "
        "library-only (no runtime/UI/auth/chart) and provider-agnostic "
        "(no native LLM SDKs). Offenders:\n  "
        + "\n  ".join(f"{path}: {names}" for path, names in offenders)
    )
