<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->

# Migrating from `packs/blank` to a real pack

The bundled `packages/agi-packs/blank` pack is the smallest thing the
SDK can load — it declares `slug`, `version`, and two model roles, and
nothing else. It exists to let SDK tests run without depending on a
demo pack.

This document walks you through promoting `blank` into a real pack that
the runtime can serve.

## Decision points before you start

1. **Slug.** Pick something short and DNS-safe. It surfaces in URLs,
   image tags, and the admin console.
2. **Vertical.** Pick the closest match from `telco`, `fleet`,
   `utility`, `retail`. Custom verticals are fine but won't match any
   shipped reference theme.
3. **Tool surface.** Decide which MCP tools the pack will ever call.
   Start tight — adding tools later is trivial; removing them after a
   prompt has come to depend on them is a regression risk.
4. **KB scope.** Identify five to ten "first turn" customer questions.
   Each becomes a KB article. Real telco/fleet packs grow to 30+
   articles but the first version should be tight.

## Step-by-step

### 1. Scaffold the pack

```bash
cp -r packages/agi-packs/blank packs/<slug>
cd packs/<slug>
```

### 2. Edit `pack.yaml`

Replace `blank` with `<slug>` and add the metadata block. Start from the
shape in `packs/care-demo/pack.yaml` — copy, then strip what you don't
need:

```yaml
slug: <slug>
version: 0.1.0
name: <Display name>
models:
  - reasoning
  - fast
  - embedding
metadata:
  vertical: <telco|fleet|utility|retail>
  display_name: <Customer-facing name>
  theme:
    primary: "#..."
  role_bindings:
    system_prompt: prompts/system.j2
    scenarios:
      deflect: prompts/deflect.j2
      resolve: prompts/resolve.j2
      escalate: prompts/escalate.j2
  scenarios:
    - scenarios/deflect.scenario.json
    - scenarios/resolve.scenario.json
    - scenarios/escalate.scenario.json
```

### 3. Write `tools.yaml`

Start with `kb.search` only — everything else gets added when a
scenario actually needs it. Avoid copy-pasting the full care-demo
allow-list; that's how leaky tool surfaces happen.

### 4. Create the prompt templates

Copy `prompts/system.j2` from a reference pack and edit the operator
name and operating principles. Then add scenario-specific prompts only
for the scenarios you actually plan to ship.

The convention is one `*.j2` per scenario category, named after the
category (`deflect`, `resolve`, `escalate`).

### 5. Seed KB articles

Drop five Markdown files into `kb/` with the front-matter shape used
by the reference packs. Each article should be 80–300 words and cover
exactly one topic.

### 6. Write scenarios

The minimum schema is:

```json
{
  "schema_version": 1,
  "slug": "<pack>-<category>",
  "pack": "<slug>",
  "category": "deflect",
  "input":   { "utterances": ["..."] },
  "context": {},
  "expected_events": [
    { "type": "agent.turn.start", "match": {} },
    { "type": "tool.call",        "match": { "name": "kb.search" } },
    { "type": "agent.turn.end",   "match": { "outcome": "deflected" } }
  ]
}
```

### 7. Validate locally

```bash
python - <<'PY'
from agi.packs import load_pack
pack = load_pack("packs/<slug>")
print(pack.slug, pack.version, pack.tool_allowlist)
PY
```

Or push to CI — `validate-packs.yml` will catch the obvious mistakes.

### 8. Mount the pack

```bash
helm upgrade agi distribution/agi-chart \
  --reuse-values \
  --set-file packs.config=packs/<slug>/pack.yaml \
  --set global.hardening.mode=single \
  --set global.hardening.pack=<slug>
```

### 9. Iterate via the hotfix lane

Once the pack is in production, route subsequent edits through
`pack-hotfix/<slug>/<ticket-id>` branches — see
`docs/deploy/hotfix.md`.

## Common pitfalls

- **Forgetting to declare a referenced prompt.** `validate-packs.yml`
  will fail with a clear "missing referenced file" error.
- **Tool name typos.** The runtime won't synthesise tools — a typo in
  `tools.yaml` becomes a permission-denied AI Trail event the first
  time a prompt asks for it.
- **Prompt context vars that don't exist.** Jinja `StrictUndefined`
  means missing vars crash at render time. Document each prompt's
  expected context in its leading comment.
- **Multi-locale packs.** Use the `prompts/<name>/<locale>.yaml`
  layout supported by `agi.prompts.PromptsAPI` once you outgrow the
  single-locale `.j2` convention.
