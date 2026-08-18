---
id: MUSIC-004
title: Playback resilience on constrained networks
product: Music App
horizon: Now
stage: Building
owner: Erik Lindqvist
tags: playback, reliability
impact: High
effort: Medium
order: 6
visibility: Internal
external_visibility: Internal only
---

# Playback resilience on constrained networks

## One-liner
Close the remaining gap between playback quality in our best markets and our fastest-growing ones.

## Why it matters
The offline-first engine fixed cold-start latency but left mid-session degradation largely untouched, and that is where the remaining complaints sit. Growth is now concentrated in markets where the median connection is worse than anything our synthetic tests simulate, so the failure modes we ship against are not the failure modes users hit. Until this closes, every consumer feature we build is measured on a platform that behaves differently depending on where you live.

## What ships
Adaptive bitrate ladders tuned per market rather than globally, a bounded local buffer that survives a full radio handover, network-condition-aware prefetch aggressiveness, and a replay harness built from anonymised real-world connection traces rather than synthetic profiles.

## Who it's for
Listeners in high-growth markets; internally, every product team whose experiments are currently noised by playback variance.

## Target outcome
Bring the 95th-percentile stall rate in the ten largest growth markets within a factor of two of the global median.

## Open questions
- Do we tune ladders per market or per carrier? Per carrier is more accurate and considerably more to maintain.
- How much local storage can we claim on entry-level devices before it becomes the complaint?
