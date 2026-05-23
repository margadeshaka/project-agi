# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""agi-mcpfyer — turn an OpenAPI 3 spec into a versioned bundle of MCP tools.

Pure, build-time, library-friendly. No native provider imports. No TMF
assumptions. The generator is a pure function over a parsed OpenAPI dict;
the bundle is plain JSON + YAML on disk; the MCP server stub is the only
runtime piece and is intentionally shallow until Phase 3.
"""

from __future__ import annotations

from agi_mcpfyer.bundle import MCPBundle
from agi_mcpfyer.fetcher import fetch_openapi, load_openapi
from agi_mcpfyer.generator import (
    ToolDescriptor,
    build_bundle,
    default_domain_resolver,
    generate_tools,
)

__version__ = "0.2.0-dev"

__all__ = [
    "MCPBundle",
    "ToolDescriptor",
    "__version__",
    "build_bundle",
    "default_domain_resolver",
    "fetch_openapi",
    "generate_tools",
    "load_openapi",
]
