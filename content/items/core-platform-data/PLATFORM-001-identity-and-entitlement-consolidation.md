---
id: PLATFORM-001
title: Identity and entitlement consolidation
product: Core Platform & Data
horizon: Completed
stage: Shipped
owner: Mei-Lin Chen
tags: identity, entitlements, theme:one-account
impact: High
effort: High
order: 5
visibility: Internal
external_visibility: Internal only
---

# Identity and entitlement consolidation

## One-liner
One service that answers who a listener is and what they are entitled to, replacing four that disagreed.

## Why it matters
Four systems held overlapping views of entitlement and reconciled nightly, which meant a plan change could take hours to take effect and occasionally never did. Every support escalation about "I paid and it did not work" traced back here. It also blocked anything that needed a trustworthy real-time answer — household plans, audiobook allowances, seat management — so the cost was mostly opportunity cost.

## What ships
A single authoritative identity and entitlement service with real-time evaluation, a migration that ran dual-write and dual-read for a full quarter before cutover, an entitlement audit trail, and decommissioning of all four legacy stores.

## Who it's for
Every product team; listeners experience it as plan changes that take effect immediately.

## Target outcome
One source of truth, sub-second entitlement evaluation, and all four legacy systems retired. Delivered, with the last legacy store shut down on schedule.
