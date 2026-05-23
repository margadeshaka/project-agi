<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->

# fleet-demo

Vendor-neutral reference pack for a fleet-telematics dispatch surface.
Bundled with project-agi to demonstrate the Deflect -> Resolve ->
Escalate capability ladder against generic fleet content.

## What is in here

```
fleet-demo/
  pack.yaml                       # identity, theme, role bindings, tool allow-list
  tools.yaml                      # MCP tool allow-list
  prompts/
    system.j2                     # system prompt
    deflect.j2                    # delivery-exception triage
    resolve.j2                    # route-incident reroute
    escalate.j2                   # safety driver handoff
  kb/
    delivery-exception-codes.md
    route-incident-handling.md
    driver-handoff.md
    eta-recompute-policy.md
    proof-of-delivery.md
  scenarios/
    deflect.scenario.json
    resolve.scenario.json
    escalate.scenario.json
```

## Quick start

```
helm install agi distribution/agi-chart \
  --set-file packs.config=packs/fleet-demo/pack.yaml \
  --set global.hardening.mode=single \
  --set global.hardening.pack=fleet-demo
```

## Rebranding

This pack is vendor-neutral — every reference reads "ExampleCo Fleet" or
generic phrasing. Migration recipe: see `docs/packs/migration.md`.
