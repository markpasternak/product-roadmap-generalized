import { describe, it, expect, afterEach, vi } from 'vitest';
import { draftItem, parseDraft } from './draftItem';
import { AiQuotaError } from './client';
import type { Canvasdrop } from '../share/canvasdrop';

afterEach(() => {
  delete (globalThis as any).canvasdrop;
  vi.restoreAllMocks();
});

function stubCanvasdrop(ai: Partial<NonNullable<Canvasdrop['ai']>>): void {
  (globalThis as any).canvasdrop = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: {}, ai };
}

const WELL_FORMED = `\`\`\`yaml
title: Bulk item tagging
stage: Shaping
horizon: Next
tags: tagging, bulk-actions, board
\`\`\`
## One-liner
Let editors tag many items at once from a multi-select.

## Why it matters
Retagging items one at a time after a taxonomy change is slow and error-prone.

## Target outcome
An editor can select N items and apply/remove tags in one action.

## What ships
- Multi-select on the board.
- A bulk tag-edit panel (add/remove, not just replace).

## Who it's for
Editors maintaining tag hygiene across a large board.

## Acceptance criteria
- Selecting 10 items and adding a tag updates all 10 in the working copy.
- Removing a tag from a subset doesn't touch untouched items.

## Open questions
Should bulk edits count as one dirty-count entry or N?
`;

describe('parseDraft', () => {
  it('parses a well-formed draft into title, suggested metadata, and the full section body', () => {
    const draft = parseDraft(WELL_FORMED);

    expect(draft.title).toBe('Bulk item tagging');
    expect(draft.frontmatter).toEqual({ stage: 'Shaping', horizon: 'Next', tags: 'tagging, bulk-actions, board' });
    for (const heading of [
      '## One-liner',
      '## Why it matters',
      '## Target outcome',
      '## What ships',
      "## Who it's for",
      '## Acceptance criteria',
      '## Open questions',
    ]) {
      expect(draft.body).toContain(heading);
    }
    expect(draft.body).toContain('multi-select');
  });

  it('tolerantly parses a draft missing an optional section and some yaml keys', () => {
    const partial = `\`\`\`yaml
title: Quick draft
\`\`\`
## One-liner
A short draft with no stage/horizon/tags suggested and no Open questions section.

## Why it matters
Still useful even when incomplete.
`;
    const draft = parseDraft(partial);

    expect(draft.title).toBe('Quick draft');
    // horizon is required + has no default, so a missing one is filled with 'Next' to keep the
    // item valid/placeable; stage/tags stay omitted (stage is server-defaulted).
    expect(draft.frontmatter).toEqual({ horizon: 'Next' });
    expect(draft.body).toContain('## One-liner');
    expect(draft.body).toContain('## Why it matters');
    expect(draft.body).not.toContain('## Open questions');
  });

  it('defaults an out-of-enum horizon to Next (never leaves an invalid/unplaceable one)', () => {
    const draft = parseDraft('```yaml\ntitle: Bad horizon\nhorizon: Someday\n```\n## One-liner\nx\n');
    expect(draft.frontmatter.horizon).toBe('Next');
  });

  it('drops an out-of-enum stage suggestion but keeps a valid horizon', () => {
    const draft = parseDraft(`\`\`\`yaml
title: Odd stage draft
stage: Brainstorming
horizon: Now
\`\`\`
## One-liner
Body text.
`);

    expect(draft.frontmatter.stage).toBeUndefined();
    expect(draft.frontmatter.horizon).toBe('Now');
  });

  it('falls back to a generic title and treats the whole response as body when there is no yaml block', () => {
    const draft = parseDraft('## One-liner\nNo yaml block at all here.\n');

    expect(draft.title).toBe('Untitled draft');
    expect(draft.frontmatter).toEqual({ horizon: 'Next' }); // default horizon still applied
    expect(draft.body).toContain('## One-liner');
  });
});

describe('draftItem', () => {
  it('calls chat with the system prompt + maxTokens 4096 and parses the result', async () => {
    const mockChat = vi.fn(
      async (_messages: import('../share/canvasdrop').AiMessage[], _opts: import('../share/canvasdrop').AiChatOptions) => ({
        text: WELL_FORMED,
        usage: { inputTokens: 1, outputTokens: 1 },
        cost: 0,
      }),
    );
    stubCanvasdrop({ chat: mockChat });

    const draft = await draftItem('Let editors bulk-tag items', 'Music App');

    expect(draft.title).toBe('Bulk item tagging');
    expect(mockChat).toHaveBeenCalledTimes(1);
    const [messages, opts] = mockChat.mock.calls[0]!;
    expect(opts.maxTokens).toBe(4096);
    expect(typeof opts.system).toBe('string');
    expect(opts.system!.length).toBeGreaterThan(0);
    expect(messages[0]!.content).toContain('Music App');
    expect(messages[0]!.content).toContain('Let editors bulk-tag items');
  });

  it('propagates AiQuotaError from a quota rejection', async () => {
    const err = new Error('raw quota message');
    err.name = 'QuotaExceededError';
    stubCanvasdrop({ chat: vi.fn(async () => { throw err; }) });

    await expect(draftItem('anything', 'Spotify for Artists')).rejects.toBeInstanceOf(AiQuotaError);
  });
});
