---
id: PLATFORM-011
title: Multi-region active-active playback
product: Core Platform & Data
horizon: Later
stage: Parked
owner: Unassigned
tags: reliability, infrastructure
impact: Medium
effort: High
order: 15
visibility: Internal
external_visibility: Internal only
---

# Multi-region active-active playback

## One-liner
Serve playback from multiple regions simultaneously so a regional failure is invisible.

## Why it matters
Our current posture is active-passive with a failover measured in minutes, which has been adequate because regional failures have been rare and short. Active-active would make them invisible. Parked because the residency work will substantially change the regional architecture, and rebuilding this twice would be indefensible — it should follow PLATFORM-007, not precede it.

## What ships
Nothing until residency lands.

## Who it's for
All listeners, during incidents they would otherwise notice.

## Target outcome
None while parked. Reassess once the residency architecture is settled.

## Open questions
- Does the residency design constrain active-active in ways that make it impossible in some markets?
