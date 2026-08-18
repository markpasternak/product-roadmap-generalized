---
id: ADS-002
title: Self-serve Ads Manager rebuild
product: Ads Platform
horizon: Completed
stage: Shipped
owner: Daniel Okonkwo
tags: self-serve, tooling
impact: High
effort: High
order: 9
visibility: Internal
external_visibility: Customer-safe
---

# Self-serve Ads Manager rebuild

## One-liner
Rebuilt campaign creation so a small advertiser can launch without talking to anyone.

## Why it matters
The old tool had a completion rate low enough that it was effectively a lead-generation form for the sales team, which is not a business at small-advertiser scale. The rebuild treated time-to-first-campaign as the primary metric rather than feature coverage, and cutting scope was the main design activity. It is the foundation the self-serve promotion work in Spotify for Artists now builds on.

## What ships
A rebuilt campaign flow with a much shorter path to launch, creative upload with automatic format validation, transparent reach and budget projection before commitment, and a reporting view a non-specialist can read.

## Who it's for
Small and mid-sized advertisers without an agency.

## Target outcome
Substantially improve campaign creation completion and reduce time-to-first-campaign. Both improved beyond target.
