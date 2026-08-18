---
id: MUSIC-009
title: Conversational listening companion
product: Music App
horizon: Later
stage: Discovery
owner: Nadia Rahman
tags: ai, discovery, theme:ml-personalisation
impact: High
effort: High
order: 1
visibility: Internal
external_visibility: Internal only
---

# Conversational listening companion

## One-liner
Ask for what you want in your own words and get a queue, not a search results page.

## Why it matters
Every discovery surface we have requires the listener to already know the shape of what they want — an artist, a genre, a mood chip we defined. Natural language removes that constraint and would let people ask for things our taxonomy cannot express. The strategic question is whether this is a feature inside the app or eventually the primary way people navigate it, and we should find that out before someone else does.

## What ships
Not yet defined. The discovery work is a prototype good enough to put in front of listeners, an honest read on whether intent-to-queue beats our existing surfaces on the same listener, and a cost-per-request model that does not assume inference prices keep falling.

## Who it's for
Unclear, and that is the main thing to learn. The hypothesis is listeners who currently churn out of a session without playing anything.

## Target outcome
A go/no-go decision backed by a real prototype and a defensible cost model, not a demo.

## Open questions
- Does this cannibalise the surfaces that currently work, and do we care if the session outcome is better?
- What is the failure mode when it confidently returns the wrong artist — and how much worse is that than an empty search?
- Does it run on-device (see PLATFORM-009) or in the serving path, and does that choice change the product?
