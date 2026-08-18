---
id: PLATFORM-010
title: Rights and royalties ledger rebuild
product: Core Platform & Data
horizon: Later
stage: Discovery
owner: Unassigned
tags: rights, royalties, theme:trust-and-safety
impact: High
effort: High
order: 10
visibility: Internal
external_visibility: Internal only
---

# Rights and royalties ledger rebuild

## One-liner
Replace the accreted rights and royalty stores with one auditable ledger.

## Why it matters
Rights data lives across several systems that were correct when written and have drifted since, and reconciliation is a monthly manual exercise that a small number of people understand. It is the constraint behind royalty transparency, self-service rights claims and any per-market licensing change, and it is the largest operational risk on this list — the kind that is invisible until it is not. It sits in Later because it is a multi-year rebuild that must not break payouts for a single month while it runs.

## What ships
Undefined. Discovery is scoping a migration that can run alongside the existing systems for as long as it takes, with continuous reconciliation as the correctness gate.

## Who it's for
Rights holders, artists, finance; downstream, ARTISTS-004 and ARTISTS-010.

## Target outcome
A migration plan with a credible correctness argument, or an honest decision that the risk is not yet worth taking.

## Open questions
- Is there a path that does not require a cutover at all?
- What is the cost of continuing to defer this, and how do we make that cost visible in planning?
