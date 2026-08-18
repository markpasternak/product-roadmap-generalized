---
id: MUSIC-006
title: "Daylists: context-aware personalised mixes"
product: Music App
horizon: Next
stage: Committed
owner: Nadia Rahman
tags: personalisation, discovery, theme:ml-personalisation
impact: High
effort: Medium
order: 1
visibility: Public
external_visibility: Customer-safe
---

# Daylists: context-aware personalised mixes

## One-liner
A mix that regenerates several times a day against what you actually listen to at that hour, named in your own listening language.

## Why it matters
Our personalisation is strong at the level of taste and weak at the level of moment — we know what someone likes and not what they want right now. Time-of-day and session-shape signals are the cheapest large improvement available, and the naming turns an algorithmic output into something people quote to each other. It is also the clearest proof that context signals are worth the platform investment behind them.

## What ships
Several regenerations per day driven by a context model, descriptive titles generated from the listener’s own cluster labels rather than a fixed taxonomy, a share card, and a feedback control that adjusts the next generation rather than the current one.

## Who it's for
Listeners with enough history for stable clusters — roughly, anyone past their first month.

## Target outcome
Become a daily habit for a substantial share of active listeners, measured as repeat opens on distinct days rather than total plays.

## Open questions
- How much history is enough before a daylist is more embarrassing than useful?
- Do generated titles need a human-reviewed blocklist, and how large does that get across languages?
