# P5 closure runbook — first green helm-kind on `main`, GHCR images, `/chat` helm-test

This runbook closes the Phase 5 gates from `EXECUTION_PLAN.html` §4.5. P0–P4c
are committed; the chart + workflow + helm-test pod ship in this phase, but
**three steps require a human with repo-write access** because they touch
GitHub Actions runs and GHCR permissions. They're documented here so the
project's "definition-of-done" can be reached.

## What landed automatically (committed)

| Artefact | Path | Purpose |
| --- | --- | --- |
| `publish-images.yml` workflow | `.github/workflows/publish-images.yml` | Build + push `agi-runtime` and `agi-ui` to `ghcr.io/<owner>/<image>` on push-to-main, tag `v*`, and `workflow_dispatch`. Matrix-fanned for clean failure surfacing. |
| `/chat` helm-test pod | `distribution/agi-chart/templates/tests/test-chat-roundtrip.yaml` | `helm test` now POSTs `/chat` with `X-Pack: care-demo` + dev-noop auth and asserts the legacy `ChatResponse` shape. Proves dispatch-middleware → router → seam → orchestrator → LiteLLM-fake. |
| Existing `/readyz` helm-test pod | `distribution/agi-chart/templates/tests/test-runtime-readiness.yaml` | unchanged from P4. |
| `helm-kind.yml` workflow | `.github/workflows/helm-kind.yml` | already has `workflow_dispatch: {}` from chore commit `73f05fc`; ready to fire on `main`. |

## What you (a human with repo-write) must do

### 1. Trigger the first green `helm-kind` run on `main`

`helm-kind.yml` is path-gated for PRs/pushes that touch chart/runtime/SDK
paths. P0 baseline never triggered it. Manually fire it once on `main`:

1. Open `https://github.com/<owner>/project-agi/actions/workflows/helm-kind.yml`.
2. Click **Run workflow** → branch `main` → **Run workflow**.
3. Wait ≤8 min for green. The job spins up `kind`, builds the runtime image,
   loads it, installs the chart with `llm.provider=fake auth.mode=dev-noop`,
   runs **both** `helm test` pods (readiness + `/chat` roundtrip).
4. Once green, **pin the SHA** in this file's "Status" section below as proof
   of first-pass.

If it fails:
- `helm test --logs` output is captured by the workflow; expand the failed
  step in the Actions UI.
- Most likely failure: the runtime image build exceeds 6 min on
  `ubuntu-latest` because `litellm` cold-installs are slow. Bump
  `timeout-minutes: 6 → 10` in `helm-kind.yml` if so.
- Second-most-likely: the `/chat` helm-test pod times out polling `/readyz`.
  The chart's `livenessProbe.initialDelaySeconds` may need a small bump.

### 2. Configure GHCR permissions (one-time)

Before `publish-images.yml` can push, the repo (and possibly the org)
needs one of these two paths:

**Path A — repo workflow-write permission (preferred)**

1. **Repo Settings → Actions → General → Workflow permissions**:
   - Set to **Read and write permissions**.
   - Tick **Allow GitHub Actions to create and approve pull requests** if
     you want release-bot PRs later (optional for v1).

   This grants the auto-provisioned `GITHUB_TOKEN` the `write:packages`
   scope it needs to push to `ghcr.io`.

**Path B — maintainer-supplied PAT (when org policy blocks Path A)**

If your org has the "Workflow permissions" toggle disabled at the
enterprise level (you'll see a Conflict 409 from the API or "denied"
errors in workflow logs), use a Personal Access Token instead:

1. Create a PAT at <https://github.com/settings/tokens>:
   - Scopes: **`write:packages`** (and **`read:packages`** for completeness).
   - Expiration: rotate per your security policy (90 days recommended).
2. Add it to the repo as a secret named **`GHCR_TOKEN`**:
   - **Repo Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `GHCR_TOKEN` · Value: `ghp_...` (the PAT you just created).
3. The workflow auto-detects the secret and prefers it over `GITHUB_TOKEN`.

**After either path:**

1. **Repo Settings → Packages**: confirm GHCR is enabled for this repo (it's
   on by default for public repos).
2. **Optional but recommended**: after the first push lands, visit
   `https://github.com/margadeshaka/project-agi/packages/container/<image>/settings`
   and:
   - Set **Visibility** to **public** (so `docker pull ghcr.io/margadeshaka/<image>`
     works without auth — matches the Apache-2.0 distribution stance).
   - Link the package to the `project-agi` repository so deletion is repo-
     scoped if you ever rebuild the workspace.

> **Workflow fallback:** if neither Path A nor Path B is configured,
> `publish-images.yml` enters "verification only" mode — the Docker
> build still runs (so PR CI keeps signal) but the push step is skipped
> with a clear warning in the run summary.

### 3. Trigger the first image publish

After step 2:

1. Open `https://github.com/<owner>/project-agi/actions/workflows/publish-images.yml`.
2. Click **Run workflow** → branch `main` → optional `tag_suffix` (empty
   for v1) → **Run workflow**.
3. The matrix job runs runtime + ui in parallel. Wait ≤15 min.
4. Verify the images are listed at
   `https://github.com/<owner>?tab=packages&repo_name=project-agi`.
5. Cross-check by pulling locally:

   ```bash
   docker pull ghcr.io/<owner>/agi-runtime:sha-<7-char>
   docker pull ghcr.io/<owner>/agi-ui:sha-<7-char>
   ```

   Both should land without auth (if you set Visibility = public in step 2).

## Acceptance criteria (Phase gate 3, end of W11)

These are the **EXECUTION_PLAN.html §4.5** ACs reproduced as a checklist:

- [ ] `helm-kind.yml` is green on `main` at a real SHA (pin below once true).
- [ ] `helm test` passes both pods: `test-runtime-readiness` (probe `/readyz`)
      AND `test-chat-roundtrip` (POST `/chat`, assert `response` field).
- [ ] `ghcr.io/<owner>/agi-runtime:latest` exists and pulls without auth.
- [ ] `ghcr.io/<owner>/agi-ui:latest` exists and pulls without auth.
- [ ] `helm install agi distribution/agi-chart --values values.yaml` succeeds
      on a fresh kind cluster with the published images (not just locally
      built ones) — proves the chart + ghcr loop closes.
- [ ] Pack-hotfix lane (the `pack-hotfix/<ticket-id>` branch convention from
      `docs/deploy/hotfix.md`) completes ≤15 min from merge to live —
      measure once, record the SHA + duration in `docs/deploy/hotfix.md`.

## First-green status (fill in after step 1)

| Run | SHA | Workflow run URL | Result | Time |
| --- | --- | --- | --- | --- |
| `helm-kind` first-pass | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| `publish-images` first-pass | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Hotfix-lane measurement | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

## What the autonomous run did NOT do

Items deferred to the human / a later phase:

- **Multi-arch images.** `publish-images.yml` builds `linux/amd64` only.
  `linux/arm64` is blocked on litellm wheel availability; revisit when the
  upstream ships arm64-native wheels for every pinned version.
- **Image signing (cosign).** Not in v1 scope; revisit at v1.1 alongside
  SLSA provenance.
- **Helm OCI publish.** The chart is not yet pushed to
  `oci://ghcr.io/<owner>/agi`; that's a small `helm push` step you can
  add to `publish-images.yml` after the image publish is green.
- **Real Mongo/Postgres trail sink in `helm test`.** The test pod's
  `MemoryTrailSink` is sufficient for the `/chat` roundtrip; persistent
  sinks land alongside the orchestrator's checkpoint store in P6.

## When this is complete

When all three rows in **First-green status** carry real SHAs and the
acceptance checklist is fully ticked, **Phase gate 3 closes** and P6
(v1.0 release prep — PyPI publish, docs polish, version freeze) is unblocked.
