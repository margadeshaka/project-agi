# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Side-effect inference rules.

- GET/HEAD/OPTIONS  → side_effecting = False, rate_limit_class = read
- POST/PUT/PATCH/DELETE → side_effecting = True, rate_limit_class = write_high
- `x-side-effecting: false` on any operation overrides the method default
"""

from __future__ import annotations

from agi_mcpfyer import generate_tools


def _op(method: str, *, op_id: str, extra: dict | None = None) -> dict:
    op: dict = {
        "operationId": op_id,
        "summary": f"{method.upper()} test",
        "responses": {"200": {"description": "ok"}},
    }
    if extra:
        op.update(extra)
    return op


def _spec(operations: dict[str, dict[str, dict]]) -> dict:
    return {
        "openapi": "3.0.3",
        "info": {"title": "SideEffectTest", "version": "0.0.1"},
        "paths": operations,
    }


def test_mutating_methods_are_side_effecting() -> None:
    spec = _spec(
        {
            "/a": {"post": _op("post", op_id="create_a")},
            "/b": {"put": _op("put", op_id="update_b")},
            "/c": {"patch": _op("patch", op_id="patch_c")},
            "/d": {"delete": _op("delete", op_id="delete_d")},
        }
    )
    tools = {t.name: t for t in generate_tools(spec)}
    for name in ("create_a", "update_b", "patch_c", "delete_d"):
        assert tools[name].side_effecting is True, name
        assert tools[name].rate_limit_class == "write_high", name


def test_safe_methods_are_not_side_effecting() -> None:
    spec = _spec(
        {
            "/a": {"get": _op("get", op_id="read_a")},
            "/b": {"head": _op("head", op_id="head_b")},
            "/c": {"options": _op("options", op_id="opts_c")},
        }
    )
    tools = {t.name: t for t in generate_tools(spec)}
    for name in ("read_a", "head_b", "opts_c"):
        assert tools[name].side_effecting is False, name
        assert tools[name].rate_limit_class == "read", name


def test_x_side_effecting_false_overrides_mutating_method() -> None:
    spec = _spec(
        {
            "/idempotent": {
                "delete": _op(
                    "delete",
                    op_id="idempotent_delete",
                    extra={"x-side-effecting": False},
                ),
            }
        }
    )
    tools = {t.name: t for t in generate_tools(spec)}
    assert tools["idempotent_delete"].side_effecting is False


def test_x_side_effecting_true_overrides_safe_method() -> None:
    # Belt-and-braces: an operator may flag a GET that secretly mutates.
    spec = _spec(
        {
            "/triggers": {
                "get": _op("get", op_id="trigger_thing", extra={"x-side-effecting": True}),
            }
        }
    )
    tools = {t.name: t for t in generate_tools(spec)}
    assert tools["trigger_thing"].side_effecting is True
