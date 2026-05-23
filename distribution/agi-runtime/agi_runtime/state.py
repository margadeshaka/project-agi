# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""Per-process runtime state — pack loader, bundle loader, trail sink.

Built once at FastAPI startup and attached to ``app.state`` so middleware and
routes can read it via ``request.app.state.runtime``. Tests poke fields here
directly via ``app.state.runtime = ...`` after construction.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from agi.trail import FileJsonlTrailSink, MemoryTrailSink, TrailSink

from agi_runtime.config import RuntimeConfig, load_runtime_config
from agi_runtime.packs import PackLoader
from agi_runtime.tool_bundles import BundleLoader

logger = logging.getLogger("agi_runtime.state")


@dataclass
class RuntimeState:
    """The container handed off to every request via ``app.state.runtime``."""

    config: RuntimeConfig
    pack_loader: PackLoader
    bundle_loader: BundleLoader
    trail_sink: TrailSink
    admin_sink: TrailSink
    started_at: float = field(default_factory=time.time)
    extras: dict[str, Any] = field(default_factory=dict)


def build_runtime_state() -> RuntimeState:
    """Wire defaults from env, then load pack & bundle directories."""
    cfg = load_runtime_config()
    pack_loader = PackLoader(cfg.packs_dir)
    pack_loader.load_all()
    bundle_loader = BundleLoader(cfg.bundles_dir)
    bundle_loader.load_all()

    trail_sink: TrailSink
    if cfg.trail_file is not None:
        trail_sink = FileJsonlTrailSink(cfg.trail_file)
        logger.info("trail sink: FileJsonlTrailSink at %s", cfg.trail_file)
    else:
        trail_sink = MemoryTrailSink()
        logger.info("trail sink: in-memory (set AGI_TRAIL_FILE to persist)")

    # Admin actions live in a separate sink so they don't get filter-paginated
    # alongside agent events. Always in-memory unless an operator wires a
    # dedicated path — keeping the surface tiny here.
    admin_sink: TrailSink = MemoryTrailSink()

    return RuntimeState(
        config=cfg,
        pack_loader=pack_loader,
        bundle_loader=bundle_loader,
        trail_sink=trail_sink,
        admin_sink=admin_sink,
    )


__all__ = ["RuntimeState", "build_runtime_state"]
