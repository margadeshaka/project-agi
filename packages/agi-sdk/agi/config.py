# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.config`` — typed, layered, validated operator + pack config.

Precedence (highest → lowest):
    per-request headers  →  env vars  →  pack.yaml  →  operator.yaml  →  defaults

This module defines the Pydantic schemas (``Pack``, ``OperatorConfig`` and
their leaves) and the ``ConfigAPI`` accessor. The actual layered-load logic
is intentionally stubbed here — Phase 1.5 fleshes out vault resolution,
hot-reload, and the ``agi config explain`` provenance tracker. The shape is
load-bearing now so the rest of the SDK can type-annotate against it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class ModelConfig(BaseModel):
    """One role binding in ``operator.yaml`` under ``models:``."""

    model_id: str
    region: str | None = None
    default_params: dict[str, Any] = Field(default_factory=dict)
    extra: dict[str, Any] = Field(default_factory=dict)
    cost_override: dict[str, float] | None = None


class MCPServerConfig(BaseModel):
    """One MCP server endpoint in ``operator.yaml`` under ``mcp_servers:``."""

    endpoint: str
    transport: str = "stdio"
    auth: dict[str, Any] = Field(default_factory=dict)
    timeout_ms: int = 30_000


class RAGIndexConfig(BaseModel):
    """One vector index binding in ``operator.yaml`` under ``rag_indexes:``."""

    backend: str = "memory"
    connection: dict[str, Any] = Field(default_factory=dict)
    embedding_model: str | None = None
    rerank: dict[str, Any] | None = None


class PromptConfig(BaseModel):
    """Prompt-level operator config (locale fallback policy)."""

    default_locale: str = "en"
    default_flavor: str = "default"


class ThresholdsConfig(BaseModel):
    """Business thresholds — credit caps, escalation rules, confidence cutoffs."""

    values: dict[str, Any] = Field(default_factory=dict)


class ComplianceConfig(BaseModel):
    """Compliance config — PII rules, data residency, disclaimers."""

    redaction_rules: dict[str, Any] = Field(default_factory=dict)
    data_residency: str | None = None
    audit_sink: str | None = None


class RateLimitConfig(BaseModel):
    """Rate limits and cost caps."""

    per_minute: int | None = None
    per_day: int | None = None
    cost_cap_usd: float | None = None


class OperatorConfig(BaseModel):
    """Resolved operator config — the snapshot the SDK runs against."""

    schema_version: int = 1
    operator_id: str = "default"
    operator_name: str = "default"
    region: str | None = None
    locale: list[str] = Field(default_factory=lambda: ["en"])
    models: dict[str, ModelConfig] = Field(default_factory=dict)
    mcp_servers: dict[str, MCPServerConfig] = Field(default_factory=dict)
    rag_indexes: dict[str, RAGIndexConfig] = Field(default_factory=dict)
    prompts: PromptConfig = Field(default_factory=PromptConfig)
    use_case: dict[str, Any] = Field(default_factory=dict)
    thresholds: ThresholdsConfig = Field(default_factory=ThresholdsConfig)
    compliance: ComplianceConfig = Field(default_factory=ComplianceConfig)
    rate_limits: RateLimitConfig = Field(default_factory=RateLimitConfig)


class Pack(BaseModel):
    """In-memory representation of a pack folder.

    A pack groups one tenant's use-cases — slug, manifest, declared model
    roles, tool allow-list, prompts directory, KB seeds. Loaded by
    :func:`agi.packs.load_pack`.
    """

    slug: str
    version: str
    name: str | None = None
    declared_model_roles: list[str] = Field(default_factory=list)
    tool_allowlist: list[str] = Field(default_factory=list)
    tool_denylist: list[str] = Field(default_factory=list)
    prompts_dir: Path | None = None
    kb_dir: Path | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"arbitrary_types_allowed": True}


class ConfigAPI:
    """Layered config accessor handed to use-cases via the SDK facade.

    Phase 1 returns the current snapshot only. Hot-reload, env overlay,
    request-header overlay, and provenance tracking land in Phase 1.5.
    """

    def __init__(self, operator_config: OperatorConfig, *, pack: Pack | None = None) -> None:
        self._operator_config = operator_config
        self._pack = pack

    def current(self) -> OperatorConfig:
        """Return the resolved :class:`OperatorConfig` snapshot."""
        return self._operator_config

    def pack(self) -> Pack | None:
        """Return the active :class:`Pack`, or ``None`` if no pack is bound."""
        return self._pack

    def reload(self) -> None:
        """Reload hot-reloadable fields. Stubbed — implementation lands in Phase 1.5."""
        raise NotImplementedError(
            "TODO: implement layered hot-reload (per-field hot_reload=True metadata)."
        )


def load_operator_config(path: str | Path) -> OperatorConfig:
    """Load and validate an ``operator.yaml`` file into :class:`OperatorConfig`.

    Phase 1: pure YAML + Pydantic. No env overlay, no vault resolution, no
    layered merge. Those land in Phase 1.5.
    """
    raw = yaml.safe_load(Path(path).read_text()) or {}
    if not isinstance(raw, dict):
        raise ValueError(f"operator.yaml must be a mapping; got {type(raw).__name__}")
    return OperatorConfig.model_validate(raw)


__all__ = [
    "ComplianceConfig",
    "ConfigAPI",
    "MCPServerConfig",
    "ModelConfig",
    "OperatorConfig",
    "Pack",
    "PromptConfig",
    "RAGIndexConfig",
    "RateLimitConfig",
    "ThresholdsConfig",
    "load_operator_config",
]
