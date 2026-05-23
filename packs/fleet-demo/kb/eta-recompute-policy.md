<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->
---
title: ETA recompute policy
slug: eta-recompute-policy
tags: [eta, policy, dispatch]
audience: dispatcher
last_reviewed: 2026-04-08
---

# ETA recompute policy

The fleet platform recomputes the ETA for an active leg whenever any of
the following thresholds trips:

- The vehicle has been stationary for more than three minutes while the
  route plan expected motion.
- The current speed has dropped to under 25% of the segment's normal
  speed for over five minutes.
- A route incident covers the next planned segment.
- A new stop has been inserted ahead of the current leg.

A recompute updates two fields: the leg-level ETA shown on the dispatch
console, and the customer-visible ETA shown on the recipient tracking
page. The customer-visible ETA is rounded up to the nearest five
minutes to avoid frequent micro-updates.

If the recomputed ETA misses the recipient's contracted window, the AI
dispatch assistant generates a proactive notification draft for the
dispatcher to approve. The draft includes the new ETA, the reason in
one sentence, and an apology — but never the underlying telemetry.
