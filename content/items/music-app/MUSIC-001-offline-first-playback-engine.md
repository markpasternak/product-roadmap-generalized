---
id: MUSIC-001
title: Offline-first playback engine
product: Music App
horizon: Completed
stage: Shipped
owner: Erik Lindqvist
tags: playback, reliability
impact: High
effort: High
order: 1
visibility: Public
external_visibility: Public
---

# Offline-first playback engine

## One-liner
Rebuilt the playback engine so a track starts from local cache first and reconciles with the network afterwards.

## Why it matters
Playback failures were the single largest driver of session abandonment, and they clustered exactly where growth is fastest — commuter transit, mid-tier Android devices, and markets with intermittent 4G. The old engine treated the network as the source of truth and the cache as an optimisation, so a two-second DNS stall became a two-second silence. Fixing the ordering was worth more than any feature we could have shipped in the same quarter.

## What ships
A rewritten audio pipeline that resolves a playable source locally before it opens a socket, a predictive prefetcher that keeps the next three tracks of any queue warm, and a reconciliation pass that swaps in the higher-bitrate stream mid-playback without a gap. Shipped behind a staged rollout across all platforms.

## Who it's for
Every listener, but the measurable win is concentrated in mobile listeners on unreliable connections.

## Target outcome
Sub-200ms perceived start time at the 95th percentile and a meaningful reduction in mid-session drop-off. Both held through the full rollout.
