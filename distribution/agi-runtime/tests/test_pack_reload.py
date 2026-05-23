# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""Pack reload via POST /admin/packs/{slug}/reload + PackLoader unit cover.

Writes a pack folder, loads it through :class:`PackLoader`, modifies
``pack.yaml`` on disk, calls ``reload``, and asserts the new version is
visible in subsequent lookups.
"""

from __future__ import annotations

from pathlib import Path

from agi_runtime.packs import PackLoader


def _write_pack(root: Path, slug: str, version: str) -> Path:
    pack = root / slug
    pack.mkdir(parents=True, exist_ok=True)
    (pack / "pack.yaml").write_text(f"slug: {slug}\nversion: {version}\nname: {slug.title()}\n")
    (pack / "tools.yaml").write_text("allow: []\n")
    return pack


def test_pack_loader_reload_picks_up_changes(tmp_path: Path) -> None:
    _write_pack(tmp_path, "acme", "1.0.0")
    loader = PackLoader(tmp_path)
    loader.load_all()

    pack = loader.get("acme")
    assert pack is not None
    assert pack.version == "1.0.0"
    initial_sha = loader.sha("acme")
    assert initial_sha is not None

    # Mutate on disk.
    (tmp_path / "acme" / "pack.yaml").write_text("slug: acme\nversion: 2.0.0\nname: Acme v2\n")

    reloaded = loader.reload("acme")
    assert reloaded is not None
    assert reloaded.version == "2.0.0"
    assert reloaded.name == "Acme v2"
    assert loader.sha("acme") != initial_sha


def test_pack_loader_reload_missing_returns_none(tmp_path: Path) -> None:
    loader = PackLoader(tmp_path)
    loader.load_all()
    assert loader.reload("ghost") is None
