<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->

# telco-demo

Vendor-neutral reference pack for a mobile-network operator. Bundled with
project-agi to demonstrate the Deflect -> Resolve -> Escalate capability
ladder against generic telco-care content.

## What is in here

```
telco-demo/
  pack.yaml                       # identity, theme, role bindings, tool allow-list
  tools.yaml                      # MCP tool allow-list (enforced at dispatch)
  prompts/
    system.j2                     # system prompt
    deflect.j2                    # scenario prompt — KB-only path
    resolve.j2                    # scenario prompt — autonomous credit
    escalate.j2                   # scenario prompt — handoff to tier-2
  kb/
    esim-activation.md
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
  --set-file packs.config=packs/telco-demo/pack.yaml \
  --set global.hardening.mode=single \
  --set global.hardening.pack=telco-demo
```

Or run it inline with the SDK in your own script:

```python
from agi.packs import load_pack
pack = load_pack("packs/telco-demo")
print(pack.slug, pack.version, pack.tool_allowlist)
```

## Rebranding

This pack is intentionally vendor-neutral — every reference reads
"Acme Mobile" or generic phrasing. To turn it into a real operator pack:

1. Copy the directory under a new slug (`packs/<your-slug>/`).
2. Edit `pack.yaml` — slug, name, `metadata.display_name`, theme colours.
3. Replace `kb/*.md` with your own KB content (keep the front-matter
   shape).
4. Adjust `tools.yaml` if your tool surface differs.
5. Tweak scenario context if your invoice or ticket schema differs.

See `docs/packs/migration.md` for a step-by-step migration recipe.
