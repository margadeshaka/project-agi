# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 project-agi contributors
# See LICENSE in the repo root for full terms.
"""Layered config loader — precedence is the load-bearing invariant.

Order (highest → lowest): headers → env → operator yaml → defaults.
"""

from __future__ import annotations

from pathlib import Path

from agi_runtime.config import load_runtime_config


def test_defaults_apply_when_nothing_set(tmp_path: Path) -> None:
    cfg = load_runtime_config(
        operator_config_path=tmp_path / "missing.yaml",
        env={},
        headers={},
    )
    assert cfg.operator_id == "default"
    assert cfg.max_steps == 50
    assert cfg.provenance["max_steps"] == "default"


def test_operator_yaml_is_applied(tmp_path: Path) -> None:
    op = tmp_path / "operator.yaml"
    op.write_text(
        "operator_id: bluemarble-prod\n"
        "packs_dir: /var/agi/packs\n"
        "max_steps: 12\n"
        "models:\n"
        "  reasoning:\n"
        "    model_id: bedrock/anthropic.claude-3-haiku\n"
        "    region: us-east-1\n"
    )
    cfg = load_runtime_config(
        operator_config_path=op,
        env={},
        headers={},
    )
    assert cfg.operator_id == "bluemarble-prod"
    assert str(cfg.packs_dir) == "/var/agi/packs"
    assert cfg.max_steps == 12
    binding = cfg.model_binding("reasoning")
    assert binding is not None
    assert binding.model_id == "bedrock/anthropic.claude-3-haiku"
    assert binding.region == "us-east-1"
    assert cfg.provenance["operator_id"].startswith("operator:")


def test_env_overrides_operator(tmp_path: Path) -> None:
    op = tmp_path / "operator.yaml"
    op.write_text("operator_id: yaml-only\nmax_steps: 5\n")
    cfg = load_runtime_config(
        operator_config_path=op,
        env={"AGI_OPERATOR_ID": "env-wins", "AGI_MAX_STEPS": "99"},
        headers={},
    )
    assert cfg.operator_id == "env-wins"
    assert cfg.max_steps == 99
    assert cfg.provenance["operator_id"] == "env:AGI_OPERATOR_ID"
    assert cfg.provenance["max_steps"] == "env:AGI_MAX_STEPS"


def test_header_overrides_env(tmp_path: Path) -> None:
    cfg = load_runtime_config(
        operator_config_path=tmp_path / "missing.yaml",
        env={"AGI_MAX_STEPS": "20"},
        headers={"X-Max-Steps": "7"},
    )
    assert cfg.max_steps == 7
    assert cfg.provenance["max_steps"] == "header:X-Max-Steps"


def test_env_default_model_when_operator_silent(tmp_path: Path) -> None:
    cfg = load_runtime_config(
        operator_config_path=tmp_path / "missing.yaml",
        env={
            "AGI_DEFAULT_MODEL_ID": "openai/gpt-test",
            "AGI_DEFAULT_MODEL_ROLE": "reasoning",
        },
        headers={},
    )
    binding = cfg.model_binding("reasoning")
    assert binding is not None
    assert binding.model_id == "openai/gpt-test"
    assert cfg.provenance["models"] == "env:AGI_DEFAULT_MODEL_ID"
