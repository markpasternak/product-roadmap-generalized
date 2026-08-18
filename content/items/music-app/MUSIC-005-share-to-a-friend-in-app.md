---
id: MUSIC-005
title: Share to a friend, in-app
product: Music App
horizon: Now
stage: Pilot
owner: Aoife Byrne
tags: social, sharing
impact: Medium
effort: Medium
order: 11
visibility: Public
external_visibility: Customer-safe
---

# Share to a friend, in-app

## One-liner
Send a track, episode or playlist to another listener and talk about it without leaving the app.

## Why it matters
A large share of sharing already happens through us — it just exits to a messaging app and never comes back, so we see the send and never the listen. Keeping the conversation in-app closes that loop, gives recommendations a human sender instead of an algorithm, and creates the first place where a listener sees something because a person they trust chose it. The risk is obvious and worth naming: an inbox is a moderation surface.

## What ships
A direct-send inbox with lightweight threaded replies, listen-state on a received item so the sender can see it landed, per-account controls over who can send, and a report-and-block path wired into the existing trust tooling from day one. Piloting in three markets.

## Who it's for
Listeners who already share regularly, identified from outbound share events.

## Target outcome
A meaningful fraction of shares stay in-app, and received items convert to a full listen at a materially higher rate than an algorithmic recommendation.

## Open questions
- Do we allow free text in a reply, or only reactions? Free text is the better product and a much larger moderation commitment.
- Should an inbox item expire?
