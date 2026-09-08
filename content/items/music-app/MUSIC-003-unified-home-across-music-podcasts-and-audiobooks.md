---
id: MUSIC-003
title: Unified Home across music, podcasts and audiobooks
product: Music App
horizon: Now
startDate: 2026-08-17
endDate: 2026-10-30
stage: Building
owner: Nadia Rahman
tags: discovery, home, theme:spoken-word, theme:ml-personalisation
impact: High
effort: High
order: 1
visibility: Public
external_visibility: Customer-safe
---

# Unified Home across music, podcasts and audiobooks

## One-liner
One ranked home surface that mixes music, podcasts and audiobooks instead of three parallel shelves.

## Why it matters
Spoken word is now a large share of listening hours but still lives in a separate tab, which means the only people who find it are the people already looking for it. Every format competing for the same slot forces the ranker to make an honest call about what a listener actually wants at 8am on a Tuesday, and it lets a strong audiobook beat a weak playlist. It also removes the structural reason each format team optimises its own silo.

## What ships
A single ranked feed backed by one cross-format candidate generator, per-format quotas that decay as the model earns confidence, a context signal (time, device, recent session shape) feeding ranking, and a shelf-level explanation string on every row. Ships to a holdback-controlled 25% before general rollout.
test
## Who it's for
All listeners, with the largest expected shift among music-only listeners who have never opened the podcasts tab.

## Target outcome
Grow cross-format listeners without cannibalising music hours. The bar is a net increase in total listening hours per weekly active listener, not a redistribution of them.

## Open questions
- How hard should the per-format quotas be in the first 90 days, and when do we hand full control to the ranker?
- Does a long-form audiobook row need different dwell accounting than a three-minute track, or does hours-listened normalise it well enough?
- Do we need an explicit "less spoken word" control, or is implicit feedback sufficient?

## Links
- PRD: prds/PRD-MUSIC-003-unified-home.md
