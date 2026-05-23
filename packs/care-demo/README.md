<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->

# care-demo

Industry-neutral reference pack for customer-care agents. Bundled with
project-agi to demonstrate the Deflect → Resolve → Escalate capability
ladder against generic support content that applies to any subscription
or service business (SaaS, utility, membership, retail, finance, …).

## What is in here

```
care-demo/
  pack.yaml                       # identity, theme, role bindings, tool allow-list
  tools.yaml                      # MCP tool allow-list (enforced at dispatch)
  prompts/
    system.j2                     # system prompt
    deflect.j2                    # scenario prompt — KB-only path
    resolve.j2                    # scenario prompt — autonomous credit
    escalate.j2                   # scenario prompt — handoff to tier-2
  kb/
    account-activation.md
    bill-explanation.md
    plan-change.md
    refund-policy.md
    tier-2-escalation.md
  scenarios/
    deflect.scenario.json
    resolve.scenario.json
    escalate.scenario.json
```

## Quick start

Mount this pack into the runtime via Helm:

```
helm install agi distribution/agi-chart \
  --set-file packs.config=packs/care-demo/pack.yaml \
  --set global.hardening.mode=single \
  --set global.hardening.pack=care-demo
```

Or run it inline with the SDK in your own script:

```python
from agi.packs import load_pack
pack = load_pack("packs/care-demo")
print(pack.slug, pack.version, pack.tool_allowlist)
```

## Rebranding

This pack is intentionally vendor-neutral — every reference reads
"Acme Care" or generic phrasing. To turn it into a real product pack:

1. Copy the directory under a new slug (`packs/<your-slug>/`).
2. Edit `pack.yaml` — slug, name, `metadata.display_name`, theme colours.
3. Replace `kb/*.md` with your own KB content (keep the front-matter
   shape).
4. Adjust `tools.yaml` if your tool surface differs.
5. Tweak scenario context if your invoice or ticket schema differs.

See `docs/packs/migration.md` for a step-by-step migration recipe.
