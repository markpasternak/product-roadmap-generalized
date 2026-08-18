---
id: PLATFORM-002
title: Unified event pipeline and schema registry
product: Core Platform & Data
horizon: Completed
stage: Shipped
owner: Unassigned
tags: data, pipeline
impact: High
effort: High
order: 10
visibility: Internal
external_visibility: Internal only
---

# Unified event pipeline and schema registry

## One-liner
One event pipeline with enforced schemas, replacing per-team pipelines with per-team definitions of a play.

## Why it matters
Three teams counted a stream three ways and all three were defensible, which made portfolio-level analysis an exercise in reconciliation rather than analysis. Schema enforcement at ingest is unpopular and it is the only thing that actually works — validation downstream just moves the argument later. This is the substrate every measurement item on this roadmap depends on.

## What ships
A single ingest pipeline with schema validation at write time, a registry with review-gated schema evolution, backfill of the two years of history that mattered, and shared canonical definitions for the metrics that were previously contested.

## Who it's for
Every data consumer in the company.

## Target outcome
One definition per core metric and rejection of non-conforming events at ingest. Both achieved; the reconciliation meeting no longer exists.
