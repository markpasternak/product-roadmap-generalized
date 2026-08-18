---
id: MUSIC-008
title: Cross-device handoff and Connect v3
product: Music App
horizon: Next
stage: Shaping
owner: Mei-Lin Chen
tags: playback, devices, theme:one-account
impact: Medium
effort: High
order: 11
visibility: Internal
external_visibility: Internal only
---

# Cross-device handoff and Connect v3

## One-liner
Move a session between phone, speaker, car and TV without losing position, queue or context.

## Why it matters
Handoff is the most-used feature nobody credits us for, and the current implementation is a decade of accreted device protocols held together by retries. Every new surface — car, TV, wearables — pays a tax to integrate, and each one degrades differently. Rebuilding it is unglamorous and unblocks a lot of roadmap that is currently priced as impossible.

## What ships
A single session-state service that owns queue, position and context independent of the playing device, a versioned device protocol replacing the per-platform forks, sub-second transfer as the target, and a compatibility shim so existing certified devices keep working through the transition.

## Who it's for
Multi-device households; internally, every team blocked on the current protocol.

## Target outcome
One protocol serving every surface, with transfer latency and failure rate both improved against the current baseline on real certified hardware.

## Open questions
- How long do we carry the compatibility shim? Third-party certified devices update on their own timelines and some never will.
- Does session state belong in the household model from PLATFORM-004, or alongside it?
