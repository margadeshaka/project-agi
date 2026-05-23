# SPDX-License-Identifier: Apache-2.0
"""DevNoopAdapter must refuse construction in production environments."""

from __future__ import annotations

import pytest

from agi_auth.dev_noop import DevNoopAdapter, DevNoopRefusedInProductionError


def test_dev_noop_refuses_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGI_ENV", "production")
    with pytest.raises(DevNoopRefusedInProductionError):
        DevNoopAdapter()


def test_dev_noop_refuses_prod_case_insensitive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGI_ENV", "PRODUCTION")
    with pytest.raises(DevNoopRefusedInProductionError):
        DevNoopAdapter()


def test_dev_noop_ok_in_dev(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGI_ENV", "dev")
    adapter = DevNoopAdapter()
    assert "AGI_ADMIN" in adapter.scopes


def test_dev_noop_ok_when_env_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGI_ENV", raising=False)
    adapter = DevNoopAdapter()
    assert adapter.tenant_id == "dev"
