---
id: PLATFORM-004
title: Household and shared-plan model
product: Core Platform & Data
horizon: Now
stage: Building
owner: Mei-Lin Chen
tags: identity, plans, theme:one-account
impact: High
effort: Medium
order: 10
visibility: Internal
external_visibility: Internal only
---

# Household and shared-plan model

## One-liner
A first-class household object so shared plans stop being modelled as a bag of loosely related accounts.

## Why it matters
Shared plans are a large share of subscribers and are represented as a billing relationship with no product meaning, so every feature that should understand a household — recommendations, audiobook allowances, frequency capping, parental controls — reimplements a guess. Making the household a real object turns a recurring workaround into a shared capability. It is also the precondition for the family-safety work we keep deferring.

## What ships
A household entity in the identity service with membership lifecycle, per-member entitlement derivation, household-aware allowance accounting for audiobooks, and a documented API that the ads frequency service and the personalisation stack can both read.

## Who it's for
Shared-plan subscribers; internally, every team currently guessing at household boundaries.

## Target outcome
One household model in production with at least three consuming systems retiring their local workaround.

## Open questions
- How far does a household member's taste profile bleed into another's recommendations, and is that a setting or a default?
- Does household membership survive a plan owner leaving, and who inherits?
