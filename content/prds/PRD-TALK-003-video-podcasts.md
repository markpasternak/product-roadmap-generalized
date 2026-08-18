---
id: PRD-TALK-003
roadmap_item: TALK-003
title: Video podcasts on every surface
owner: Kwame Mensah
status: In review
visibility: Internal
updated: 2026-08-04
---

# PRD: Video podcasts on every surface

## Problem
The largest shows are filmed by default and distribute where video plays well.
We are audio-only for those shows, which makes us a secondary destination for our
own biggest creators — and audiences follow creators, not catalogues. Meanwhile
roughly half of podcast listening happens in contexts where a screen is unusable,
so video cannot become a requirement for consuming a show.

## Who it's for
Video-first creators and the audiences following them. Existing audio-only
listeners are a constraint, not an audience: they must see no regression.

## In scope
- A video path through the existing playback pipeline.
- Context-driven audio-only fallback — not a user-set preference.
- Picture-in-picture and background audio continuity.
- TV and automotive surfaces.
- Creator upload with per-episode video controls.

## Out of scope
- Video for music content.
- Live video. See TALK-011, parked.
- A separate video recommendation surface; video episodes rank inside the
  existing podcast and Home surfaces.

## Experience
A filmed show plays as video when a screen is present and being looked at, and as
audio the moment it is not — locking the phone, starting to drive, switching to a
speaker. The transition is silent and preserves position. A creator uploads once.

## Constraints
- Audio-only listening hours for a given show must not fall after video launch.
  This is a launch gate, not a metric to watch.
- Mobile data consumption needs a defensible default; auto-fallback policy is
  the main lever and is deliberately not user-configurable at launch.
- Ad inventory in the video path is owned by ADS-003 and must not block this.

## Evidence
Filmed shows on our platform already show a meaningfully higher share of listening
originating from surfaces where a screen is present, despite us serving them as
audio. Creator interviews consistently name distribution parity — not tooling —
as the reason for publishing elsewhere first.

## Success
Video-native distribution for the top filmed shows, with audio-only hours for
those same shows flat or up.

## Open decisions
- Whether a video episode needs its own settlement accounting or inherits the
  audio model.
- Fallback aggressiveness: too eager reads as unsupported to creators, too
  reluctant burns mobile data.
