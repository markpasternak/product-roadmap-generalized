---
id: TD-PLATFORM-003
roadmap_item: PLATFORM-003
title: Feature store and online serving
owner: Priya Venkatesan
status: Approved
visibility: Internal
updated: 2026-08-11
---

# Technical design: Feature store and online serving

## Context
Four teams compute overlapping features in four pipelines. Each has its own
definition of recency, its own backfill behaviour and its own idea of what
"last 30 days" means at a day boundary. The consequences are cost, duplicated
work, and — the expensive one — models that cannot be compared because they were
never trained on the same inputs.

## Goals
- One feature definition, usable in both training and serving.
- Point-in-time-correct training data by construction, not by convention.
- Online serving inside the Home ranking latency budget.
- Automatic detection of training–serving skew.

## Non-goals
- Model training infrastructure. Teams keep their own.
- Replacing the event pipeline (PLATFORM-002); this reads from it.
- Feature discovery beyond a registry — no marketplace, no recommendations.

## Design
A feature is declared once as a transformation over the canonical event stream.
The offline path materialises it into training tables with an as-of join keyed on
event time, so a training row can never see a value computed after the label. The
online path materialises the same declaration into a low-latency store, written
by the same job that writes the offline table — one computation, two sinks. Skew
detection compares the distribution of served values against the training
distribution on a rolling window and alerts on divergence.

## Alternatives considered
- **Per-team pipelines with a shared schema.** Cheaper to adopt and does not
  solve skew, because the computation still differs even when the schema does not.
- **Serving directly from the offline store.** Latency is an order of magnitude
  outside the Home budget.
- **Buying rather than building.** Rejected on residency grounds: PLATFORM-007
  requires per-region control over where feature values live, which none of the
  evaluated vendors could commit to across our target markets.

## Migration
The three largest existing pipelines migrate one at a time, each running dual for
a full retraining cycle with output comparison as the correctness gate. No
pipeline is decommissioned until its consuming model has retrained on store-served
features and matched or beaten its previous offline evaluation.

## Risks
- **Shared-feature ownership.** Two teams needing marginally different behaviour
  from one feature is a governance problem with no clean technical answer.
  Mitigation is a versioned definition with explicit deprecation, and an owner.
- **Serving availability.** A store outage degrades every personalisation surface
  at once, which is a larger blast radius than the pipelines it replaces. Requires
  a documented fallback to a stale-but-serving snapshot.
