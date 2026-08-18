// U12 (R13-R16, KTD7): the ONE place lifecycle-status copy lives. `Board.vue`'s
// precedence-ordered status machine (`bannerState`) picks exactly one `LifecycleState` to
// show at a time; both the sticky edit banner and `SyncBar` render from this table instead
// of each carrying their own (previously drifting) hardcoded strings. Every message is a
// plain sentence — no server/git jargon (no `422`, `sha`, "fast-forward") — and pairs with
// at most one recovery `action`, per R15.
//
// KTD7 normalizes the state names surfaced to the user. The internal identifiers below stay
// close to the code that predates this unit (so `Board.vue`'s existing `data-test` hooks and
// tests keep working), but each maps onto exactly one of the normalized names:
//   clean         → Draft
//   unsynced      → Unsynced
//   publishing    → Publishing
//   building      → Building
//   live          → Live
//   conflict      → Conflict
//   buildFailed   → Build-failed
//   authExpired   → Session-expired
// `validationBlocked`, `superseded`, `noBuild`, and `reload` are additional, clearly-named
// interrupts/sub-states within that same set (R13) — a stale/failed/awaiting-build deploy is
// still legible as a distinct thing without needing a ninth top-level name, and `reload`
// covers an orthogonal concern (a newer published build than this tab has loaded).
export type LifecycleState =
  | 'reload'
  | 'conflict'
  | 'authExpired'
  | 'validationBlocked'
  | 'publishing'
  | 'building'
  | 'live'
  | 'buildFailed'
  | 'superseded'
  | 'noBuild'
  | 'unsynced'
  | 'clean';

export interface StatusCopy {
  /** Plain sentence: what's happening, in one place, no jargon. */
  message: string;
  /** The single recovery action, when there is one obvious next step. */
  action?: string;
}

// Static copy for every state whose message doesn't need to name a specific item or field —
// those two (conflict, validationBlocked) are dynamic and built by the functions below, but
// still assembled from a single template each, not scattered across components.
export const STATUS_COPY: Record<LifecycleState, StatusCopy> = {
  reload: { message: 'A newer published version is live.', action: 'Reload' },
  conflict: {
    message: 'Someone else published in the meantime — reload to get their changes, then re-sync.',
    action: 'Reload & re-sync',
  },
  authExpired: {
    message: 'Your session expired — sign in again to publish. Your changes are saved.',
    action: 'Sign in again',
  },
  validationBlocked: { message: 'Fix these before publishing.' },
  publishing: { message: 'Publishing… changes go live in about a minute.' },
  building: { message: 'Building… changes go live in about a minute.' },
  live: { message: 'Live — your changes are published.' },
  buildFailed: { message: "Publish didn't build.", action: 'View run' },
  superseded: { message: 'Superseded — waiting on a newer build.' },
  noBuild: { message: 'Published — no build was triggered for this change.' },
  unsynced: { message: 'Your edits are saved on this device — not live yet.', action: 'Sync' },
  clean: { message: "You're editing — nothing to publish yet." },
};

/** R2/R16: names the item(s) a per-item base-version conflict was caught on, when the server
 * named any — falls back to `STATUS_COPY.conflict`'s generic sentence for the additive
 * whole-branch fast-forward race (KTD2), which has no per-item id to name. `itemsList` is
 * the already-formatted (capped, quoted) list of item names — this only supplies the
 * surrounding sentence, so the list-building/capping logic stays in one place (Board.vue's
 * `capList`), not duplicated here. */
export function conflictMessage(itemsList: string): string {
  if (!itemsList) return STATUS_COPY.conflict.message;
  return `Someone updated ${itemsList} — reload to pull their changes, then re-sync.`;
}

/** R6/R15/R16: validation errors stay grouped and scannable (per-item, per-field) rather
 * than a wall of text or one vague sentence — `detail` is that already-grouped summary
 * (Board's `formatValidationErrors`). This just supplies the one-line lead-in so every
 * validation block reads as "fix these, here's exactly what" instead of a bare list. */
export function validationBlockedMessage(detail: string): string {
  return `${STATUS_COPY.validationBlocked.message} ${detail}`;
}

/** R14: the small draft → published → building → live progression's steps, in order. */
export const PROGRESSION_STEPS = ['Draft', 'Published', 'Building', 'Live'] as const;
export type ProgressionStep = (typeof PROGRESSION_STEPS)[number];

/** Maps a `LifecycleState` onto the progression step it reads as "currently at" — `null`
 * when the state is an interrupt the linear draft→published→building→live story doesn't
 * apply to (a conflict, a dead session, a validation block, or a fresher build waiting):
 * showing a progression dot next to those would imply progress that isn't happening. A
 * failed/superseded/no-build deploy still reads as "stalled at building," not a phantom
 * fifth step or a reset back to draft — the primary status text carries the actual detail. */
export function progressionStepFor(state: LifecycleState): ProgressionStep | null {
  switch (state) {
    case 'unsynced':
    case 'clean':
      return 'Draft';
    case 'publishing':
      return 'Published';
    case 'building':
    case 'buildFailed':
    case 'superseded':
    case 'noBuild':
      return 'Building';
    case 'live':
      return 'Live';
    default:
      return null;
  }
}
