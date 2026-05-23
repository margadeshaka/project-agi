<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->
---
title: Driver handoff to tier-2 dispatch
slug: driver-handoff
tags: [escalation, driver, dispatch]
audience: agent
last_reviewed: 2026-04-15
---

# Driver handoff to tier-2 dispatch

A handoff to tier-2 dispatch is required whenever any of the following
is true:

- The driver reports a safety incident: collision, medical event,
  altercation, hijack risk, or suspected fraud.
- A route incident requires a reroute that exceeds the autonomous
  reroute budget.
- The vehicle telemetry has gone silent for more than fifteen minutes
  on a route that should be in motion.
- The dispatcher explicitly asks for a human.

A clean handoff includes the vehicle id, the driver id, the active
route id, the last known GPS fix with timestamp, and a one-paragraph
summary written for a human dispatcher (not the customer).

The destination queue is determined by the incident type:
`dispatch-tier-2-safety` for any safety event,
`dispatch-tier-2-ops` for route / capacity issues, and
`dispatch-tier-2-trust` for suspected fraud or theft.

After the handoff the assistant returns to a passive role on the
conversation but remains attached so it can supply the human dispatcher
with policy snippets, route history, and prior tickets on demand.
