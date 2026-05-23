# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Fetch and validate OpenAPI 3.0/3.1 documents.

`load_openapi` is the unified entry point — it accepts a URL (http/https)
or a filesystem path (str or `pathlib.Path`) and returns a validated dict.

Generalisation note: nothing in this module knows about TMF. Any
OpenAPI 3.0+ document validates the same way.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import yaml
from openapi_spec_validator import validate as validate_openapi
from openapi_spec_validator.validation.exceptions import OpenAPIValidationError


class OpenAPIFetchError(RuntimeError):
    """Raised when an OpenAPI document cannot be fetched or parsed."""


class OpenAPISpecInvalidError(RuntimeError):
    """Raised when the document parses but is not a valid OpenAPI spec."""


async def fetch_openapi(url: str, *, timeout_s: float = 10.0) -> dict[str, Any]:
    """GET `url` and parse as JSON or YAML.

    Raises `OpenAPIFetchError` on transport failure or non-2xx.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            body = resp.text
            content_type = resp.headers.get("content-type", "")
    except httpx.HTTPError as exc:
        raise OpenAPIFetchError(f"failed to fetch {url}: {exc}") from exc

    return _parse_spec_text(body, hint=content_type, source=url)


def load_openapi(source: str | Path, *, timeout_s: float = 10.0) -> dict[str, Any]:
    """Synchronously load a spec from a filesystem path; or raise.

    For URL fetches use the async `fetch_openapi` instead. We keep this
    sync helper around because the CLI runs sync and we don't want to
    pay an event-loop cost to read one local file.
    """
    src = str(source)
    if src.startswith(("http://", "https://")):
        raise OpenAPIFetchError(f"{src} is a URL; use the async fetch_openapi() to fetch it")
    path = Path(src)
    if not path.exists():
        raise OpenAPIFetchError(f"spec file not found: {path}")
    return _parse_spec_text(path.read_text(), hint=path.suffix, source=str(path))


def validate_spec(spec: dict[str, Any]) -> None:
    """Validate a parsed dict against the OpenAPI 3.x JSON Schema.

    Raises `OpenAPISpecInvalidError` if invalid.
    """
    try:
        validate_openapi(spec)
    except OpenAPIValidationError as exc:
        raise OpenAPISpecInvalidError(str(exc)) from exc


def _parse_spec_text(text: str, *, hint: str, source: str) -> dict[str, Any]:
    """Parse YAML or JSON text into a dict and validate it."""
    parsed: Any
    hint_lc = hint.lower()
    looks_yaml = ".yaml" in hint_lc or ".yml" in hint_lc or "yaml" in hint_lc or "yml" in hint_lc
    looks_json = ".json" in hint_lc or "json" in hint_lc

    try:
        if looks_yaml and not looks_json:
            parsed = yaml.safe_load(text)
        elif looks_json and not looks_yaml:
            parsed = json.loads(text)
        else:
            # Unknown hint — try JSON first, fall back to YAML.
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = yaml.safe_load(text)
    except (yaml.YAMLError, json.JSONDecodeError) as exc:
        raise OpenAPIFetchError(f"could not parse spec at {source}: {exc}") from exc

    if not isinstance(parsed, dict):
        raise OpenAPIFetchError(
            f"spec at {source} did not parse to a mapping (got {type(parsed).__name__})"
        )
    validate_spec(parsed)
    return parsed
