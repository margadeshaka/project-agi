<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->
---
title: Handling a route incident
slug: route-incident-handling
tags: [route, incident, reroute]
audience: dispatcher
last_reviewed: 2026-04-05
---

# Handling a route incident

A route incident is any external event that invalidates the planned ETA
for a vehicle: an accident on the planned road, a closure, severe
weather, a protest, or a sudden bridge weight restriction. Incidents are
published by the traffic-provider feed and surfaced on the dispatch
console as red overlays on the live map.

The AI dispatch assistant evaluates each incident with three questions:

1. **Does it actually affect the vehicle's path?** A 5 km offset on a
   parallel road usually does not warrant a reroute.
2. **Is an alternative within the autonomous reroute budget?** The
   shipped default is +15 minutes added to the ETA. Anything beyond that
   requires a dispatcher confirmation.
3. **Does the reroute cascade to downstream stops?** If yes, every
   affected stop is rescheduled and recipients receive the updated ETA.

Reroutes the assistant performs are logged on the AI Trail with the
incident id; rejected reroutes are logged with the reason. A reroute is
reversible by the dispatcher within the next ten minutes.
