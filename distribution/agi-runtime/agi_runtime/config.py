# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""Layered runtime configuration loader.

Precedence (highest wins):

  1. per-request headers   (``X-Model-Role``, ``X-Max-Steps``, …)
  2. environment variables (``AGI_*``)
  3. operator yaml         (``$AGI_OPERATOR_CONFIG``)
  4. built-in defaults

The runtime is the first place where this precedence stack actually
materialises — the SDK only sees the final snapshot. We keep the merge logic
small, deterministic, and fully covered by ``tests/test_config_precedence.py``.

The returned :class:`RuntimeConfig` is intentionally schemaless beyond the
top-level fields we touch; everything below is a free-form dict so packs and
use-cases can pull operator-defined extras without forcing us to model them
here.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

import yaml


_DEFAULT_OPERATOR_CONFIG_PATH = "/etc/agi/operator.yaml"
_DEFAULT_PACKS_DIR = "/etc/agi/packs"
_DEFAULT_BUNDLES_DIR = "/etc/agi/bundles"
_DEFAULT_MAX_STEPS = 50


@dataclass
class ModelBindingConfig:
    """One role-to-model binding as resolved by the runtime."""

    role: str
    model_id: str
    region: str | None = None
    default_params: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class RuntimeConfig:
    """Snapshot of resolved runtime configuration.

    Each layer that contributed a value gets recorded in ``provenance`` so
    ``/admin/log`` can answer "where did X come from?" without re-running the
    loader.
    """

    operator_id: str = "default"
    packs_dir: Path = field(default_factory=lambda: Path(_DEFAULT_PACKS_DIR))
    bundles_dir: Path = field(default_factory=lambda: Path(_DEFAULT_BUNDLES_DIR))
    trail_file: Path | None = None
    models: dict[str, ModelBindingConfig] = field(default_factory=dict)
    max_steps: int = _DEFAULT_MAX_STEPS
    raw_operator: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, str] = field(default_factory=dict)

    def model_binding(self, role: str) -> ModelBindingConfig | None:
        """Return the resolved binding for ``role`` (or ``None`` if unbound)."""
        return self.models.get(role)


def _load_operator_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    raw = yaml.safe_load(path.read_text()) or {}
    if not isinstance(raw, dict):
        raise ValueError(
            f"operator config at {path} must be a top-level mapping; got {type(raw).__name__}"
        )
    return raw


def _coerce_models(raw_models: Any) -> dict[str, ModelBindingConfig]:
    """Parse the ``models:`` block from operator yaml into typed bindings."""
    out: dict[str, ModelBindingConfig] = {}
    if not isinstance(raw_models, dict):
        return out
    for role, cfg in raw_models.items():
        if not isinstance(role, str) or not isinstance(cfg, dict):
            continue
        model_id = cfg.get("model_id") or cfg.get("model")
        if not isinstance(model_id, str) or not model_id:
            continue
        out[role] = ModelBindingConfig(
            role=role,
            model_id=model_id,
            region=cfg.get("region") if isinstance(cfg.get("region"), str) else None,
            default_params=dict(cfg.get("default_params") or {}),
            extra=dict(cfg.get("extra") or {}),
        )
    return out


def _from_env() -> dict[str, str]:
    """Surface AGI_* env vars relevant to the runtime."""
    keys = (
        "AGI_OPERATOR_CONFIG",
        "AGI_PACKS_DIR",
        "AGI_BUNDLES_DIR",
        "AGI_TRAIL_FILE",
        "AGI_OPERATOR_ID",
        "AGI_MAX_STEPS",
        "AGI_DEFAULT_MODEL_ID",
        "AGI_DEFAULT_MODEL_ROLE",
    )
    return {k: os.environ[k] for k in keys if k in os.environ and os.environ[k] != ""}


def load_runtime_config(
    *,
    operator_config_path: str | os.PathLike[str] | None = None,
    headers: Mapping[str, str] | None = None,
    env: Mapping[str, str] | None = None,
) -> RuntimeConfig:
    """Build a :class:`RuntimeConfig` by collapsing the four layers.

    Parameters
    ----------
    operator_config_path:
        Override path to ``operator.yaml``. Defaults to ``$AGI_OPERATOR_CONFIG``
        then ``/etc/agi/operator.yaml``.
    headers:
        Per-request headers (typically ``request.headers``). Recognised:
        ``X-Max-Steps``, ``X-Model-Role`` (sets the default role hint).
    env:
        Override env dict; defaults to ``os.environ``. Tests pass a dict.
    """
    env_map = dict(env) if env is not None else _from_env()
    hdr_map: dict[str, str] = {k.lower(): v for k, v in (headers or {}).items()}

    # ---- Layer 4: defaults ------------------------------------------------
    cfg = RuntimeConfig()
    cfg.provenance.setdefault("packs_dir", "default")
    cfg.provenance.setdefault("bundles_dir", "default")
    cfg.provenance.setdefault("max_steps", "default")

    # ---- Layer 3: operator yaml ------------------------------------------
    op_path_str = (
        str(operator_config_path)
        if operator_config_path is not None
        else env_map.get("AGI_OPERATOR_CONFIG", _DEFAULT_OPERATOR_CONFIG_PATH)
    )
    op_path = Path(op_path_str)
    raw = _load_operator_yaml(op_path)
    if raw:
        cfg.raw_operator = raw
        if isinstance(raw.get("operator_id"), str):
            cfg.operator_id = raw["operator_id"]
            cfg.provenance["operator_id"] = f"operator:{op_path}"
        if isinstance(raw.get("packs_dir"), str):
            cfg.packs_dir = Path(raw["packs_dir"])
            cfg.provenance["packs_dir"] = f"operator:{op_path}"
        if isinstance(raw.get("bundles_dir"), str):
            cfg.bundles_dir = Path(raw["bundles_dir"])
            cfg.provenance["bundles_dir"] = f"operator:{op_path}"
        if isinstance(raw.get("trail_file"), str):
            cfg.trail_file = Path(raw["trail_file"])
            cfg.provenance["trail_file"] = f"operator:{op_path}"
        if isinstance(raw.get("max_steps"), int):
            cfg.max_steps = int(raw["max_steps"])
            cfg.provenance["max_steps"] = f"operator:{op_path}"
        cfg.models = _coerce_models(raw.get("models"))
        if cfg.models:
            cfg.provenance["models"] = f"operator:{op_path}"

    # ---- Layer 2: env vars (override operator) ----------------------------
    if "AGI_OPERATOR_ID" in env_map:
        cfg.operator_id = env_map["AGI_OPERATOR_ID"]
        cfg.provenance["operator_id"] = "env:AGI_OPERATOR_ID"
    if "AGI_PACKS_DIR" in env_map:
        cfg.packs_dir = Path(env_map["AGI_PACKS_DIR"])
        cfg.provenance["packs_dir"] = "env:AGI_PACKS_DIR"
    if "AGI_BUNDLES_DIR" in env_map:
        cfg.bundles_dir = Path(env_map["AGI_BUNDLES_DIR"])
        cfg.provenance["bundles_dir"] = "env:AGI_BUNDLES_DIR"
    if "AGI_TRAIL_FILE" in env_map:
        cfg.trail_file = Path(env_map["AGI_TRAIL_FILE"])
        cfg.provenance["trail_file"] = "env:AGI_TRAIL_FILE"
    if "AGI_MAX_STEPS" in env_map:
        try:
            cfg.max_steps = int(env_map["AGI_MAX_STEPS"])
            cfg.provenance["max_steps"] = "env:AGI_MAX_STEPS"
        except ValueError:
            pass
    # Env-level model fallback: if there are no operator-bound roles, allow a
    # single env-pinned model. Useful for `make dev` smoke tests.
    if not cfg.models and "AGI_DEFAULT_MODEL_ID" in env_map:
        role = env_map.get("AGI_DEFAULT_MODEL_ROLE", "reasoning")
        cfg.models[role] = ModelBindingConfig(
            role=role,
            model_id=env_map["AGI_DEFAULT_MODEL_ID"],
        )
        cfg.provenance["models"] = "env:AGI_DEFAULT_MODEL_ID"

    # ---- Layer 1: per-request headers (highest precedence) ----------------
    if "x-max-steps" in hdr_map:
        try:
            cfg.max_steps = int(hdr_map["x-max-steps"])
            cfg.provenance["max_steps"] = "header:X-Max-Steps"
        except ValueError:
            pass

    return cfg


__all__ = [
    "ModelBindingConfig",
    "RuntimeConfig",
    "load_runtime_config",
]
