# Deferred Questions

> Open decisions that need owner input. Phase 0 work proceeds against a working name (`project-agi`) and a placeholder GitHub org; these must resolve before any public push.

## Blocker · resolves before public push

| # | Question | Working answer | Hard deadline |
|---|---|---|---|
| 1 | **GitHub org** for the public repo | Placeholder: `<org>` in all files | End of W1 (Phase 0) |
| 2 | **Final project name** (trademark cleared) | Working: `project-agi`; package names: `agi-sdk`, `agi-core`, `agi-mcpfyer` | End of W1 (Phase 0) |
| 3 | **Apache-2.0 sign-off** (legal) | Intent confirmed; LICENSE file in place | End of W1 (Phase 0) |
| 4 | **Security contact email** | Placeholder: `security@<org>.<tld>` in SECURITY.md | End of W1 (Phase 0) |
| 5 | **Conduct contact email** | Placeholder: `conduct@<org>.<tld>` in CODE_OF_CONDUCT.md | End of W1 (Phase 0) |

## Important but not blocking

| # | Question | Default | Deadline |
|---|---|---|---|
| 6 | **Bitbucket mirror** for internal CI? | Skip until requested | Optional |
| 7 | **CLA** required from contributors? | No CLA at v1 | Optional |
| 8 | **Eval harness depth** — Promptfoo CLI direct or thin wrapper? | Thin wrapper for tenant-profile expansion | End of P5 (W11) |

## Resolved during scaffold

| # | Decision | When |
|---|---|---|
| R1 | Initial branch is `main` (not `master`) | P0 W1 |
| R2 | Workspace tool is `uv` | P0 W1 |
| R3 | License is Apache-2.0 (intent ratified) | P0 W1 |
| R4 | Python baseline is 3.11; matrix tests on 3.11/3.12/3.13 | P0 W1 |
| R5 | Linter is `ruff` with line-length 100 | P0 W1 |
| R6 | Type-check is `mypy --strict` | P0 W1 |
