# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Generator tests against a generic (non-TMF) OpenAPI fixture.

Two sources of truth:
- the on-disk `tests/fixtures/petstore.openapi.yaml` (loaded via the
  fetcher to exercise the YAML path)
- an inline dict-based mini-spec for fine-grained branch coverage
"""

from __future__ import annotations

from pathlib import Path

import pytest
from agi_mcpfyer import (
    MCPBundle,
    ToolDescriptor,
    build_bundle,
    generate_tools,
    load_openapi,
)

FIXTURE = Path(__file__).parent / "fixtures" / "petstore.openapi.yaml"


def _inline_spec() -> dict:
    return {
        "openapi": "3.0.3",
        "info": {"title": "Inline", "version": "0.0.1"},
        "paths": {
            "/healthz": {
                "get": {
                    "operationId": "healthz_healthz_get",
                    "summary": "Healthz",
                    "responses": {"200": {"description": "ok"}},
                },
            },
            "/v1/widget/{widget_id}": {
                "get": {
                    "operationId": "get_widget_v1_widget__widget_id__get",
                    "summary": "Get one widget",
                    "parameters": [
                        {
                            "name": "widget_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        }
                    ],
                    "responses": {"200": {"description": "ok"}},
                },
            },
            "/v1/widget": {
                "get": {
                    "operationId": "list_widgets_v1_widget_get",
                    "summary": "List widgets",
                    "parameters": [
                        {
                            "name": "owner",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "string"},
                        },
                    ],
                    "responses": {"200": {"description": "ok"}},
                },
            },
            "/v1/widget/{widget_id}/transfer": {
                "post": {
                    "operationId": "transfer_widget_v1_widget__widget_id__transfer_post",
                    "summary": "Transfer a widget",
                    "parameters": [
                        {
                            "name": "widget_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        }
                    ],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/Transfer"},
                            },
                        },
                    },
                    "responses": {"200": {"description": "ok"}},
                },
            },
        },
        "components": {
            "schemas": {
                "Transfer": {
                    "type": "object",
                    "properties": {
                        "to": {"type": "string"},
                        "memo": {"type": "string"},
                    },
                    "required": ["to"],
                },
            },
        },
    }


def test_loads_yaml_fixture() -> None:
    spec = load_openapi(FIXTURE)
    assert spec["info"]["title"] == "Petstore"


def test_skips_meta_paths() -> None:
    tools = generate_tools(_inline_spec())
    assert all(not t.path_template.startswith("/healthz") for t in tools)


def test_clean_operation_ids() -> None:
    tools = {t.name: t for t in generate_tools(_inline_spec())}
    assert set(tools.keys()) == {"get_widget", "list_widgets", "transfer_widget"}


def test_path_param_required_and_located() -> None:
    tools = {t.name: t for t in generate_tools(_inline_spec())}
    gw = tools["get_widget"]
    assert "widget_id" in gw.input_schema["properties"]
    assert "widget_id" in gw.input_schema["required"]
    assert gw.param_locations["widget_id"] == "path"


def test_body_with_ref_expands_inline() -> None:
    tools = {t.name: t for t in generate_tools(_inline_spec())}
    tw = tools["transfer_widget"]
    props = tw.input_schema["properties"]
    assert "widget_id" in props
    assert "to" in props
    assert "memo" in props
    assert tw.param_locations["widget_id"] == "path"
    assert tw.param_locations["to"] == "body"
    assert tw.param_locations["memo"] == "body"
    assert "to" in tw.input_schema["required"]


def test_output_schema_picks_first_2xx_json() -> None:
    spec = load_openapi(FIXTURE)
    tools = {t.name: t for t in generate_tools(spec)}
    show = tools["showpetbyid"]
    assert show.output_schema is not None
    # Resolved $ref → object schema with id/name properties
    assert show.output_schema.get("type") == "object"
    assert "id" in show.output_schema["properties"]


def test_method_and_path_template_preserved() -> None:
    tools = {t.name: t for t in generate_tools(_inline_spec())}
    assert tools["get_widget"].method == "GET"
    assert tools["transfer_widget"].method == "POST"
    assert tools["get_widget"].path_template == "/v1/widget/{widget_id}"


def test_source_api_carried() -> None:
    tools = generate_tools(_inline_spec(), source_api="my.widgets")
    assert all(t.source_api == "my.widgets" for t in tools)


def test_dry_run_extension_picked_up() -> None:
    spec = load_openapi(FIXTURE)
    tools = {t.name: t for t in generate_tools(spec)}
    assert tools["createpet"].dry_run_supported is True
    assert tools["listpets"].dry_run_supported is False


def test_custom_domain_resolver_runs() -> None:
    def resolver(_spec: dict, _op_id: str) -> str:
        return "my-domain"

    tools = generate_tools(_inline_spec(), domain_resolver=resolver)
    assert {t.domain for t in tools} == {"my-domain"}


def test_default_domain_from_title() -> None:
    tools = generate_tools(_inline_spec())
    # title "Inline" → slugified lowercase
    assert {t.domain for t in tools} == {"inline"}


@pytest.mark.asyncio
async def test_build_bundle_roundtrip(tmp_path: Path) -> None:
    bundle = await build_bundle(source=str(FIXTURE), source_api="petstore.v1")
    assert isinstance(bundle.version, str) and len(bundle.version) == 64
    assert bundle.source_api == "petstore.v1"
    out = bundle.to_disk(tmp_path / "bundle")
    reloaded = MCPBundle.from_disk(out)
    assert reloaded.version == bundle.version
    assert len(reloaded.tools) == len(bundle.tools)
    assert all(isinstance(t, ToolDescriptor) for t in reloaded.tools)
