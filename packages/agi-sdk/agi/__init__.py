# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""project-agi SDK — primitives for use-case authors.

This module is the single import surface every use-case writes against. It:

1. Boots OpenTelemetry + Traceloop / OpenLLMetry auto-instrumentation at
   import time (idempotent, gated on the ``AGI_DISABLE_TRACELOOP`` env var so
   tests stay quiet).
2. Re-exports the three public entry-points: :func:`use_case`,
   :func:`serve`, and :func:`load_pack`.

Heavy primitive APIs (``models``, ``mcp``, ``rag``, ``prompts``, ``config``,
``trail``) are *not* re-exported here — they're attached to the ``SDK``
instance handed to a use-case at boot. Use cases reach them via
``self.sdk.models``, ``self.sdk.mcp``, etc. That keeps the top-level
namespace small and intentional.
"""

from __future__ import annotations

import os
import threading
from typing import Any

__version__ = "0.1.0-dev"

_DISABLE_ENV = "AGI_DISABLE_TRACELOOP"
_boot_lock = threading.Lock()
_booted = False


def _disabled() -> bool:
    """Return ``True`` if telemetry boot should be skipped (tests / CI)."""
    return os.environ.get(_DISABLE_ENV, "").strip() not in ("", "0", "false", "False")


def _bootstrap_traceloop() -> None:
    """Initialise Traceloop / OpenLLMetry. Idempotent; safe to call repeatedly.

    This is best-effort — if ``traceloop-sdk`` isn't installed (e.g., dev
    laptop without optional deps) we no-op rather than crashing the import.
    """
    global _booted
    with _boot_lock:
        if _booted:
            return
        _booted = True
        if _disabled():
            return
        try:  # pragma: no cover - exercised in integration tests, not unit
            from traceloop.sdk import Traceloop  # type: ignore[import-not-found]
        except Exception:
            return
        init_kwargs: dict[str, Any] = {
            "app_name": os.environ.get("AGI_APP_NAME", "agi-sdk"),
            "disable_batch": False,
            "traceloop_sync_enabled": False,
            "api_key": os.environ.get("TRACELOOP_API_KEY", "unused-otlp-direct"),
        }
        endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        if endpoint:
            init_kwargs["api_endpoint"] = endpoint
        try:
            Traceloop.init(**init_kwargs)
        except Exception:
            # Telemetry failure must never kill the host process.
            return


_bootstrap_traceloop()

# Late imports so the bootstrap above runs first and submodule code can rely
# on OpenLLMetry instrumentations being present (or stubbed) at definition time.
from agi.packs import load_pack  # noqa: E402
from agi.serve import serve  # noqa: E402
from agi.use_case import use_case  # noqa: E402

__all__ = [
    "__version__",
    "load_pack",
    "serve",
    "use_case",
]
