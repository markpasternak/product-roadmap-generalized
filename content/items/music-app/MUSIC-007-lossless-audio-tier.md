---
id: MUSIC-007
title: Lossless audio tier
product: Music App
horizon: Next
stage: Shaping
owner: Erik Lindqvist
tags: audio-quality, premium
impact: Medium
effort: High
order: 6
visibility: Internal
external_visibility: Internal only
---

# Lossless audio tier

## One-liner
Bit-perfect streaming for listeners who will pay for it, without regressing the experience for everyone who will not.

## Why it matters
Lossless is a well-understood competitive gap and a weak growth driver on its own — the honest case for it is retention among high-value subscribers and credibility with artists, not new subscriptions. It is worth doing only if it does not tax the shared playback path, which is the actual engineering problem. The cost side is real and dominated by egress rather than storage.

## What ships
A lossless codec path that branches late in the pipeline, device and output-chain capability detection with an honest indicator of what is actually being delivered, per-network delivery policy, and a cost model that holds at scale before we commit to a price.

## Who it's for
High-intent subscribers on capable hardware; secondarily artists and labels who read audio quality as a signal of seriousness.

## Target outcome
Ship without a measurable regression to standard-tier playback, at a marginal cost per lossless hour that survives contact with the finance model.

## Open questions
- Bundled into the existing premium tier or priced as an add-on? This is a pricing decision, not an engineering one, and it is not ours alone.
- How do we show "you are not actually getting lossless right now" without it reading as a broken product?
