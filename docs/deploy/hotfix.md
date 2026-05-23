<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->

# Pack hotfix lane

project-agi separates **runtime** changes from **pack** changes. The
runtime is upgraded on a release cadence; packs (prompts, KB, scenario
config) can ship in minutes through the **hotfix lane**.

This document covers what the lane is, how to use it as a pack
maintainer, and how to wire it into your own pack repository using the
shipped workflow template.

## When to use the hotfix lane

Use it when:

- A prompt needs a copy edit ("change the closing line", "drop the
  apology").
- A KB article needs a small correction (pricing, hours, phone number).
- A scenario expected-event arrays needs to be updated after a planned
  tool rename.
- An operator-config knob (credit cap, autonomy budget) needs to move
  but the runtime image is unchanged.

Do NOT use it when:

- The change requires a new tool, a new MCP server, or a runtime code
  path. Those go through the normal runtime release pipeline.
- The change is structural enough to break the pack schema (rename
  `slug`, restructure `pack.yaml`).

## Branch and commit conventions

The lane is gated on branch name:

```
pack-hotfix/<slug>/<ticket-id>
```

Example: `pack-hotfix/telco-demo/AGI-1473`.

The CI workflow extracts the `<slug>` and `<ticket-id>` from the branch
name and uses them to name the resulting image tag:

```
ghcr.io/<org>/agi-pack-<slug>:<ticket-id>-<short-sha>
```

## What the pipeline does

The workflow at `.github/workflow-templates/pack-hotfix.yml` runs three
jobs on every push to a `pack-hotfix/**` branch:

1. **smoke** — loads `packs/<slug>/pack.yaml` with the SDK, renders every
   `prompts/*.j2` with sample context, validates KB markdown, and parses
   every `scenarios/*.scenario.json`. Fails fast on schema drift.
2. **build** — builds a thin pack-bundle image on top of the
   `agi-runtime` image, baking the hotfixed pack into `/packs/<slug>`,
   and pushes it to GHCR with the tag computed above.
3. **deploy** — POSTs a notification to the rollout webhook configured
   via the `PACK_HOTFIX_WEBHOOK_URL` repo var and
   `PACK_HOTFIX_WEBHOOK_TOKEN` secret. Actual rollout is operator-side
   (Argo, Flux, custom rollout controller, manual `helm upgrade`).

## Adopting the template in your pack repo

1. Copy `.github/workflow-templates/pack-hotfix.yml` to
   `.github/workflows/pack-hotfix.yml` in your pack repository.
2. Set repo settings:
   - **Variables** — `PACK_HOTFIX_WEBHOOK_URL` (the rollout endpoint).
   - **Secrets** — `PACK_HOTFIX_WEBHOOK_TOKEN` (bearer for the webhook).
3. Make sure your `packages/agi-sdk` dependency line in the workflow
   points at a tag that exists on the project-agi repo.
4. Push a branch matching the pattern; the workflow takes over.

## Rolling back a hotfix

A hotfix is just a new image tag — rollback is `helm upgrade` back to
the previous tag. The original tag stays on GHCR; the chart re-mounts
the previous pack content unchanged.

If the rollback needs to be faster, the runtime supports SIGHUP-driven
pack reload from the mounted ConfigMap; restoring the old ConfigMap is a
zero-downtime path.
