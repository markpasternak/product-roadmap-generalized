---
id: PLATFORM-003
title: Feature store and online ML serving
product: Core Platform & Data
horizon: Now
startDate: 2026-08-17
endDate: 2026-10-30
stage: Building
owner: Priya Venkatesan
tags: ml, infrastructure, theme:ml-personalisation
impact: High
effort: High
order: 5
visibility: Internal
external_visibility: Internal only
---

# Feature store and online ML serving

## One-liner
Shared feature computation and low-latency serving so personalisation teams stop each building their own.

## Why it matters
Four teams currently compute overlapping features in four pipelines with four definitions of recency, which is expensive and, worse, means a model trained on one team's features cannot be evaluated against another's. Training-serving skew is the failure mode nobody catches until a launch underperforms for no visible reason. Unified Home, daylists and ads ranking all block on this.

## What ships
A feature store with shared definitions and point-in-time-correct training data, a low-latency online serving path, automatic skew detection between training and serving distributions, and migration of the three largest existing pipelines onto it.

## Who it's for
Every ML team; downstream, every personalisation surface.

## Target outcome
The three largest pipelines migrated, feature reuse across at least two teams, and serving latency inside the budget that Unified Home needs.

## Open questions
- Who owns a shared feature when two teams need it to behave differently at the margins?
- Does the serving path need to survive a region failure independently, or does it inherit whatever PLATFORM-011 eventually provides?

## Links
- Technical design: technical-design/TD-PLATFORM-003-feature-store.md
