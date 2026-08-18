---
id: ADS-005
title: Brand safety and suitability controls
product: Ads Platform
horizon: Now
stage: Committed
owner: Daniel Okonkwo
tags: trust, brand-safety, theme:trust-and-safety
impact: High
effort: Medium
order: 14
visibility: Internal
external_visibility: Internal only
---

# Brand safety and suitability controls

## One-liner
Give advertisers real controls over what their creative can appear against, and give creators visibility into why they were excluded.

## Why it matters
Every serious advertiser conversation reaches brand safety, and our current answer is a blunt instrument that over-blocks. That costs advertisers reach and costs creators revenue simultaneously — a rare case where one fix serves both sides. The episode-level classification from the podcasts side is the input that makes it possible.

## What ships
Advertiser-side inclusion and exclusion by suitability tier, keyword and category controls, pre-campaign reach forecasting that accounts for the exclusions, and post-campaign reporting on where creative actually ran. Consumes the TALK-008 classification rather than building a second classifier.

## Who it's for
Brand advertisers with strict suitability requirements; creators over-blocked by the current model.

## Target outcome
Reduce advertiser-reported suitability incidents while increasing the share of catalogue that is monetisable.

## Open questions
- If our classification and a third-party verifier disagree, whose call governs the buy?
