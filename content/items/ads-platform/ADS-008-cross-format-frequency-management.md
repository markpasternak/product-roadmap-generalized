---
id: ADS-008
title: Cross-format frequency management
product: Ads Platform
horizon: Next
stage: Committed
owner: Daniel Okonkwo
tags: delivery, quality, theme:ml-personalisation
impact: Medium
effort: Medium
order: 14
visibility: Internal
external_visibility: Internal only
---

# Cross-format frequency management

## One-liner
One frequency cap across audio, video and display instead of three independent ones.

## Why it matters
A listener can currently hit the same campaign a dozen times a day because each format counts separately, which is bad for the listener, bad for the advertiser paying for the twelfth impression, and a leading driver of ad-load complaints. Unified frequency is a rare change that improves listener experience, advertiser efficiency and our own inventory yield at once.

## What ships
A shared frequency service across all ad formats, advertiser-set caps at campaign and brand level, cap-aware pacing so budget delivers evenly rather than exhausting early, and listener-level ad-load monitoring feeding the experience metrics.

## Who it's for
Listeners first, then advertisers paying for wasted impressions.

## Target outcome
Cut over-frequency exposure sharply while holding total delivered impressions flat.

## Open questions
- Does the frequency service read household identity (PLATFORM-004), or strictly per-profile? Household is more correct and more privacy-sensitive.
