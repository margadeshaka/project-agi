# Contributing to project-agi

Thanks for your interest. project-agi is Apache-2.0 and welcomes contributions from anyone.

## Getting started

```bash
git clone https://github.com/<org>/project-agi
cd project-agi
uv sync --all-packages --all-extras   # ALWAYS include --all-extras
uv run pytest
```

> **Important — sync flags.** Plain `uv sync --all-packages` uninstalls dev
> tools (`pytest`, `mypy`, `ruff`) because they live under optional extras in
> each package's `pyproject.toml`. Always pass `--all-extras` together with
> `--all-packages`. If you forget, you'll see `command not found: pytest` —
> rerun the sync with the right flags.

> **Path resolution.** The repo ships a root `conftest.py` that prepends each
> workspace package's source dir to `sys.path`. This is needed because `uv`
> generates editable installs as `_editable_impl_*.pth` files, which
> Python's `site.py` filters as hidden (leading underscore). If/when `uv`
> changes the prefix, the root `conftest.py` becomes a no-op and can go.

## Workspace layout

This is a uv workspace with two distribution bands:

- **Band 1 — Product** (`packages/`): `agi-sdk`, `agi-core`, `agi-mcpfyer`, `agi-packs`.
- **Band 2 — Reference Distribution** (`distribution/`): `agi-runtime`, `agi-ui`, `agi-auth`, `agi-chart`.

Band 2 depends on Band 1. **Band 1 never imports from Band 2.** This is enforced by `packages/agi-sdk/tests/test_isolation_gate.py` and CI will fail on violation.

## How to propose a change

1. Open an issue describing the change and why.
2. For non-trivial changes, expect to write an ADR (Architecture Decision Record) under `docs/decisions/`.
3. Open a PR against `main`. Ensure CI is green.
4. One review approval from a maintainer is required.

## Coding conventions

- **Python**: ruff + mypy strict. Line length 100.
- **Commits**: conventional commits (`feat:`, `fix:`, `docs:`, …).
- **No native provider imports** in `agi-sdk` use-case code. `import openai`/`anthropic`/`boto3` requires an `# bm-ai: allow native sdk` waiver comment with a justification.
- **Roles, not providers**: use-case code asks `sdk.models.binding("reasoning")`, not a model id.
- **MCP only**: every tool is an MCP tool. No parallel tool abstractions.
- **Tracing is automatic**: do not write hand-rolled spans; OpenLLMetry handles it.
- **Prompts live in packs**: YAML files baked into the container, PR-reviewed. No DB-stored runtime-editable prompts.

## Security

See `SECURITY.md`. Report vulnerabilities privately — do not file public issues for security bugs.

## Code of conduct

See `CODE_OF_CONDUCT.md`.
