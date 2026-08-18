import { describe, it, expect } from 'vitest';
import {
  STATUS_COPY,
  PROGRESSION_STEPS,
  conflictMessage,
  validationBlockedMessage,
  progressionStepFor,
  type LifecycleState,
} from './statusCopy';

const ALL_STATES = Object.keys(STATUS_COPY) as LifecycleState[];

// R15: no server/git jargon anywhere in the copy — a user should never see a raw HTTP status,
// a git blob sha, or the "fast-forward" ref-update term. Checked as whole-word-ish substrings
// (case-insensitive) rather than exact tokens, so "422" or "sha" hiding inside a longer string
// still fails the check.
const JARGON = [/\b422\b/i, /\bsha\b/i, /fast-forward/i, /fast forward/i];

function assertNoJargon(text: string) {
  for (const pattern of JARGON) {
    expect(text).not.toMatch(pattern);
  }
}

describe('statusCopy — STATUS_COPY table (U12, R13/R15/KTD7)', () => {
  it('covers every normalized lifecycle state with a non-empty message', () => {
    for (const state of ALL_STATES) {
      expect(STATUS_COPY[state].message.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives every action a non-empty label when present', () => {
    for (const state of ALL_STATES) {
      const action = STATUS_COPY[state].action;
      if (action !== undefined) expect(action.trim().length).toBeGreaterThan(0);
    }
  });

  it('names the single recovery action for every state that has one obvious next step', () => {
    // R15's own vocabulary examples — these states are exactly the ones with one clear,
    // nameable next step (reload, sign back in, view the failing run, or sync).
    expect(STATUS_COPY.reload.action).toBe('Reload');
    expect(STATUS_COPY.conflict.action).toBe('Reload & re-sync');
    expect(STATUS_COPY.authExpired.action).toBe('Sign in again');
    expect(STATUS_COPY.buildFailed.action).toBe('View run');
  });

  it('leaves multi-item/no-single-step states without one action label', () => {
    // Validation errors are grouped per item/field (U5) — there's no ONE fix, so no single
    // action is forced onto the message. Progression states (publishing/building/live/
    // superseded/noBuild) and the plain draft state are informational, not a call to act.
    for (const state of [
      'validationBlocked',
      'publishing',
      'building',
      'live',
      'superseded',
      'noBuild',
      'clean',
    ] as LifecycleState[]) {
      expect(STATUS_COPY[state].action).toBeUndefined();
    }
  });

  it('contains no jargon token (422 / sha / fast-forward) in any message or action', () => {
    for (const state of ALL_STATES) {
      assertNoJargon(STATUS_COPY[state].message);
      if (STATUS_COPY[state].action) assertNoJargon(STATUS_COPY[state].action!);
    }
  });
});

describe('statusCopy — conflictMessage (R2/R13/R15/R16)', () => {
  it('falls back to the generic whole-branch-race sentence when no item is named', () => {
    const msg = conflictMessage('');
    expect(msg).toBe(STATUS_COPY.conflict.message);
    expect(msg.toLowerCase()).toContain('reload');
    expect(msg.toLowerCase()).toContain('re-sync');
  });

  it('names the item(s) when the server reported a per-item conflict', () => {
    const msg = conflictMessage('"Music App Templates"');
    expect(msg).toContain('Music App Templates');
    expect(msg.toLowerCase()).toContain('reload');
    expect(msg.toLowerCase()).toContain('re-sync');
  });

  it('never leaks jargon regardless of the item list supplied', () => {
    assertNoJargon(conflictMessage(''));
    assertNoJargon(conflictMessage('"Music App Templates", "Podcasts & Audiobooks" +2 more'));
  });
});

describe('statusCopy — validationBlockedMessage (R6/R15/R16)', () => {
  it('leads with the plain sentence and keeps the grouped, scannable per-item detail intact', () => {
    const detail = 'Music App Templates: horizon "Sonn" isn\'t a valid horizon, owner is required.';
    const msg = validationBlockedMessage(detail);
    expect(msg).toContain(STATUS_COPY.validationBlocked.message);
    expect(msg).toContain(detail);
  });

  it('never leaks jargon regardless of the detail supplied', () => {
    assertNoJargon(validationBlockedMessage('Music App Templates: title is required.'));
  });
});

describe('statusCopy — progression (R14)', () => {
  it('has exactly the four named steps, in order', () => {
    expect(PROGRESSION_STEPS).toEqual(['Draft', 'Published', 'Building', 'Live']);
  });

  it('maps unsynced/clean to Draft, publishing to Published, building/failed/superseded/no-build to Building, live to Live', () => {
    expect(progressionStepFor('unsynced')).toBe('Draft');
    expect(progressionStepFor('clean')).toBe('Draft');
    expect(progressionStepFor('publishing')).toBe('Published');
    expect(progressionStepFor('building')).toBe('Building');
    expect(progressionStepFor('buildFailed')).toBe('Building');
    expect(progressionStepFor('superseded')).toBe('Building');
    expect(progressionStepFor('noBuild')).toBe('Building');
    expect(progressionStepFor('live')).toBe('Live');
  });

  it('has no progression step for interrupts — the linear story does not apply to them', () => {
    expect(progressionStepFor('reload')).toBeNull();
    expect(progressionStepFor('conflict')).toBeNull();
    expect(progressionStepFor('authExpired')).toBeNull();
    expect(progressionStepFor('validationBlocked')).toBeNull();
  });
});
