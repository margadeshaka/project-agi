# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Env-driven Core settings.

Reads `AGI_CORE_*` env vars at boot. The most important ones:

- `AGI_CORE_REGISTRY_PATH` — JSON file persisted on every registry write.
- `AGI_CORE_HUB_ENDPOINTS` — JSON `{"<domain>": "<base_url>", ...}` or a
  path to a JSON file with that shape. Phase 2 default = empty (use the
  echo backend in tests).
- `AGI_CORE_LOG_LEVEL` — default INFO.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class CoreSettings(BaseSettings):
    host: str = "0.0.0.0"  # noqa: S104  # service binds all interfaces by design
    port: int = 9000
    log_level: str = "INFO"

    registry_path: Path | None = None
    hub_endpoints: dict[str, str] = {}
    hub_timeout_s: float = 15.0

    model_config = SettingsConfigDict(env_prefix="AGI_CORE_", extra="ignore")

    @field_validator("hub_endpoints", mode="before")
    @classmethod
    def _coerce_hub_endpoints(cls, v: Any) -> Any:
        """Accept either a JSON-encoded mapping or a path to a JSON file."""
        if v is None or v == "":
            return {}
        if isinstance(v, dict):
            return v
        if isinstance(v, str):
            s = v.strip()
            if s.startswith("{"):
                return json.loads(s)
            p = Path(s)
            if p.exists():
                return json.loads(p.read_text())
            return {}
        return v
