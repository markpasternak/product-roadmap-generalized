---
id: PLATFORM-005
title: Content metadata graph
product: Core Platform & Data
horizon: Now
stage: Committed
owner: Priya Venkatesan
tags: metadata, catalogue, theme:spoken-word
impact: High
effort: High
order: 15
visibility: Internal
external_visibility: Internal only
---

# Content metadata graph

## One-liner
One graph describing every piece of content and how it relates, across music, podcasts and audiobooks.

## Why it matters
Each format has its own catalogue model, which is why cross-format ranking is currently three rankers stitched together and why an artist who also hosts a podcast is two unrelated entities. A shared graph is what makes Unified Home a ranking problem rather than an integration problem. It is the least visible item on this roadmap and probably the highest-leverage one.

## What ships
A unified content graph with format-agnostic entities and typed relationships, one identifier space across formats, a resolution service, and migration of music and podcast catalogues with audiobooks following.

## Who it's for
Every ranking, search and discovery surface.

## Target outcome
Music and podcast catalogues fully resolved into the graph, with Unified Home ranking reading from it rather than from per-format stores.

## Open questions
- Does the creator console's show model (TALK-004) live in the graph or map onto it? Owning it here is cleaner and slower.
- What is the migration story for the long tail of catalogue with poor metadata — fix, or represent honestly as unknown?
