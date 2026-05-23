# SPDX-FileCopyrightText: 2026 project-agi contributors
# SPDX-License-Identifier: Apache-2.0
"""Registry smoke + persistence tests."""

from __future__ import annotations

from pathlib import Path

from agi_core import Registry, ToolDescriptor, UseCaseDescriptor


def _tool(name: str, *, domain: str = "default", side_effecting: bool = False) -> ToolDescriptor:
    return ToolDescriptor(
        name=name,
        domain=domain,
        description=f"{name} tool",
        side_effecting=side_effecting,
        method="POST" if side_effecting else "GET",
        path_template=f"/{name}",
    )


def test_register_and_list_tool() -> None:
    reg = Registry()
    reg.register_tool(_tool("alpha"))
    tools = reg.list_tools()
    assert len(tools) == 1
    assert tools[0].name == "alpha"


def test_find_by_name() -> None:
    reg = Registry()
    reg.register_tool(_tool("beta"))
    found = reg.find("beta")
    assert found is not None
    assert found.name == "beta"
    assert reg.find("missing") is None


def test_list_tools_filters_by_domain() -> None:
    reg = Registry()
    reg.register_tool(_tool("a", domain="x"))
    reg.register_tool(_tool("b", domain="x"))
    reg.register_tool(_tool("c", domain="y"))
    assert {t.name for t in reg.list_tools(domain="x")} == {"a", "b"}
    assert {t.name for t in reg.list_tools(domain="y")} == {"c"}
    assert reg.domains() == ["x", "y"]


def test_register_use_case_and_query() -> None:
    reg = Registry()
    uc = UseCaseDescriptor(
        name="deflect",
        domain="care",
        description="Route routine asks to KB.",
        entry_route="/ai/care/deflect",
        tools=["kb_search"],
        tags=["demo"],
    )
    reg.register_use_case(uc)
    assert reg.find_use_case("deflect") == uc
    assert [u.name for u in reg.list_use_cases(domain="care")] == ["deflect"]


def test_persistence_roundtrip(tmp_path: Path) -> None:
    storage = tmp_path / "registry.json"
    reg = Registry(storage_path=storage)
    reg.register_tool(_tool("persisted", domain="d1"))
    reg.register_use_case(UseCaseDescriptor(name="flow", domain="d1", tools=["persisted"]))
    assert storage.exists()
    reloaded = Registry.load(storage)
    assert reloaded.find("persisted") is not None
    assert reloaded.find_use_case("flow") is not None
    assert reloaded.domains() == ["d1"]


def test_register_tools_bulk() -> None:
    reg = Registry()
    reg.register_tools([_tool("a"), _tool("b"), _tool("c")])
    assert {t.name for t in reg.list_tools()} == {"a", "b", "c"}
