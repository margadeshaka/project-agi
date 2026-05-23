<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->
---
title: Escalating to tier-2 support
slug: tier-2-escalation
tags: [escalation, handoff, tier-2]
audience: agent
last_reviewed: 2026-04-18
---

# Escalating to tier-2 support

The AI assistant escalates to a human tier-2 agent when any of the
following is true:

- The customer explicitly asks for a human agent.
- The detected sentiment score is below -0.5 over two consecutive turns.
- The required action exceeds the assistant's autonomous authority — for
  example a credit above the cap, a contract amendment, or a
  number-portability dispute.
- The conversation has looped: the same intent has been asked three or
  more times without resolution.

A clean handoff includes: a one-paragraph summary of what has been
tried, the customer's verified identity status, the desired outcome in
the customer's words, and any tickets or invoices already referenced.
The destination queue is determined by the request type — `tier-2-mobile`
for service-line issues, `tier-2-billing` for invoice disputes, and
`tier-2-trust` for fraud or account-takeover concerns.

After the handoff, the AI assistant returns to a passive role on the
conversation but remains attached so it can supply the human agent with
recap and policy snippets on demand.
