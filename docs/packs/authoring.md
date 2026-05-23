<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->

# Authoring a pack

A **pack** is the smallest unit of customer-facing customisation in
project-agi. It groups a brand identity, a set of prompts, a knowledge
base, a tool allow-list, and the demo scenarios that exercise them. The
runtime loads packs at startup and re-loads them on `SIGHUP`.

This document explains the on-disk layout, the schemas, and the
review-and-ship loop.

## Directory layout

```
packs/<slug>/
  pack.yaml                # required — identity + metadata
  tools.yaml               # required — MCP tool allow-list
  prompts/                 # required — Jinja2 prompt templates
    system.j2
    deflect.j2
    resolve.j2
    escalate.j2
  kb/                      # optional — knowledge-base articles (Markdown)
    *.md
  scenarios/               # optional — demo scenarios (JSON)
    *.scenario.json
  README.md                # optional but recommended
```

The runtime treats `prompts/` and `kb/` as opaque trees — you can add
subdirectories (e.g. for locales) provided you reference them
explicitly from `pack.yaml`.

## `pack.yaml`

Required keys:

- `slug` — string. Stable identifier. Must match the parent dir name.
- `version` — string (SemVer recommended).
- `name` — human-readable name shown in the admin console.
- `models` — list of role names the pack declares
  (e.g. `reasoning`, `fast`, `embedding`). `operator.yaml` must bind
  each role to a concrete model id.

Optional `metadata` keys consumed by the runtime + UI:

- `vertical` — e.g. `telco`, `fleet`, `utility`, `retail`. Surfaces in
  the admin console pack picker.
- `display_name` — human-friendly customer name.
- `theme.primary` / `.secondary` / `.accent` / `.mode` — brand tokens.
- `role_bindings.system_prompt` — path to the system prompt template.
- `role_bindings.scenarios.<slug>` — path to a scenario-specific prompt.
- `kb.article_count` / `kb.locale` — metadata used by the KB indexer.
- `scenarios` — list of paths to scenario JSON files (used by the
  validator and by the demo presenter).
- `contact.support_hours` / `contact.handoff_queue` — defaults injected
  into prompt context.

See `packs/telco-demo/pack.yaml` for a fully populated example.

## `tools.yaml`

A single `allow:` list of MCP tool names the agent may dispatch. The
runtime enforces this list at dispatch time — a tool call to any name
outside it returns a permission-denied AI Trail event without ever
hitting the tool transport.

Keep this list as short as the scenarios genuinely need; broad
allow-lists are the most common source of regression in pack hotfixes.

## Prompts

Each `prompts/*.j2` file is a Jinja2 template. The runtime renders it
with a per-turn context dict (`customer`, `invoice`, `kb_excerpts`,
etc.). Document the expected context vars in the template's leading
comment so prompt edits don't accidentally drop required data.

Style guidelines:

- Use `StrictUndefined` semantics — if you reference a context var,
  expect the runtime to crash when it is missing. Defaults belong in
  the template (`{{ x | default("…") }}`).
- Keep tool-calling instructions explicit. Most regressions come from
  ambiguous "call the right tool" language.
- Always include a disclosure clause for autonomous actions.

## KB articles

Plain Markdown with optional front matter (`title`, `slug`, `tags`,
`audience`, `last_reviewed`). The runtime indexes the front-matter
fields and uses them to filter candidates before the embedding search.

Article length: 80–300 words. Longer than that, split it.

## Scenarios

A scenario JSON describes a deterministic demo run:

- `slug` / `pack` / `category` — identity (one of `deflect`, `resolve`,
  `escalate`).
- `input` — what the customer (or dispatcher) sends.
- `context` — fixture data the runtime would normally fetch.
- `expected_events` — ordered list of AI Trail events the run must
  produce. Each entry has a `type` and a `match` object.
- `expected_no_events` — events that must NOT appear.
- `assertions` — free-form policy checks (sentence count, citation
  required, etc.).

The Playwright e2e suite and the in-app demo narrator both read
scenario JSONs, so keep them small and stable.

## Ship loop

For local development:

```python
from agi.packs import load_pack
pack = load_pack("packs/my-pack")
print(pack.tool_allowlist)
```

For CI: `.github/workflows/validate-packs.yml` runs the SDK loader and
the scenario JSON validator on every push.

For a hotfix to an already-deployed pack, see
`docs/deploy/hotfix.md`.
