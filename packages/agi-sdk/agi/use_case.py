# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
# See LICENSE in the repo root for full terms.
"""``agi.use_case`` — class decorator that stamps a use-case for the SDK.

``@use_case(slug, version)`` records ``slug`` and ``version`` on the class as
sentinel attributes. ``serve()`` reads these to set OTel baggage, derive the
MCP exposure name, and gate manifest cross-checks.

This module is intentionally tiny — no registration side effects, no global
registry. The SDK facade discovers decorated classes by argument, not by
import-time magic.
"""

from __future__ import annotations

from typing import TypeVar

T = TypeVar("T", bound=type)

USE_CASE_SLUG_ATTR = "_agi_use_case_slug"
USE_CASE_VERSION_ATTR = "_agi_use_case_version"


def use_case(slug: str, version: str) -> "_UseCaseDecorator":
    """Mark a class as an agi use-case.

    Example::

        @use_case("bill_explainer", version="0.3.0")
        class BillExplainer:
            def __init__(self, sdk):
                self.sdk = sdk
    """
    if not isinstance(slug, str) or not slug:
        raise ValueError("use_case slug must be a non-empty string")
    if not isinstance(version, str) or not version:
        raise ValueError("use_case version must be a non-empty string")
    return _UseCaseDecorator(slug=slug, version=version)


class _UseCaseDecorator:
    __slots__ = ("_slug", "_version")

    def __init__(self, *, slug: str, version: str) -> None:
        self._slug = slug
        self._version = version

    def __call__(self, cls: T) -> T:
        setattr(cls, USE_CASE_SLUG_ATTR, self._slug)
        setattr(cls, USE_CASE_VERSION_ATTR, self._version)
        return cls


def get_use_case_slug(cls: type) -> str | None:
    """Return the slug stamped by :func:`use_case`, or ``None`` if absent."""
    value = getattr(cls, USE_CASE_SLUG_ATTR, None)
    return value if isinstance(value, str) else None


def get_use_case_version(cls: type) -> str | None:
    """Return the version stamped by :func:`use_case`, or ``None`` if absent."""
    value = getattr(cls, USE_CASE_VERSION_ATTR, None)
    return value if isinstance(value, str) else None


__all__ = [
    "USE_CASE_SLUG_ATTR",
    "USE_CASE_VERSION_ATTR",
    "get_use_case_slug",
    "get_use_case_version",
    "use_case",
]
