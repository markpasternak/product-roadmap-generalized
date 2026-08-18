---
id: ARTISTS-002
title: Team roles and label seat management
product: Spotify for Artists
horizon: Completed
stage: Shipped
owner: Mei-Lin Chen
tags: permissions, accounts, theme:one-account
impact: Medium
effort: Medium
order: 8
visibility: Internal
external_visibility: Customer-safe
---

# Team roles and label seat management

## One-liner
Scoped roles so a label can grant access to the right people for the right artists without sharing one login.

## Why it matters
Credential sharing was the norm because the alternative did not exist, which meant we had no reliable idea who was acting on an artist's behalf and no way to revoke access when a manager changed. That is a security problem and, more practically, it blocked every feature that needed to know who was doing something — payouts, promotion spend, catalogue changes. This was the unlock.

## What ships
Named roles with scoped permissions, per-artist and per-catalogue grants, an audit trail on every privileged action, invitation and revocation flows built on the consolidated identity service, and a migration path off shared credentials.

## Who it's for
Labels, management teams and distributors operating across many artists.

## Target outcome
Move the large majority of multi-artist accounts off shared credentials, with a full audit trail behind privileged actions. Both delivered.
