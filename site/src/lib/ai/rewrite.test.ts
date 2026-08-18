import { describe, it, expect, vi } from 'vitest';
import {
  createRewriteConversation,
  appendInstruction,
  appendAssistantTurn,
  messagesFor,
  planStream,
  applyRewrite,
  parseRewritten,
  parsePlanTurn,
  PLAN_SYSTEM_PROMPT,
  APPLY_SYSTEM_PROMPT,
} from './rewrite';
import { AiQuotaError } from './client';

vi.mock('./client', () => ({
  chat: vi.fn(),
  stream: vi.fn(),
  AiQuotaError: class AiQuotaError extends Error {
    constructor(message = "You've reached today's AI usage limit. Please try again later.") {
      super(message);
      this.name = 'AiQuotaError';
    }
  },
  AiUnavailableError: class AiUnavailableError extends Error {
    constructor(message = "AI drafting isn't available right now.") {
      super(message);
      this.name = 'AiUnavailableError';
    }
  },
}));

const CURRENT_BODY = `## One-liner
Let editors bulk-tag items from a multi-select.

## Why it matters
Retagging one at a time is slow.

## What ships
A multi-select and a bulk tag-edit panel.

## Open questions
`;

describe('conversation helpers (KTD5 stable prefix)', () => {
  it('keeps the snapshot identical across appended turns', () => {
    const convo = createRewriteConversation(CURRENT_BODY, { stage: 'Shaping', horizon: 'Next' });
    const withInstruction = appendInstruction(convo, 'Sharpen Why it matters, add a risk.');
    const withReply = appendAssistantTurn(withInstruction, "I'll tighten Why it matters and add a Risks note.");
    const withRefine = appendInstruction(withReply, 'Keep the outcome as-is.');

    expect(withRefine.snapshot).toBe(convo.snapshot);
    expect(withRefine.snapshot).toContain('Let editors bulk-tag items from a multi-select.');
    expect(withRefine.snapshot).toContain('Stage: Shaping');
    expect(withRefine.snapshot).toContain('Horizon: Next');

    // messagesFor always sends the snapshot first, then every turn appended so far.
    const messages = messagesFor(withRefine);
    expect(messages[0]).toEqual({ role: 'user', content: convo.snapshot });
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'Sharpen Why it matters, add a risk.' },
      { role: 'assistant', content: "I'll tighten Why it matters and add a Risks note." },
      { role: 'user', content: 'Keep the outcome as-is.' },
    ]);
  });

  it('never mutates the conversation object passed in', () => {
    const convo = createRewriteConversation(CURRENT_BODY);
    const originalTurns = convo.turns;
    appendInstruction(convo, 'do something');
    expect(convo.turns).toBe(originalTurns);
    expect(convo.turns).toHaveLength(0);
  });
});

describe('planStream (R7, R8)', () => {
  it('streams a PLAN response and writes nothing — the conversation itself is untouched', async () => {
    const { stream } = await import('./client');
    async function* fakePlan() {
      yield "I'll tighten ";
      yield 'Why it matters and ';
      yield 'add a Risks point.';
    }
    vi.mocked(stream).mockReturnValue(fakePlan());

    const convo = appendInstruction(createRewriteConversation(CURRENT_BODY), 'Sharpen Why it matters, add a risk.');

    const deltas: string[] = [];
    for await (const delta of planStream(convo)) deltas.push(delta);

    expect(deltas.join('')).toBe("I'll tighten Why it matters and add a Risks point.");
    expect(vi.mocked(stream)).toHaveBeenCalledWith(messagesFor(convo), { system: PLAN_SYSTEM_PROMPT });
    // Nothing about the conversation changed as a side effect of streaming a plan.
    expect(convo.turns).toHaveLength(1);
  });
});

describe('parsePlanTurn (READY/ASK marker)', () => {
  it('strips a READY marker and reports status ready, with no options', () => {
    const result = parsePlanTurn('READY\n\nI would tighten Why it matters and add a Risks note.');
    expect(result.status).toBe('ready');
    expect(result.text).toBe('I would tighten Why it matters and add a Risks note.');
    expect(result.options).toEqual([]);
  });

  it('strips an ASK marker and reports status ask, with no options when none are offered', () => {
    const result = parsePlanTurn('ASK\n\nWhich risk should I add — technical or scheduling?');
    expect(result.status).toBe('ask');
    expect(result.text).toBe('Which risk should I add — technical or scheduling?');
    expect(result.options).toEqual([]);
  });

  it('defaults to ready when no marker is present at all, with no options', () => {
    const result = parsePlanTurn("I'll tighten Why it matters and add a Risks note.");
    expect(result.status).toBe('ready');
    expect(result.text).toBe("I'll tighten Why it matters and add a Risks note.");
    expect(result.options).toEqual([]);
  });

  it('tolerates a bold-markdown marker (e.g. **READY**) and is case-insensitive', () => {
    const bold = parsePlanTurn('**READY**\n\nI would tighten Why it matters.');
    expect(bold.status).toBe('ready');
    expect(bold.text).toBe('I would tighten Why it matters.');

    const lower = parsePlanTurn('ask\n\nWhat should the tags become?');
    expect(lower.status).toBe('ask');
    expect(lower.text).toBe('What should the tags become?');
  });

  it('parses an OPTIONS: block on an ASK turn into a trimmed options list, stripped from text', () => {
    const result = parsePlanTurn(
      'ASK\n\nWhich risk should I add?\n\nOPTIONS:\n- Technical risk (integration complexity)\n- Scheduling risk (depends on another team)\n- Both',
    );
    expect(result.status).toBe('ask');
    expect(result.text).toBe('Which risk should I add?');
    expect(result.options).toEqual([
      'Technical risk (integration complexity)',
      'Scheduling risk (depends on another team)',
      'Both',
    ]);
  });

  it('a READY turn never has options, even if the text happens to contain an OPTIONS: line', () => {
    const result = parsePlanTurn('READY\n\nPlan mentions OPTIONS:\n- not a real option list');
    expect(result.status).toBe('ready');
    expect(result.options).toEqual([]);
  });

  describe('prose "Option N:" fallback (chips even when the model skips OPTIONS:)', () => {
    it('turns 2+ prose "Option N:" headers into pickable options and flips status to ask', () => {
      const result = parsePlanTurn(
        'READY\n\nHere are three directions.\n\nOption 1: Onboarding checklist\nA guided checklist.\n\nOption 2: Empty-state coach\nInline hints.\n\nOption 3: Item Templates Library\nPre-built templates.\n\nLet me know which one to apply.',
      );
      expect(result.status).toBe('ask'); // a choice is an ask, even when the model marked it READY
      expect(result.options).toEqual(['Onboarding checklist', 'Empty-state coach', 'Item Templates Library']);
    });

    it('strips bold and keeps an em-dash inside the label', () => {
      const result = parsePlanTurn(
        'Some intro.\n\n**Option 1: Quick fix**\nx\n\n**Option 2: New Feature — Item Templates Library**\ny',
      );
      expect(result.status).toBe('ask');
      expect(result.options).toEqual(['Quick fix', 'New Feature — Item Templates Library']);
    });

    it('does NOT fire on a single "Option 1:" mention (needs 2+)', () => {
      const result = parsePlanTurn('READY\n\nOption 1: do the thing and ship it.');
      expect(result.status).toBe('ready');
      expect(result.options).toEqual([]);
    });

    it('a structured OPTIONS: block still wins over prose scanning', () => {
      const result = parsePlanTurn('ASK\n\nWhich risk?\n\nOPTIONS:\n- Technical\n- Scheduling');
      expect(result.options).toEqual(['Technical', 'Scheduling']);
    });
  });
});

describe('parseRewritten (R9, KTD1 tolerant parse)', () => {
  it('preserves the exact section set (same headings, same order) as the current body', () => {
    const rewritten = `## One-liner
Let editors bulk-tag items from a multi-select on the board.

## Why it matters
Retagging items one at a time after a taxonomy change is slow and error-prone.

## What ships
A multi-select and a bulk tag-edit panel (add/remove, not just replace).

## Open questions
Should a bulk edit count as one dirty entry or N?
`;
    const { body } = parseRewritten(rewritten, CURRENT_BODY);
    const headings = [...body.matchAll(/^##\s+(.*)$/gm)].map((m) => m[1]);

    expect(headings).toEqual(['One-liner', 'Why it matters', 'What ships', 'Open questions']);
    expect(body).toContain('multi-select on the board');
  });

  it('keeps the ORIGINAL text for a section the AI dropped on Apply', () => {
    // The rewrite omits "What ships" entirely.
    const rewritten = `## One-liner
Updated one-liner.

## Why it matters
Updated reasoning.

## Open questions
Updated open question.
`;
    const { body } = parseRewritten(rewritten, CURRENT_BODY);

    expect(body).toContain('A multi-select and a bulk tag-edit panel.'); // original "What ships" retained
    expect(body).toContain('Updated one-liner.');
    expect(body).toContain('Updated reasoning.');
  });

  it('parses a suggested yaml block into frontmatter, dropping out-of-enum values', () => {
    const rewritten = `\`\`\`yaml
stage: Shaping
horizon: Nowhere
tags: tagging, bulk-actions
\`\`\`
## One-liner
Updated.

## Why it matters
Updated.

## What ships
Updated.

## Open questions
Updated.
`;
    const { frontmatter } = parseRewritten(rewritten, CURRENT_BODY);

    expect(frontmatter.stage).toBe('Shaping');
    expect(frontmatter.horizon).toBeUndefined(); // "Nowhere" isn't a valid horizon
    expect(frontmatter.tags).toBe('tagging, bulk-actions');
  });

  it('degrades gracefully with no yaml block at all', () => {
    const { frontmatter, body } = parseRewritten(CURRENT_BODY, CURRENT_BODY);
    expect(frontmatter).toEqual({});
    expect(body).toContain('## One-liner');
  });
});

describe('applyRewrite (R9, R10)', () => {
  it('calls chat with the APPLY system prompt + the running conversation, then parses the result', async () => {
    const { chat } = await import('./client');
    vi.mocked(chat).mockResolvedValue({
      text: `## One-liner\nUpdated.\n\n## Why it matters\nUpdated.\n\n## What ships\nUpdated.\n\n## Open questions\nUpdated.\n`,
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: 0,
    });

    const convo = appendAssistantTurn(
      appendInstruction(createRewriteConversation(CURRENT_BODY), 'Sharpen it up.'),
      'Plan: I will tighten the prose.',
    );

    const result = await applyRewrite(convo, CURRENT_BODY);

    const sent = vi.mocked(chat).mock.calls[0]![0];
    // Carries the running conversation (snapshot first, then the turns)...
    expect(sent[0]).toEqual({ role: 'user', content: convo.snapshot });
    expect(sent).toEqual(expect.arrayContaining(messagesFor(convo)));
    // ...but MUST end on a user turn, not the assistant PLAN — otherwise the model treats
    // the request as a prefill and continues the plan instead of producing the item.
    expect(sent.at(-1)!.role).toBe('user');
    expect(sent.at(-1)!.content).toMatch(/apply/i);
    expect(vi.mocked(chat).mock.calls[0]![1]).toMatchObject({ system: APPLY_SYSTEM_PROMPT, maxTokens: 4096 });
    expect(result.body).toContain('## One-liner');
    expect(result.body).toContain('Updated.');
  });

  it('ends the request on a user turn even when the conversation ends with the assistant plan', async () => {
    const { chat } = await import('./client');
    vi.mocked(chat).mockResolvedValue({
      text: `## One-liner\nX.\n\n## Why it matters\nY.\n\n## What ships\nZ.\n\n## Open questions\nW.\n`,
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: 0,
    });
    // Conversation ends with an assistant PLAN turn — the exact prefill-trap state.
    const convo = appendAssistantTurn(
      appendInstruction(createRewriteConversation(CURRENT_BODY), 'Shorten Why it matters.'),
      'Plan: collapse the bullets into one paragraph.',
    );
    expect(convo.turns.at(-1)!.role).toBe('assistant');

    await applyRewrite(convo, CURRENT_BODY);

    const sent = vi.mocked(chat).mock.calls[0]![0];
    expect(sent.at(-1)!.role).toBe('user'); // regression guard for the "nothing to apply" root cause
  });

  it('propagates a quota rejection rather than swallowing it', async () => {
    const { chat } = await import('./client');
    vi.mocked(chat).mockRejectedValue(new AiQuotaError());

    const convo = appendInstruction(createRewriteConversation(CURRENT_BODY), 'Sharpen it up.');

    await expect(applyRewrite(convo, CURRENT_BODY)).rejects.toBeInstanceOf(AiQuotaError);
  });
});
