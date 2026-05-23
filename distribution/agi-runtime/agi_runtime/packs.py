# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""In-process pack loader + cache.

Reads every subdirectory of ``${AGI_PACKS_DIR}`` (default ``/etc/agi/packs/``)
through :func:`agi.packs.load_pack`. Wired into the FastAPI lifespan so the
load+validate cost is paid once, and surfaced on ``request.state.pack_loader``
for downstream handlers.

This is *deliberately* not a hot-reload daemon — operators call
``POST /admin/packs/{slug}/reload`` (see :mod:`agi_runtime.routes.admin`) when
they want fresh state, which gives us a clean audit trail and avoids races
with in-flight requests.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from agi.config import Pack
from agi.packs import PackLoadError, load_pack

logger = logging.getLogger("agi_runtime.packs")


class PackLoader:
    """Load + cache :class:`agi.config.Pack` objects from a root directory."""

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)
        self._cache: dict[str, Pack] = {}
        self._shas: dict[str, str] = {}

    @property
    def root(self) -> Path:
        return self._root

    def load_all(self) -> None:
        """(Re)scan ``root`` and load every subdirectory that holds a pack.yaml."""
        self._cache.clear()
        self._shas.clear()
        if not self._root.is_dir():
            logger.info("PackLoader: root %s does not exist; starting empty", self._root)
            return
        for entry in sorted(self._root.iterdir()):
            if not entry.is_dir():
                continue
            try:
                pack = load_pack(entry)
            except PackLoadError as exc:
                logger.warning("skipping pack at %s: %s", entry, exc)
                continue
            self._cache[pack.slug] = pack
            self._shas[pack.slug] = _pack_sha(entry)
            logger.info("loaded pack %s@%s from %s", pack.slug, pack.version, entry)

    def get(self, slug: str) -> Pack | None:
        return self._cache.get(slug)

    def reload(self, slug: str) -> Pack | None:
        """Reload one pack by slug. Returns the new :class:`Pack` or ``None``.

        Raises :class:`agi.packs.PackLoadError` when the pack folder went bad
        between loads so the operator sees the real error in their admin call.
        """
        entry: Path | None = None
        candidate = self._root / slug
        if candidate.is_dir():
            entry = candidate
        else:
            # Fall back to scanning — the dir name may not equal the slug.
            for sub in self._root.iterdir():
                if not sub.is_dir():
                    continue
                try:
                    candidate_pack = load_pack(sub)
                except PackLoadError:
                    continue
                if candidate_pack.slug == slug:
                    entry = sub
                    break
        if entry is None:
            # Not on disk anymore — drop from cache.
            self._cache.pop(slug, None)
            self._shas.pop(slug, None)
            return None
        pack = load_pack(entry)
        self._cache[pack.slug] = pack
        self._shas[pack.slug] = _pack_sha(entry)
        return pack

    def list_slugs(self) -> list[str]:
        return sorted(self._cache.keys())

    def sha(self, slug: str) -> str | None:
        return self._shas.get(slug)


def _pack_sha(root: Path) -> str:
    """Stable SHA over pack.yaml + tools.yaml — good enough for reload audit."""
    h = hashlib.sha256()
    for fname in ("pack.yaml", "tools.yaml"):
        p = root / fname
        if p.exists():
            h.update(p.read_bytes())
    return h.hexdigest()[:16]


__all__ = ["PackLoader"]
