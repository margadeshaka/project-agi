<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->
---
title: Delivery exception codes
slug: delivery-exception-codes
tags: [delivery, exceptions, dispatch]
audience: dispatcher
last_reviewed: 2026-04-01
---

# Delivery exception codes

Every delivery transitions through a small set of exception codes when
something prevents the planned outcome. Codes are short, stable, and
machine-readable; they should never be shown raw to a recipient.

- **DEX-01 — Recipient unavailable.** The driver attempted delivery
  within the agreed window but no one was present. Default action:
  reattempt next day; switch to alternate address on second occurrence.
- **DEX-02 — Address not found.** Geocode mismatch or premises closed.
  Default action: contact the originator and re-confirm address; do not
  re-attempt without confirmation.
- **DEX-03 — Vehicle breakdown.** Driver reported a mechanical fault.
  Default action: dispatch swap vehicle if SLA window allows, else open
  a ticket and notify the recipient.
- **DEX-04 — Refused on delivery.** Recipient declined the goods.
  Default action: capture reason, return to origin, open RMA.
- **DEX-05 — Weather / road closure.** External factor blocking the
  route. Default action: trigger route incident lookup and recompute
  ETA for the entire downstream leg.

A delivery may carry at most one active exception code; codes are
overwritten by the latest event, not appended.
