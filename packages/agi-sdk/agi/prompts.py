# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.prompts`` — versioned, localizable prompt loader.

Prompts live in the pack repo at ``<pack>/prompts/<name>/<flavor>/<locale>.yaml``
(or ``<pack>/prompts/<name>/<locale>.yaml`` for no-flavor prompts). They are
baked into the runtime container at build time; nothing in this module reaches
the network.

Resolution order for ``get(name)``:
    (flavor, locale)  →  (flavor, default_locale)
    →  ("default", locale)  →  ("default", default_locale)  →  PromptNotFound
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from jinja2 import Environment, StrictUndefined, Template


class PromptNotFound(KeyError):
    """Raised when no YAML file resolves for ``(name, flavor, locale)``."""


@dataclass(frozen=True)
class Prompt:
    """One resolved prompt — template + metadata.

    ``version`` is derived from the pack version + the file's git SHA at
    load time (Phase 1.5); for now it's the pack version only.
    """

    name: str
    version: str
    flavor: str
    locale: str
    template: str
    metadata: dict[str, Any]

    def render(self, **kwargs: Any) -> str:
        """Render the Jinja2 template with ``kwargs``.

        Phase 1 uses :class:`StrictUndefined` so any missing variable raises
        loudly. The span-event emission (``agi.prompt.rendered`` with redacted
        kwargs) lands in Phase 1.5 once OTel is fully wired.
        """
        env = Environment(undefined=StrictUndefined, autoescape=False)
        tpl: Template = env.from_string(self.template)
        return tpl.render(**kwargs)


class PromptsAPI:
    """Load + resolve prompts from a pack's ``prompts/`` directory."""

    def __init__(
        self,
        prompts_dir: Path,
        *,
        pack_version: str = "0.0.0",
        default_flavor: str = "default",
        default_locale: str = "en",
    ) -> None:
        self._dir = Path(prompts_dir)
        self._pack_version = pack_version
        self._default_flavor = default_flavor
        self._default_locale = default_locale

    def get(
        self,
        name: str,
        *,
        flavor: str | None = None,
        locale: str | None = None,
    ) -> Prompt:
        """Resolve ``(name, flavor, locale)`` to a :class:`Prompt`.

        Falls back through (flavor, locale) → (flavor, default_locale) →
        ("default", locale) → ("default", default_locale).
        Raises :class:`PromptNotFound` if no candidate exists.
        """
        effective_flavor = flavor or self._default_flavor
        effective_locale = locale or self._default_locale
        candidates = [
            (effective_flavor, effective_locale),
            (effective_flavor, self._default_locale),
            (self._default_flavor, effective_locale),
            (self._default_flavor, self._default_locale),
        ]
        seen: set[tuple[str, str]] = set()
        for flavor, locale in candidates:
            key = (flavor, locale)
            if key in seen:
                continue
            seen.add(key)
            path = self._candidate_path(name, flavor, locale)
            if path is not None and path.exists():
                return self._load(path, name=name, flavor=flavor, locale=locale)
        raise PromptNotFound(
            f"No prompt {name!r} resolves for flavor={effective_flavor!r}, "
            f"locale={effective_locale!r} (under {self._dir})"
        )

    def _candidate_path(self, name: str, flavor: str, locale: str) -> Path | None:
        flavored = self._dir / name / flavor / f"{locale}.yaml"
        if flavored.exists():
            return flavored
        if flavor == self._default_flavor:
            unflavored = self._dir / name / f"{locale}.yaml"
            if unflavored.exists():
                return unflavored
        return None

    def _load(self, path: Path, *, name: str, flavor: str, locale: str) -> Prompt:
        data = yaml.safe_load(path.read_text()) or {}
        if not isinstance(data, dict):
            raise ValueError(f"Prompt YAML must be a mapping: {path}")
        template = data.get("template", "")
        if not isinstance(template, str):
            raise ValueError(f"Prompt {path} has non-string template")
        metadata = data.get("metadata", {}) or {}
        if not isinstance(metadata, dict):
            raise ValueError(f"Prompt {path} has non-dict metadata")
        return Prompt(
            name=name,
            version=self._pack_version,
            flavor=flavor,
            locale=locale,
            template=template,
            metadata=metadata,
        )


__all__ = [
    "Prompt",
    "PromptNotFound",
    "PromptsAPI",
]
