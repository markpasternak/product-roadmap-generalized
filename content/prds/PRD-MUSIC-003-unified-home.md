---
id: PRD-MUSIC-003
roadmap_item: MUSIC-003
title: Unified Home across music, podcasts and audiobooks
owner: Nadia Rahman
status: Approved
visibility: Internal
updated: 2026-07-28
---

# PRD: Unified Home across music, podcasts and audiobooks

## Problem
Home is three parallel shelves — music, podcasts, audiobooks — each ranked by a
different team against a different objective. A listener who has never opened the
podcasts tab will never see a podcast on Home, no matter how well it would serve
them, because no surface is allowed to make that trade. The structure encodes an
assumption about what people want that we have never tested.

## Who it's for
All listeners. The measurable shift is expected among the large group whose
listening is currently single-format, and the risk sits with heavy music
listeners who could experience the change as dilution.

## In scope
- One ranked feed with a single cross-format candidate generator.
- Per-format quotas, decaying as the ranker earns confidence.
- Context signals: time of day, device class, recent session shape.
- A shelf-level explanation string on every row.
- A holdback-controlled rollout at 25% before any wider release.

## Out of scope
- Changes to per-format detail surfaces. Only Home changes.
- Search ranking. It shares the candidate generator but not this rollout.
- Any change to how listening hours are attributed for settlement.

## Experience
Home reads as one editorial surface rather than three stacked ones. A row is
present because it earned the slot, and the explanation says so in plain language
— "because you finished the last episode", not "recommended for you". Format is
a property of a row, never a section header.

## Constraints
- Ranking latency budget is inherited from the existing Home surface; the feature
  store (PLATFORM-003) must serve inside it or this cannot ship.
- Cross-format entity resolution depends on the content metadata graph
  (PLATFORM-005). Music and podcasts must be resolved before general rollout;
  audiobooks may follow.
- Spoken-word rows must not distort hours-listened accounting used in creator
  payouts.

## Evidence
The single-format cohort is large and has been stable for six quarters, which is
not what genuine format preference looks like — it is what a navigation barrier
looks like. Manual curation tests that placed one strong podcast row on Home for
music-only listeners produced cross-format conversion well above the tab-entry
baseline, without reducing music hours in the same session.

## Success
A net increase in total listening hours per weekly active listener. A
redistribution of existing hours between formats, with no net gain, is a failure
regardless of how good the cross-format numbers look on their own.

## Open decisions
- Quota hardness in the first 90 days, and the trigger for handing the ranker
  full control.
- Dwell accounting for long-form rows against short-form ones.
- Whether an explicit "less spoken word" control ships with the rollout or waits
  for evidence that implicit feedback is insufficient.
