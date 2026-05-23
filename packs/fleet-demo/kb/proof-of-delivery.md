<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->
---
title: Proof of delivery
slug: proof-of-delivery
tags: [pod, delivery, audit]
audience: dispatcher
last_reviewed: 2026-04-02
---

# Proof of delivery

Every completed delivery records a proof-of-delivery (PoD) bundle:

- A timestamped geo-fix taken when the **Mark delivered** event was
  fired on the driver app.
- One photograph of the parcel or signature, captured by the driver app.
- The recipient's typed name if signature-on-glass was used.
- The exception code (if any).

PoD is retained for seven years to satisfy commercial audit
requirements. The AI dispatch assistant can surface a PoD to the
dispatcher on demand by calling `delivery.get_status`. It will not
surface PoD photographs over a recipient channel — only the dispatcher
console may render them.

When a delivery dispute is opened, PoD is the first artefact the
assistant cites. If the PoD is missing or visibly corrupt the
assistant escalates rather than guessing — see the driver-handoff
article.
