<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->
---
title: Refund and goodwill credit policy
slug: refund-policy
tags: [refund, credit, policy]
audience: agent
last_reviewed: 2026-04-20
---

# Refund and goodwill credit policy

Care agents (and the AI assistant when authorised) may issue goodwill
credits up to a per-incident cap without supervisor approval. The cap is
controlled by the `thresholds.credit_cap_usd` operator config; the
shipped default is 25 USD or local-currency equivalent.

Credits are appropriate for:

- A duplicate charge that the customer has not yet been refunded for.
- A documented service outage in the customer's coverage area that
  affected the billing period.
- A usage charge incurred during a documented service incident on the
  provider's side.

Credits are NOT appropriate for:

- Disputed usage where the rating is correct and within plan terms.
- Goodwill requests that have already received two credits in the
  previous 90 days. These must be routed to tier-2.

Every credit must record a free-text **reason** field; the AI assistant
includes that reason in its disclosure to the customer. Credits over the
cap require a supervisor and are routed to the credit-review queue.
