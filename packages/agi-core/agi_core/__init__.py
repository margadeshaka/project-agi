# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""project-agi Intelligence Core.

Two pieces matter:

- `agi_core.registry` — in-memory ToolDescriptor/UseCaseDescriptor catalogue
  with optional JSON file persistence. The same shape used in v0, just
  decoupled from any TMF/BSS naming.
- `agi_core.hub` — HubProxy that forwards MCP tool calls to a configured
  backend per logical domain. In Phase 2 backends echo requests; Phase 3
  swaps the echo for the live mcpfyer-generated MCP server proxy.

`agi_core.http_routes` exposes both over FastAPI. `agi_core.main` is the
uvicorn-launchable wiring.
"""

from __future__ import annotations

from agi_core.hub import HubBackend, HubProxy, HubProxyError
from agi_core.registry import (
    Registry,
    ToolDescriptor,
    UseCaseDescriptor,
)
from agi_core.settings import CoreSettings

__version__ = "0.2.0-dev"

__all__ = [
    "CoreSettings",
    "HubBackend",
    "HubProxy",
    "HubProxyError",
    "Registry",
    "ToolDescriptor",
    "UseCaseDescriptor",
    "__version__",
]
