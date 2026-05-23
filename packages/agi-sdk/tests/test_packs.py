# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""Smoke tests for :func:`agi.packs.load_pack` against the blank reference pack."""

from __future__ import annotations

from pathlib import Path

import pytest

from agi.config import Pack
from agi.packs import PackLoadError, load_pack


def _blank_pack_path() -> Path:
    # tests/test_packs.py → tests/ → agi-sdk/ → packages/ → blank pack
    return Path(__file__).resolve().parents[2] / "agi-packs" / "blank"


def test_load_blank_pack_returns_pack_with_expected_shape() -> None:
    pack_path = _blank_pack_path()
    assert pack_path.is_dir(), f"Reference blank pack missing at {pack_path}"

    pack = load_pack(pack_path)

    assert isinstance(pack, Pack)
    assert pack.slug == "blank"
    assert pack.version == "0.1.0"
    assert pack.name == "Blank reference pack"
    # Declared model roles read from pack.yaml `models:` list.
    assert set(pack.declared_model_roles) == {"reasoning", "fast"}
    # Empty tools.yaml → empty allow-list.
    assert pack.tool_allowlist == []
    # prompts/ + kb/ folders exist as empty directories in the blank pack.
    assert pack.prompts_dir is not None
    assert pack.prompts_dir.is_dir()
    assert pack.kb_dir is not None
    assert pack.kb_dir.is_dir()


def test_load_pack_rejects_missing_manifest(tmp_path: Path) -> None:
    with pytest.raises(PackLoadError):
        load_pack(tmp_path)


def test_load_pack_rejects_non_directory(tmp_path: Path) -> None:
    missing = tmp_path / "not_a_pack"
    with pytest.raises(PackLoadError):
        load_pack(missing)
