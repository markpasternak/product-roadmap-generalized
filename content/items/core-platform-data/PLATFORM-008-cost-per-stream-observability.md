---
id: PLATFORM-008
title: Cost-per-stream observability
product: Core Platform & Data
horizon: Next
stage: Shaping
owner: Erik Lindqvist
tags: cost, observability
impact: Medium
effort: Medium
order: 15
visibility: Internal
external_visibility: Internal only
---

# Cost-per-stream observability

## One-liner
Attribute infrastructure cost down to the stream, so teams can see what their decisions cost.

## Why it matters
Infrastructure cost is currently a monthly aggregate that nobody can act on, which means every efficiency conversation happens in the abstract and none of them change a design decision. Attributing cost per stream by format, market and delivery path makes the tradeoffs concrete — the lossless tier decision, in particular, is unanswerable without it. Cheap to build relative to what it will surface.

## What ships
Cost attribution by format, market, device class and delivery path; per-team dashboards with trend and anomaly detection; and a cost model teams can query before a design decision rather than after.

## Who it's for
Engineering teams making delivery and storage decisions; finance for planning.

## Target outcome
Every major delivery path has an attributed cost per stream that finance and engineering both accept as accurate.

## Open questions
- Shared infrastructure resists clean attribution. Is a defensible allocation good enough, or does contested allocation just move the argument?
