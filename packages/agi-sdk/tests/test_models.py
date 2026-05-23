# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""Smoke tests for :class:`agi.models.ModelBinding`."""

from __future__ import annotations

import pytest

from agi.models import DuplicateKwargError, ModelBinding


def test_kwargs_returns_model_id_and_defaults() -> None:
    binding = ModelBinding(
        role="reasoning",
        model_id="bedrock/anthropic.claude-3-5-haiku-20241022-v1:0",
        default_params={"max_tokens": 4096, "temperature": 0.3},
    )
    out = binding.kwargs()
    assert out["model"] == binding.model_id
    assert out["max_tokens"] == 4096
    assert out["temperature"] == 0.3


def test_kwargs_overrides_apply_when_no_conflict() -> None:
    binding = ModelBinding(
        role="reasoning",
        model_id="openai/gpt-4o-mini",
        default_params={"max_tokens": 1024},
    )
    out = binding.kwargs(stream=True, response_format={"type": "json_object"})
    assert out["stream"] is True
    assert out["response_format"] == {"type": "json_object"}
    assert out["max_tokens"] == 1024


def test_kwargs_detects_default_params_vs_overrides_conflict() -> None:
    binding = ModelBinding(
        role="reasoning",
        model_id="openai/gpt-4o-mini",
        default_params={"temperature": 0.1},
    )
    with pytest.raises(DuplicateKwargError) as excinfo:
        binding.kwargs(temperature=0.7)
    assert excinfo.value.key == "temperature"
    assert "default_params" in excinfo.value.sources
    assert "overrides" in excinfo.value.sources


def test_kwargs_detects_default_params_vs_extra_conflict() -> None:
    binding = ModelBinding(
        role="extractor",
        model_id="openai/gpt-4o-mini",
        default_params={"api_base": "http://default"},
        extra={"api_base": "http://override"},
    )
    with pytest.raises(DuplicateKwargError) as excinfo:
        binding.kwargs()
    assert excinfo.value.key == "api_base"


def test_kwargs_rejects_model_override() -> None:
    binding = ModelBinding(role="r", model_id="openai/gpt-4o-mini")
    with pytest.raises(DuplicateKwargError) as excinfo:
        binding.kwargs(model="bedrock/anthropic.claude")
    assert excinfo.value.key == "model"


def test_model_id_propagation_from_binding() -> None:
    binding = ModelBinding(role="r", model_id="vertex/gemini-1.5-pro")
    assert binding.kwargs()["model"] == "vertex/gemini-1.5-pro"
