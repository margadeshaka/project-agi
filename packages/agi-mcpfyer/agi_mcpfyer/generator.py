# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""The OpenAPI → MCP tool generator.

Input: an OpenAPI 3.0/3.1 document as a plain dict.
Output: a list of `ToolDescriptor` — one per path × method pair worth
exposing to an LLM.

Each descriptor carries:
- name (cleaned from `operationId` or method+path)
- domain (configurable via `domain_resolver`; defaults to first path segment)
- input_schema (JSON Schema — merged path + query + body parameters)
- output_schema (JSON Schema — first 2xx response, optional)
- side_effecting (POST/PUT/PATCH/DELETE; overridable via `x-side-effecting`)
- rate_limit_class (configurable; default `read` / `write_high`)
- dry_run_supported (from `x-dry-run: true`)
- method, path_template, param_locations, source_api, source_operation
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

from agi_mcpfyer.bundle import MCPBundle
from agi_mcpfyer.fetcher import fetch_openapi, load_openapi

DomainResolver = Callable[[dict[str, Any], str], str]
RateLimitResolver = Callable[[str, "ToolDescriptor"], str]

_MUTATING_METHODS = frozenset({"post", "put", "patch", "delete"})
_HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete", "head", "options"})
_SKIP_PATH_PREFIXES = ("/healthz", "/readyz", "/livez", "/v1/info", "/v1/version")


@dataclass(frozen=True)
class ToolDescriptor:
    """One MCP tool generated from an OpenAPI operation.

    Frozen so the bundle can be hashed deterministically.
    """

    name: str
    domain: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None
    side_effecting: bool
    rate_limit_class: str
    dry_run_supported: bool
    method: str
    path_template: str
    param_locations: dict[str, str] = field(default_factory=dict)
    source_api: str = ""
    source_operation: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def default_domain_resolver(spec: dict[str, Any], operation_id: str) -> str:
    """Default rule: domain = first non-empty path segment in `info.title` or `default`.

    Operators that want a richer mapping pass their own `domain_resolver`.
    """
    info = spec.get("info") or {}
    title = info.get("title")
    if isinstance(title, str) and title.strip():
        return _slugify(title)
    return "default"


def _default_rate_limit(method_lc: str, _tool: ToolDescriptor) -> str:
    if method_lc in _MUTATING_METHODS:
        return "write_high"
    return "read"


def generate_tools(
    spec: dict[str, Any],
    *,
    source_api: str = "",
    domain_resolver: DomainResolver | None = None,
    rate_limit_resolver: RateLimitResolver | None = None,
    skip_meta_paths: bool = True,
) -> list[ToolDescriptor]:
    """Walk the OpenAPI `paths` and emit one descriptor per operation.

    Parameters
    ----------
    spec
        Parsed OpenAPI 3.0/3.1 document. Caller is responsible for validation;
        the public `build_bundle` wrapper runs the validator.
    source_api
        Logical identifier carried on every emitted tool (e.g. `Billing_v4`).
    domain_resolver
        Callable producing the `domain` field. Default = `default_domain_resolver`.
    rate_limit_resolver
        Callable producing the `rate_limit_class`. Default: `read` / `write_high`.
    skip_meta_paths
        If True (default), drop `/healthz`, `/readyz`, etc. They're not useful to LLMs.
    """
    paths = spec.get("paths") or {}
    components_schemas = (spec.get("components") or {}).get("schemas") or {}
    resolver = domain_resolver or default_domain_resolver
    rl_resolver = rate_limit_resolver or _default_rate_limit
    out: list[ToolDescriptor] = []

    for path_template, ops in paths.items():
        if skip_meta_paths and any(path_template.startswith(p) for p in _SKIP_PATH_PREFIXES):
            continue
        if not isinstance(ops, dict):
            continue
        for method, op in ops.items():
            method_lc = method.lower()
            if method_lc not in _HTTP_METHODS:
                continue
            if not isinstance(op, dict):
                continue
            descriptor = _operation_to_tool(
                method_lc,
                path_template,
                op,
                spec=spec,
                components_schemas=components_schemas,
                source_api=source_api,
                domain_resolver=resolver,
                rate_limit_resolver=rl_resolver,
            )
            if descriptor is not None:
                out.append(descriptor)
    return out


async def build_bundle(
    *,
    source: str,
    source_api: str = "",
    domain_resolver: DomainResolver | None = None,
    rate_limit_resolver: RateLimitResolver | None = None,
    skip_meta_paths: bool = True,
    timeout_s: float = 10.0,
) -> MCPBundle:
    """Fetch+validate a spec, generate tools, return a frozen bundle.

    `source` may be a URL or a filesystem path.
    """
    if source.startswith(("http://", "https://")):
        spec = await fetch_openapi(source, timeout_s=timeout_s)
    else:
        spec = load_openapi(source)
    tools = generate_tools(
        spec,
        source_api=source_api or _infer_source_api(spec),
        domain_resolver=domain_resolver,
        rate_limit_resolver=rate_limit_resolver,
        skip_meta_paths=skip_meta_paths,
    )
    spec_sha = _sha256_of_dict(spec)
    return MCPBundle(
        tools=tools,
        version=spec_sha,
        source=source,
        generated_at=datetime.now(UTC).isoformat(),
        source_api=source_api or _infer_source_api(spec),
    )


def _operation_to_tool(
    method_lc: str,
    path_template: str,
    op: dict[str, Any],
    *,
    spec: dict[str, Any],
    components_schemas: dict[str, Any],
    source_api: str,
    domain_resolver: DomainResolver,
    rate_limit_resolver: RateLimitResolver,
) -> ToolDescriptor | None:
    raw_op_id = op.get("operationId") or _fallback_op_id(method_lc, path_template)
    name = _clean_operation_id(raw_op_id, method=method_lc, path=path_template)
    description = (op.get("summary") or "").strip() or (op.get("description") or "").strip()

    input_schema, param_locations = _build_input_schema(
        op,
        components_schemas=components_schemas,
    )
    output_schema = _build_output_schema(op, components_schemas=components_schemas)

    # Side-effect inference: method-based default, overridable by extension.
    side_effecting_default = method_lc in _MUTATING_METHODS
    if "x-side-effecting" in op:
        side_effecting = bool(op["x-side-effecting"])
    else:
        side_effecting = side_effecting_default

    dry_run_supported = bool(op.get("x-dry-run", False))

    # Build a half-formed descriptor first so the rate_limit_resolver can see
    # the tool shape if it wants to.
    domain = domain_resolver(spec, raw_op_id)
    half = ToolDescriptor(
        name=name,
        domain=domain,
        description=description or f"{method_lc.upper()} {path_template}",
        input_schema=input_schema,
        output_schema=output_schema,
        side_effecting=side_effecting,
        rate_limit_class="",  # filled below
        dry_run_supported=dry_run_supported,
        method=method_lc.upper(),
        path_template=path_template,
        param_locations=param_locations,
        source_api=source_api,
        source_operation=f"{method_lc.upper()} {path_template}",
    )
    rate_limit_class = rate_limit_resolver(method_lc, half)
    return ToolDescriptor(
        name=half.name,
        domain=half.domain,
        description=half.description,
        input_schema=half.input_schema,
        output_schema=half.output_schema,
        side_effecting=half.side_effecting,
        rate_limit_class=rate_limit_class,
        dry_run_supported=half.dry_run_supported,
        method=half.method,
        path_template=half.path_template,
        param_locations=half.param_locations,
        source_api=half.source_api,
        source_operation=half.source_operation,
    )


def _build_input_schema(
    op: dict[str, Any],
    *,
    components_schemas: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Merge path + query + body params into a single JSON Schema.

    Side table maps property name → location (path/query/body) so callers
    that proxy upstream can route values correctly.
    """
    properties: dict[str, Any] = {}
    required: list[str] = []
    locations: dict[str, str] = {}

    for param in op.get("parameters") or []:
        if not isinstance(param, dict):
            continue
        loc = param.get("in")
        if loc not in {"path", "query"}:
            continue
        pname = param.get("name")
        if not isinstance(pname, str):
            continue
        pschema = dict(param.get("schema") or {})
        if param.get("description"):
            pschema.setdefault("description", param["description"])
        properties[pname] = pschema
        locations[pname] = loc
        if param.get("required") or loc == "path":
            required.append(pname)

    body = op.get("requestBody")
    if isinstance(body, dict):
        content = body.get("content") or {}
        json_body = content.get("application/json") or {}
        body_schema_raw = json_body.get("schema")
        body_schema: Any = (
            _resolve_schema(body_schema_raw, components_schemas) if body_schema_raw else None
        )
        if isinstance(body_schema, dict) and body_schema.get("type") == "object":
            for prop_name, prop_schema in (body_schema.get("properties") or {}).items():
                properties[prop_name] = prop_schema
                locations[prop_name] = "body"
            for req in body_schema.get("required") or []:
                if req not in required:
                    required.append(req)
        elif body_schema is not None:
            # Non-object body — collapse to a single 'body' field.
            properties["body"] = body_schema
            locations["body"] = "body"
            if body.get("required"):
                required.append("body")

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    if required:
        schema["required"] = sorted(set(required))
    return schema, locations


def _build_output_schema(
    op: dict[str, Any],
    *,
    components_schemas: dict[str, Any],
) -> dict[str, Any] | None:
    """Pick the first 2xx response with an `application/json` schema."""
    responses = op.get("responses") or {}
    if not isinstance(responses, dict):
        return None
    for code in sorted(responses.keys()):
        if not (isinstance(code, str) and code.startswith("2")):
            continue
        resp = responses[code]
        if not isinstance(resp, dict):
            continue
        content = resp.get("content") or {}
        json_resp = content.get("application/json") or {}
        schema = json_resp.get("schema")
        if schema is None:
            continue
        resolved = _resolve_schema(schema, components_schemas)
        if isinstance(resolved, dict):
            return resolved
    return None


def _resolve_schema(
    schema: Any,
    components_schemas: dict[str, Any],
    *,
    seen: set[str] | None = None,
) -> Any:
    """Inline `$ref` references one level deep so the LLM sees a usable schema.

    Cycles bail out (we leave the `$ref` in place rather than spin).
    """
    if not isinstance(schema, dict):
        return schema
    seen = seen or set()
    ref = schema.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
        key = ref.removeprefix("#/components/schemas/")
        if key in seen:
            return schema
        target = components_schemas.get(key)
        if target is None:
            return schema
        merged = {**target, **{k: v for k, v in schema.items() if k != "$ref"}}
        return _resolve_schema(merged, components_schemas, seen=seen | {key})
    if "properties" in schema:
        schema = dict(schema)
        schema["properties"] = {
            k: _resolve_schema(v, components_schemas, seen=seen)
            for k, v in schema["properties"].items()
        }
    if "items" in schema:
        schema = dict(schema)
        schema["items"] = _resolve_schema(schema["items"], components_schemas, seen=seen)
    return schema


def _infer_source_api(spec: dict[str, Any]) -> str:
    info = spec.get("info") or {}
    title = info.get("title")
    version = info.get("version")
    if isinstance(title, str) and isinstance(version, str):
        return f"{title}_{version}"
    if isinstance(title, str):
        return title
    return ""


def _sha256_of_dict(d: dict[str, Any]) -> str:
    canonical = json.dumps(d, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(canonical).hexdigest()


# FastAPI's default operationId is `f"{fn_name}{sanitised_path}_{method}"`
# where `sanitised_path = re.sub(r"\W", "_", path)`. We recover `fn_name` by
# computing the exact suffix and stripping it.
_OPID_SUFFIX_FALLBACK_RE = re.compile(
    r"_v\d+_[a-zA-Z0-9_]+_(get|post|put|patch|delete|head|options)$"
)


def _clean_operation_id(raw: str, *, method: str, path: str) -> str:
    path_san = re.sub(r"\W", "_", path)
    suffix = f"{path_san}_{method.lower()}"
    if raw.endswith(suffix) and len(raw) > len(suffix):
        return _slugify(raw[: -len(suffix)])
    fallback = _OPID_SUFFIX_FALLBACK_RE.sub("", raw)
    if fallback and fallback != raw:
        return _slugify(fallback)
    return _slugify(raw) or _fallback_op_id(method, path)


def _fallback_op_id(method: str, path: str) -> str:
    return _slugify(f"{method}_{path}")


def _slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_]+", "_", s).strip("_")
    return re.sub(r"_+", "_", s).lower()
