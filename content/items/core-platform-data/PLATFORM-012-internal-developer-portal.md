---
id: PLATFORM-012
title: Internal developer portal
product: Core Platform & Data
horizon: Candidates
stage: Discovery
owner: Unassigned
tags: developer-experience, tooling
impact: Medium
effort: Medium
order: 5
visibility: Internal
external_visibility: Internal only
---

# Internal developer portal

## One-liner
One place to find a service, its owner, its API and how to run it locally.

## Why it matters
Service discovery currently happens by asking someone, which scales badly and is the most common thing new engineers cite as slowing them down. A portal is a well-understood fix with a well-understood failure mode — it goes stale within two quarters unless it is generated rather than written. In intake because the real question is whether we would sustain it, not whether we could build it.

## What ships
Nothing yet.

## Who it's for
Every engineer, disproportionately new ones.

## Target outcome
Decide whether we can generate enough of it from existing sources to survive without manual upkeep.

## Open questions
- What fraction can be generated from service manifests and CI metadata rather than hand-written?
