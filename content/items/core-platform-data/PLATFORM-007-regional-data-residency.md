---
id: PLATFORM-007
title: Regional data residency
product: Core Platform & Data
horizon: Next
stage: Shaping
owner: Hanna Virtanen
tags: compliance, data, theme:trust-and-safety
impact: High
effort: High
order: 10
visibility: Internal
external_visibility: Internal only
---

# Regional data residency

## One-liner
Keep listener data in-region where regulation requires it, without forking every service.

## Why it matters
Residency requirements are expanding and are now a precondition for operating in markets we intend to grow in. The naive implementation — a regional fork of the stack — is unaffordable and would permanently double our operational cost. The work is finding the boundary where data must stay in-region and the rest can remain global, which is a design problem more than a compliance one.

## What ships
Data classification identifying what is residency-bound, regional storage for that subset with global services reading through a residency-aware access layer, per-market policy configuration rather than code forks, and an audit trail that satisfies a regulator without a manual evidence exercise.

## Who it's for
Listeners in regulated markets; internally, legal, and every team that would otherwise be asked to fork.

## Target outcome
Meet residency requirements in the target markets with no regional service forks and no measurable latency regression.

## Open questions
- Does aggregate analytics derived from residency-bound data inherit the constraint? Legal opinion differs by market and the answer changes the cost by a lot.
- What is the plan for a market that later adds a requirement we cannot meet inside this design?
