# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.models`` — role-keyed model resolution.

The SDK never names a provider directly. Use-case authors ask for a role
(``"reasoning"``, ``"fast"``, anything the pack manifest declares); the
operator config binds that role to a concrete LiteLLM ``model_id``.

This module exposes two surfaces:

- :class:`ModelBinding` — frozen view of one resolved role.
- :class:`ModelsAPI` — ``.binding(role)`` resolver, constructed by the SDK
  facade against the active pack/operator config.

``ModelBinding.kwargs()`` is the load-bearing helper — it collapses
``model_id``, ``default_params``, ``extra`` and per-call ``**overrides`` into
one mapping safe to splat into ``litellm.acompletion(...)``. Duplicate keys
fail loudly rather than silently picking a winner.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agi.config import OperatorConfig


class DuplicateKwargError(ValueError):
    """Raised when ``ModelBinding.kwargs()`` would silently double-up a key.

    Carries the offending key and the source layers (``default_params`` /
    ``extra`` / ``overrides``) that produced the conflict.
    """

    def __init__(self, key: str, sources: list[str]) -> None:
        self.key = key
        self.sources = sources
        super().__init__(
            f"binding.kwargs() would set {key!r} from multiple sources: {', '.join(sources)}"
        )


class UnknownRoleError(KeyError):
    """Raised when ``ModelsAPI.binding(role)`` can't find the role."""


@dataclass(frozen=True)
class ModelBinding:
    """One resolved role binding (config snapshot, no live connection).

    Attributes
    ----------
    role:
        The declared role name (``"reasoning"``, ``"fast"``, …).
    model_id:
        LiteLLM-format model id (``"bedrock/anthropic.claude-3-5-haiku-..."``).
    region:
        Optional regional pin (LiteLLM provider kwarg).
    default_params:
        Hot-reloadable sampling defaults (``max_tokens``, ``temperature``, …).
    extra:
        Provider-specific kwargs passthrough (``extra_headers``, ``api_base``,
        ``api_key``, …).
    """

    role: str
    model_id: str
    region: str | None = None
    default_params: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

    def kwargs(self, **overrides: Any) -> dict[str, Any]:
        """Collapse binding + overrides into a single ``litellm.acompletion`` kwarg dict.

        Detects duplicate keys across ``default_params``, ``extra`` and
        ``overrides`` and raises :class:`DuplicateKwargError` before reaching
        LiteLLM. ``"model"`` is always sourced from the binding — passing
        ``model=...`` as an override is therefore always a conflict.
        """
        sources: dict[str, list[str]] = {"model": ["binding.model_id"]}
        for k in self.default_params:
            sources.setdefault(k, []).append("default_params")
        for k in self.extra:
            sources.setdefault(k, []).append("extra")
        for k in overrides:
            sources.setdefault(k, []).append("overrides")

        conflicts = {k: layers for k, layers in sources.items() if len(layers) > 1}
        if conflicts:
            key, layers = next(iter(sorted(conflicts.items())))
            raise DuplicateKwargError(key, layers)

        return {
            "model": self.model_id,
            **self.default_params,
            **self.extra,
            **overrides,
        }


class ModelsAPI:
    """Role → :class:`ModelBinding` resolver bound to an active ``OperatorConfig``.

    The SDK facade constructs this with a snapshot of the operator config at
    boot. ``binding(role)`` reads the snapshot, never talks to the provider.
    """

    def __init__(
        self,
        operator_config: OperatorConfig,
        *,
        declared_roles: set[str] | None = None,
    ) -> None:
        self._operator_config = operator_config
        self._declared_roles = declared_roles

    def binding(self, role: str) -> ModelBinding:
        """Return the resolved :class:`ModelBinding` for ``role``.

        Raises :class:`UnknownRoleError` if the role isn't bound in
        ``operator.yaml``. When ``declared_roles`` was supplied at construction
        time, the error message also surfaces the declared-vs-bound diff so the
        engineer can tell whether the manifest or the operator config is wrong.
        """
        models_cfg = self._operator_config.models
        cfg = models_cfg.get(role)
        if cfg is None:
            raise self._unknown_role(role, set(models_cfg.keys()))
        return ModelBinding(
            role=role,
            model_id=cfg.model_id,
            region=cfg.region,
            default_params=dict(cfg.default_params),
            extra=dict(cfg.extra),
        )

    def _unknown_role(self, role: str, bound: set[str]) -> UnknownRoleError:
        lines = [f"Unknown model role {role!r}."]
        if self._declared_roles is not None:
            declared_only = self._declared_roles - bound
            bound_only = bound - self._declared_roles
            if declared_only:
                lines.append(
                    f"  declared in manifest but not bound in operator.yaml: "
                    f"{sorted(declared_only)}"
                )
            if bound_only:
                lines.append(
                    f"  bound in operator.yaml but not declared in manifest: {sorted(bound_only)}"
                )
        else:
            lines.append(f"  bound roles: {sorted(bound)}")
        return UnknownRoleError("\n".join(lines))


__all__ = [
    "DuplicateKwargError",
    "ModelBinding",
    "ModelsAPI",
    "UnknownRoleError",
]
