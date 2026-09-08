---
id: PLATFORM-006
title: Experimentation platform v3
product: Core Platform & Data
horizon: Next
startDate: 2026-10-12
endDate: 2027-01-29
stage: Committed
owner: Unassigned
tags: experimentation, tooling
impact: High
effort: Medium
order: 5
visibility: Internal
external_visibility: Internal only
---

# Experimentation platform v3

## One-liner
Rebuild experimentation around interaction detection, sequential testing and enforced holdbacks.

## Why it matters
We run enough concurrent experiments that interaction effects are no longer theoretical, and the current platform cannot detect them — so some share of our shipped wins are not wins. Fixed-horizon testing also means teams either wait too long or peek, and most peek. Sequential testing makes peeking legitimate instead of pretending it does not happen.

## What ships
Interaction detection across concurrent experiments, sequential testing with valid early stopping, a permanent global holdback so long-run effects are measurable, and automatic guardrail metrics that halt an experiment causing harm outside its own success metric.

## Who it's for
Every product team; ultimately anyone reading a launch decision.

## Target outcome
Interaction effects surfaced before launch rather than discovered afterwards, and a global holdback that gives an honest annual read on cumulative impact.

## Open questions
- How large is the permanent holdback, and who is willing to be excluded from every launch to fund it?
