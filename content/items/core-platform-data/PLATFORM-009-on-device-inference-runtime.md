---
id: PLATFORM-009
title: On-device inference runtime
product: Core Platform & Data
horizon: Later
stage: Discovery
owner: Unassigned
tags: ml, mobile, theme:ml-personalisation
impact: Medium
effort: High
order: 5
visibility: Internal
external_visibility: Internal only
---

# On-device inference runtime

## One-liner
Run small personalisation models on the device instead of in the serving path.

## Why it matters
On-device inference would cut serving cost, remove network latency from ranking, and let personalisation work offline — which matters most in exactly the markets where connectivity is worst. It also reduces how much behavioural signal has to leave the device, which is a real privacy improvement rather than a positioning one. The constraint is the device fleet, whose low end is much lower than our own devices suggest.

## What ships
Undefined. Discovery needs a defensible read on what fraction of the active fleet could actually run a useful model.

## Who it's for
Listeners on constrained connections; internally, cost and privacy.

## Target outcome
A model-size and device-coverage envelope that says whether this is worth building.

## Open questions
- If only the top tier of devices can run it, does a two-tier personalisation quality split become a fairness problem?
- How do we update models on-device without shipping an app release for every retrain?
