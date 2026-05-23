# Changelog

All notable changes to project-agi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(with [PEP 440](https://peps.python.org/pep-0440/) pre-release spellings for the
Python packages — `1.0.0rc1` on PyPI, `1.0.0-rc1` on Helm/npm/OCI).

## [Unreleased]

## [1.0.0-rc1] — 2026-05-23

First release candidate. Two-band layout (Band-1 library + Band-2 reference
distribution) is feature-complete for the P0–P6 scope; the library is
publishable to PyPI and the distribution is publishable to GHCR.

### Added

- **agi-sdk** (Band-1): `use_case`, `serve`, `load_pack`, `dispatch` seam,
  Pydantic models for pack/use-case/tool descriptors, MCP client primitives,
  J2 prompt loader, AI-Trail typed sink interface, three orchestrator
  adapters (`native` default, `langgraph`, `pydantic_ai`), Traceloop /
  OpenLLMetry bootstrap at import (`AGI_DISABLE_TRACELOOP=1` to opt out).
- **agi-core** (Band-1): in-memory tool/use-case registry with optional
  JSON persistence, HubProxy with pluggable backend, FastAPI HTTP surface,
  Pydantic-settings configuration.
- **agi-mcpfyer** (Band-1): OpenAPI 3 → MCP tool bundle generator with
  `agi-mcpfyer` console script; pure-function generator over a parsed
  OpenAPI dict; JSON+YAML bundle layout; shallow MCP server stub.
- **agi-runtime** (Band-2): FastAPI app on `:9000` with the `X-Pack`
  dispatch middleware (claims-validated, `/healthz` + `/readyz` exempt);
  routers for `/chat`, `/tools`, `/kb`, `/trail`, `/admin`, `/mcp`;
  PackLoader / BundleLoader / TrailSink wired once in the lifespan handler;
  `agi-runtime` console script; SSE on `POST /admin/kb/{slug}/reindex`;
  five admin GET endpoints (packs, use-cases, tools, health summary, reload).
- **agi-auth** (Band-2): pluggable adapter interface with three reference
  adapters — `dev-noop`, `static-token`, `keycloak` (Authlib-based) — plus
  the `require_auth` middleware and a `resolve_adapter()` env-driven factory.
- **agi-ui** (Band-2): Next.js 14 admin console on `:8080` with NextAuth v5
  + Keycloak BFF, Material Design 3 theming via design-handoff port, sidebar
  navigation, pack health + reload, virtualised audit list with CSV export,
  tool catalogue with form-from-schema, Langfuse trace deep-links.
- **agi-chart** (Band-2): Helm chart with `values.schema.json`, ConfigMap-
  mounted pack mode (PVC mode supported), OTel collector sidecar,
  hardening-mode (single-pack-per-pod) toggle, `/chat` Helm test pod.
- **CI**: ruff + format + mypy lint job, isolation-gate job (AST scan in
  `packages/agi-sdk/tests/test_isolation_gate.py` blocks Band-2 imports
  from Band-1), pytest matrix across Python 3.11 / 3.12 / 3.13, frontend
  lint + type-check + vitest jobs, secret-scan (trufflehog), helm-kind
  dispatch workflow, `publish-images.yml` to GHCR.
- **CI**: `publish-pypi.yml` — trusted-publisher OIDC upload of `agi-sdk`,
  `agi-core`, `agi-mcpfyer` on `v*` tags, with a `workflow_dispatch` lane
  targeting TestPyPI by default.
- **Pack hotfix lane**: reference `.github/workflow-templates/pack-hotfix.yml`
  with the documented `pack-hotfix/<ticket-id>` branch convention and the
  ≤15-minute merge-to-live target.
- **Reference packs**: `blank`, `care-demo`, `fleet-demo` under `packs/`,
  validated by `validate-packs.yml`.

### Changed

- `agi_runtime.routes.chat` refactored to delegate end-to-end through the
  `agi.dispatch` seam — the route is now a thin transport adapter, all
  business logic lives in the SDK.
- `agi_runtime.routes.admin.use_cases` reshaped to surface tool summaries
  and pack bindings consistently for the admin UI.
- `/admin/packs/*` endpoints scoped to admin-only per `ADMIN_CONSOLE.md`
  spec; operator-scoped reads moved to dedicated routes.
- `agi-ui` eslint pinned to `^8.57` for `next@14` plugin compatibility.

### Documentation

- `ADR-0001`: placeholder ADR template + index.
- `ADR-0002`: dispatch boundary — why the seam lives in `agi-sdk`, not
  `agi-runtime`.
- `ADR-0003`: runtime stub use-cases — how the runtime resolves a missing
  in-pack `use_case.py` against the SDK demo registrar.
- P5 runbook (`docs/runbooks/`) — `docker compose up` smoke + helm-kind
  deploy walkthrough.
- `CONTRIBUTING.md` — band rule, conventional commits, ADR expectations.

### Architecture decisions (ratified, see `RESOLVED_STACK.md`)

1. **Deployment unit**: pack-group-per-pod by default; single-pack-per-pod
   as a Helm values toggle ("hardening mode") for regulated tenants.
2. **Pack dispatch**: `X-Pack` header mandatory in production paths; pack
   identity is claims-resolved from the auth token and consistency-checked
   against the header — no header-trust path.
3. **Two visual bands**: Band-1 library (`agi-sdk` + `agi-core` +
   `agi-mcpfyer` + `agi-packs`) is the product; Band-2 (`agi-runtime` +
   `agi-ui` + `agi-auth` + `agi-chart`) is the supported reference
   distribution. Band-1 never imports Band-2 (CI gate).
4. **Prompts**: YAML-in-pack source of truth, PR-reviewed, baked into the
   container; no DB-stored runtime-editable prompts; the hotfix lane is
   the `pack-hotfix/<ticket-id>` branch convention.
5. **Model gateway**: LiteLLM library mode; no custom abstraction. Roles
   not providers — `sdk.models.binding("reasoning")`; `import openai/
   anthropic/boto3` in SDK is gate-blocked, requires waiver elsewhere.
6. **Tool plane**: everything is MCP. `agi-mcpfyer` is the first-class
   OpenAPI → MCP generator.
7. **Telemetry**: Traceloop / OpenLLMetry auto-instrumentation is the only
   default trace path; AI-Trail is a sink fed by the OTel collector with
   an audit-schema overlay, not an API use cases call directly.
8. **Identity**: Keycloak is the reference adapter; generic OIDC
   interface; static-token and dev-noop for development. Three-role RBAC
   (`AGI_ADMIN` / `AGI_DEVELOPER` / `AGI_VIEWER`) enforced centrally.

### Known limitations / deferred to v1.1

- Container images publish `linux/amd64` only — `linux/arm64` is deferred
  pending consistent litellm wheel availability across versions.
- Image signing (`cosign`) is not wired into `publish-images.yml`.
- Helm chart is published as a GHCR OCI artefact manually for rc1; an
  automated `publish-chart.yml` workflow is scheduled for v1.1.
- AI-Trail sink only has the in-memory and JSONL implementations; the
  Mongo backend is interface-stubbed but not wired through the OTel
  collector pipeline.
- Pack switcher in the admin UI relies on a hardcoded operator-test pack
  list; live pack discovery via `/admin/packs` is wired but the switcher
  UX assumes a stable pack ordering.
- `npm run e2e` (Playwright) is not gated in PR CI — runs on dispatch only;
  the nightly workflow is scheduled but unimplemented.
- TestPyPI / PyPI trusted-publisher registration must be performed once
  per package by a maintainer before `publish-pypi.yml` will succeed.

[Unreleased]: https://github.com/margadeshaka/project-agi/compare/v1.0.0-rc1...HEAD
[1.0.0-rc1]: https://github.com/margadeshaka/project-agi/releases/tag/v1.0.0-rc1
