// @vitest-environment jsdom
//
// Runs under jsdom (see renderMarkdown.test.ts's file header for why) — this suite
// exercises the real `renderMarkdown()`/DOMPurify sanitization path on hostile AI
// output, which happy-dom (the suite-wide default) doesn't reliably prune.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import RewriteWithAi from './RewriteWithAi.vue';

const chatMock = vi.fn();
const streamMock = vi.fn();

// Only the AI transport (`chat`/`stream`) is mocked — `rewrite.ts`'s conversation
// helpers and `parseRewritten` (KTD1's tolerant parse, including the fix #4 "empty
// rewritten body keeps the original" guarantee) run for real, so these tests exercise
// the actual reconciliation/sanitization logic rather than a stand-in for it.
vi.mock('../../lib/ai/client', () => ({
  chat: (...args: unknown[]) => chatMock(...args),
  stream: (...args: unknown[]) => streamMock(...args),
  friendlyAiMessage: (_err: unknown, fallback: string) => fallback,
  AiQuotaError: class AiQuotaError extends Error {},
  AiUnavailableError: class AiUnavailableError extends Error {},
  AiAbortedError: class AiAbortedError extends Error {},
}));

const BODY = `## One-liner
Ship faster.

## Why it matters
Customers churn without it.
`;

const FRONTMATTER = { stage: 'Building', horizon: 'Now', tags: 'growth' };

let wrappers: VueWrapper[] = [];
function mountPanel() {
  const w = mount(RewriteWithAi, { props: { body: BODY, frontmatter: FRONTMATTER }, attachTo: document.body });
  wrappers.push(w);
  return w;
}

/** A stream that never completes — keeps `planning`/`applying` true for the
 * duration of a test without needing to resolve it. */
function neverEndingStream(): AsyncIterable<string> {
  return (async function* () {
    await new Promise<never>(() => {});
  })();
}

afterEach(() => {
  for (const w of wrappers) w.unmount();
  wrappers = [];
  chatMock.mockReset();
  streamMock.mockReset();
  vi.restoreAllMocks();
});

describe('RewriteWithAi', () => {
  it('ignores a stopped stream after another instruction has started', async () => {
    let resume!: () => void;
    streamMock.mockImplementationOnce(() => (async function* () {
      await new Promise<void>((resolve) => resume = resolve);
      yield 'STALE REPLY';
    })());
    streamMock.mockImplementationOnce(neverEndingStream);
    const w = mountPanel();
    await w.get('[data-test="rewrite-instruction"]').setValue('First request');
    await w.get('[data-test="rewrite-send"]').trigger('click');
    await w.get('[data-test="rewrite-stop"]').trigger('click');
    await w.get('[data-test="rewrite-instruction"]').setValue('New request');
    await w.get('[data-test="rewrite-send"]').trigger('click');
    resume();
    await flushPromises();
    expect(w.text()).not.toContain('STALE REPLY');
    expect(w.text()).toContain('New request');
    expect(w.find('[data-test="rewrite-stop"]').exists()).toBe(true);
    expect(streamMock).toHaveBeenCalledTimes(2);
  });

  describe('close/Escape/scrim cancel an in-flight generation instead of blocking (client-side abort)', () => {
    it('Escape cancels a PLAN stream in flight, resets state, and closes', async () => {
      streamMock.mockImplementation(() => neverEndingStream());
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await nextTick();
      expect(w.find('[data-test="rewrite-streaming"]').exists()).toBe(true); // planning === true

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await nextTick();

      expect(w.emitted('close')).toBeTruthy();
      // planning/applying were reset as part of the cancel, not left dangling.
      expect(w.find('[data-test="rewrite-streaming"]').exists()).toBe(false);
      expect(w.find('[data-test="rewrite-stop"]').exists()).toBe(false);
    });

    it('scrim click cancels the blocking APPLY call in flight, resets state, and closes', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield "I'll tighten the one-liner.";
        })(),
      );
      chatMock.mockImplementation(() => new Promise(() => {})); // APPLY never resolves during this test
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises(); // let the PLAN stream finish so a turn exists and Apply is enabled

      await w.find('[data-test="rewrite-apply-inline"]').trigger('click');
      await nextTick();
      expect(w.find('[data-test="rewrite-stop"]').exists()).toBe(true); // applying === true

      await w.find('.rewrite-scrim').trigger('click');
      await nextTick();

      expect(w.emitted('close')).toBeTruthy();
      expect(w.find('[data-test="rewrite-stop"]').exists()).toBe(false);
    });

    it('the header close (X) button cancels planning in flight and closes, rather than being disabled', async () => {
      streamMock.mockImplementation(() => neverEndingStream());
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await nextTick();

      const closeBtn = w.find('[data-test="rewrite-close"]');
      expect((closeBtn.element as HTMLButtonElement).disabled).toBe(false);
      await closeBtn.trigger('click');
      await nextTick();

      expect(w.emitted('close')).toBeTruthy();
    });
  });

  describe('Enter to send', () => {
    it('sends the instruction on Enter (no modifier)', async () => {
      streamMock.mockImplementation(() => neverEndingStream());
      const w = mountPanel();
      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-instruction"]').trigger('keydown', { key: 'Enter' });
      expect(streamMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT send on Shift+Enter — that inserts a newline', async () => {
      streamMock.mockImplementation(() => neverEndingStream());
      const w = mountPanel();
      await w.find('[data-test="rewrite-instruction"]').setValue('line one');
      await w.find('[data-test="rewrite-instruction"]').trigger('keydown', { key: 'Enter', shiftKey: true });
      expect(streamMock).not.toHaveBeenCalled();
    });
  });

  describe('Stop button', () => {
    it('cancels an in-flight PLAN stream, resets state, and keeps the panel open', async () => {
      streamMock.mockImplementation(() => neverEndingStream());
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await nextTick();
      expect(w.find('[data-test="rewrite-stop"]').exists()).toBe(true);

      await w.find('[data-test="rewrite-stop"]').trigger('click');
      await nextTick();

      expect(w.emitted('close')).toBeFalsy(); // panel stays open
      expect(w.find('[data-test="rewrite-stop"]').exists()).toBe(false); // planning reset
      expect(w.find('[data-test="rewrite-streaming"]').exists()).toBe(false);
      // Free to send a fresh instruction immediately.
      expect((w.find('[data-test="rewrite-send"]').element as HTMLButtonElement).disabled).toBe(true); // instruction box was cleared
    });

    it('cancels a blocking APPLY call, resets state, and keeps the panel open', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield "I'll tighten the one-liner.";
        })(),
      );
      chatMock.mockImplementation(() => new Promise(() => {}));
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();

      await w.find('[data-test="rewrite-apply-inline"]').trigger('click');
      await nextTick();
      expect(w.find('[data-test="rewrite-stop"]').exists()).toBe(true);

      await w.find('[data-test="rewrite-stop"]').trigger('click');
      await nextTick();

      expect(w.emitted('close')).toBeFalsy();
      expect(w.find('[data-test="rewrite-stop"]').exists()).toBe(false);
      // The inline Apply affordance is re-enabled (not stuck disabled from a stale
      // "applying" state) since the plan turn it's attached to is still the latest one.
      expect((w.find('[data-test="rewrite-apply-inline"]').element as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('AI output is always sanitized before rendering', () => {
    const HOSTILE = '<img src=x onerror="alert(1)">\n\n[click me](javascript:alert(1))';

    it('a hostile PLAN stream reply renders sanitized in the transcript', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield HOSTILE;
        })(),
      );
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Add a risk note.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await nextTick();

      const turn = w.find('[data-test="rewrite-turn-plan"]');
      expect(turn.exists()).toBe(true);
      expect(turn.html()).not.toContain('onerror');
      expect(turn.html().toLowerCase()).not.toContain('javascript:');
    });

    it('a hostile APPLY diff renders sanitized before/after content', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'Noted.';
        })(),
      );
      chatMock.mockImplementation(async () => ({
        text: `## One-liner\n${HOSTILE}\n\n## Why it matters\nCustomers churn without it.\n`,
      }));
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Punch up the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await w.find('[data-test="rewrite-apply-inline"]').trigger('click');
      await flushPromises();
      await nextTick();

      const diffEntry = w.find('[data-test="rewrite-diff-One-liner"]');
      expect(diffEntry.exists()).toBe(true);
      expect(diffEntry.html()).not.toContain('onerror');
      expect(diffEntry.html().toLowerCase()).not.toContain('javascript:');
    });
  });

  describe('fix #4: an empty rewritten section body keeps the original, not a blank section', () => {
    it('APPLY response with a matching heading but an empty body retains the original section', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'Sure.';
        })(),
      );
      // "Why it matters" comes back with the heading present but nothing under it —
      // the tolerant parse (rewrite.ts's parseRewritten) must keep the ORIGINAL body.
      chatMock.mockImplementation(async () => ({
        text: '## One-liner\nShip dramatically faster.\n\n## Why it matters\n',
      }));
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Punch up the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await w.find('[data-test="rewrite-apply-inline"]').trigger('click');
      await flushPromises();
      await nextTick();

      const whyEntry = w.find('[data-test="rewrite-diff-Why it matters"]');
      expect(whyEntry.exists()).toBe(true);
      // Unchanged (not "Added"/"Changed") — the empty AI body never won over the original.
      expect(whyEntry.find('[data-test="rewrite-diff-status-Why it matters"]').text()).toBe('Unchanged');
      expect(whyEntry.text()).toContain('No changes.');

      const oneLinerEntry = w.find('[data-test="rewrite-diff-One-liner"]');
      expect(oneLinerEntry.text()).toContain('Ship dramatically faster.');
    });
  });

  describe('inline Apply affordance lives on the latest AI plan turn, not a footer button', () => {
    it('no footer Apply button exists — "Apply these changes" is attached beneath the latest AI plan turn', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield "I'll tighten the one-liner.";
        })(),
      );
      const w = mountPanel();

      expect(w.find('[data-test="rewrite-apply"]').exists()).toBe(false); // old footer button is gone
      expect(w.find('[data-test="rewrite-apply-inline"]').exists()).toBe(false); // nothing to apply yet

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();

      const planTurn = w.find('[data-test="rewrite-turn-plan"]');
      expect(planTurn.exists()).toBe(true);
      expect(planTurn.find('[data-test="rewrite-apply-inline"]').exists()).toBe(true);
    });

    it('only the most recent AI plan turn shows the Apply affordance — an older one loses it once a new plan arrives', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield "I'll tighten the one-liner.";
        })(),
      );
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();

      streamMock.mockImplementation(() =>
        (async function* () {
          yield "I'll also add a risk note.";
        })(),
      );
      await w.find('[data-test="rewrite-instruction"]').setValue('Also add a risk.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();

      const planTurns = w.findAll('[data-test="rewrite-turn-plan"]');
      expect(planTurns).toHaveLength(2);
      expect(planTurns[0]!.find('[data-test="rewrite-apply-inline"]').exists()).toBe(false); // older plan — no Apply
      expect(planTurns[1]!.find('[data-test="rewrite-apply-inline"]').exists()).toBe(true); // latest plan — Apply shown
    });
  });

  describe('Fix 1: READY/ASK marker gates the inline Apply affordance', () => {
    it('a READY plan shows the inline Apply button, with the marker stripped from the displayed text', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'READY\n\nI would tighten the one-liner and leave Why it matters as-is.';
        })(),
      );
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();

      const planTurn = w.find('[data-test="rewrite-turn-plan"]');
      expect(planTurn.exists()).toBe(true);
      expect(planTurn.text()).not.toContain('READY');
      expect(planTurn.text()).toContain('I would tighten the one-liner');
      expect(planTurn.find('[data-test="rewrite-apply-inline"]').exists()).toBe(true);
      expect(w.find('[data-test="rewrite-ask-hint"]').exists()).toBe(false);
    });

    it('an ASK plan shows the question with no Apply button, and refocuses the instruction input', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'ASK\n\nWhich risk should I add — technical or scheduling?';
        })(),
      );
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Add a risk.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await nextTick();

      const planTurn = w.find('[data-test="rewrite-turn-plan"]');
      expect(planTurn.exists()).toBe(true);
      expect(planTurn.text()).not.toContain('ASK');
      expect(planTurn.text()).toContain('Which risk should I add');
      expect(planTurn.find('[data-test="rewrite-apply-inline"]').exists()).toBe(false);
      expect(w.find('[data-test="rewrite-ask-hint"]').exists()).toBe(true);

      const instructionEl = w.find('[data-test="rewrite-instruction"]').element as HTMLTextAreaElement;
      expect(document.activeElement).toBe(instructionEl);
    });

    it('strips the marker from the live streaming display too', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'READY\n\nStreaming plan text.';
          await new Promise<never>(() => {}); // never completes — keeps `planning` true
        })(),
      );
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await nextTick();

      const streaming = w.find('[data-test="rewrite-streaming"]');
      expect(streaming.exists()).toBe(true);
      expect(streaming.text()).not.toContain('READY');
      expect(streaming.text()).toContain('Streaming plan text.');
    });

    it('a plan with no marker at all still shows the Apply button (graceful default)', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield "I'll tighten the one-liner.";
        })(),
      );
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Sharpen the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();

      expect(w.find('[data-test="rewrite-apply-inline"]').exists()).toBe(true);
    });

    it('an ASK with OPTIONS renders pickable chips (no Apply button), and clicking one sends it as the next instruction', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'ASK\n\nWhich risk should I add?\n\nOPTIONS:\n- Technical risk\n- Scheduling risk\n- Both';
        })(),
      );
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Add a risk.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await nextTick();

      expect(w.find('[data-test="rewrite-apply-inline"]').exists()).toBe(false);
      const planTurn = w.find('[data-test="rewrite-turn-plan"]');
      expect(planTurn.text()).not.toContain('OPTIONS:');
      expect(planTurn.text()).toContain('Which risk should I add?');

      const chips = w.findAll('[data-test="rewrite-ask-option"]');
      expect(chips.map((c) => c.text())).toEqual(['Technical risk', 'Scheduling risk', 'Both']);
      expect(w.find('[data-test="rewrite-ask-hint"]').text()).toContain('or type your own');

      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'READY\n\nAdding a technical risk note to Open questions.';
        })(),
      );
      await chips[0]!.trigger('click');
      await flushPromises();

      expect(streamMock).toHaveBeenCalledTimes(2);
      const userTurns = w.findAll('[data-test="rewrite-turn-user"]');
      expect(userTurns.at(-1)!.text()).toContain('Technical risk');
      expect(w.find('[data-test="rewrite-apply-inline"]').exists()).toBe(true); // fresh READY plan
    });

    it('every ASK shows an "Apply your best judgment" escape button that forces a rewrite-producing turn', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'ASK\n\nWhich tone should I use?';
        })(),
      );
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Improve the copy.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await nextTick();

      // The escape button is present even when the AI offered no option chips.
      const escape = w.find('[data-test="rewrite-best-judgment"]');
      expect(escape.exists()).toBe(true);
      expect(w.find('[data-test="rewrite-ask-option"]').exists()).toBe(false);

      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'READY\n\nRewrote the copy with a confident, concise tone.';
        })(),
      );
      await escape.trigger('click');
      await flushPromises();

      expect(streamMock).toHaveBeenCalledTimes(2);
      const userTurns = w.findAll('[data-test="rewrite-turn-user"]');
      expect(userTurns.at(-1)!.text()).toContain('do not ask any more questions');
      expect(w.find('[data-test="rewrite-apply-inline"]').exists()).toBe(true); // forced to a READY turn
    });

    it('loop guard: a second consecutive ASK auto-resolves toward apply instead of trapping the editor', async () => {
      // 1st instruction → ASK, 2nd (editor's answer) → ASK again → auto best-judgment → READY.
      streamMock.mockImplementationOnce(() =>
        (async function* () {
          yield 'ASK\n\nQuestion one?';
        })(),
      );
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Do the thing.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await nextTick();

      streamMock
        .mockImplementationOnce(() =>
          (async function* () {
            yield 'ASK\n\nQuestion two?';
          })(),
        )
        .mockImplementationOnce(() =>
          (async function* () {
            yield 'READY\n\nProceeding with a sensible default.';
          })(),
        );

      // Editor answers the first question; the AI asks AGAIN — the guard must break the loop.
      await w.find('[data-test="rewrite-instruction"]').setValue('My answer to one.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await nextTick();
      await flushPromises(); // let the auto-triggered best-judgment turn stream + settle

      // Three streams total: Q1, Q2, then the auto-forced best-judgment turn (READY).
      expect(streamMock).toHaveBeenCalledTimes(3);
      const userTurns = w.findAll('[data-test="rewrite-turn-user"]');
      expect(userTurns.at(-1)!.text()).toContain('do not ask any more questions');
      // Ends on an applyable plan rather than a third stalled question.
      expect(w.find('[data-test="rewrite-apply-inline"]').exists()).toBe(true);
    });
  });

  describe('no-change guard: a no-op APPLY never shows an empty/all-"Unchanged" diff', () => {
    it('stays in chat and appends a clear note instead of switching to diff mode', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield 'Sure, one moment.';
        })(),
      );
      // The APPLY response echoes the body back verbatim — every section comes back
      // identical to the current body, so there's nothing to show a diff for.
      chatMock.mockImplementation(async () => ({ text: BODY }));
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Make it better.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await w.find('[data-test="rewrite-apply-inline"]').trigger('click');
      await flushPromises();
      await nextTick();

      expect(w.find('[data-test="rewrite-diff"]').exists()).toBe(false); // never entered diff mode
      expect(w.find('[data-test="rewrite-transcript"]').exists()).toBe(true); // still in chat

      const note = w.find('[data-test="rewrite-turn-note"]');
      expect(note.exists()).toBe(true);
      expect(note.text()).toContain("didn't end up changing anything");
      expect(note.text()).toContain('try a more specific instruction');

      // The old plan turn no longer shows Apply (the note is now the latest turn) —
      // free to send a fresh, more specific instruction instead.
      expect(w.find('[data-test="rewrite-apply-inline"]').exists()).toBe(false);
    });
  });

  describe('Accept: reports back into the chat and keeps the panel open', () => {
    it('emits accept, returns to chat mode, and appends a "✓ Applied" note naming the changed sections', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield "I'll tighten the one-liner.";
        })(),
      );
      chatMock.mockImplementation(async () => ({
        text: `## One-liner\nShip dramatically faster.\n\n## Why it matters\nCustomers churn without it.\n`,
      }));
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Punch up the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await w.find('[data-test="rewrite-apply-inline"]').trigger('click');
      await flushPromises();
      await nextTick();
      expect(w.find('[data-test="rewrite-diff"]').exists()).toBe(true);

      await w.find('[data-test="rewrite-accept"]').trigger('click');
      await nextTick();

      expect(w.emitted('accept')).toBeTruthy();
      expect(w.emitted('close')).toBeFalsy(); // panel stays open
      expect(w.find('[data-test="rewrite-diff"]').exists()).toBe(false); // back in chat mode

      const note = w.find('[data-test="rewrite-turn-note"]');
      expect(note.exists()).toBe(true);
      expect(note.text()).toContain('Applied');
      expect(note.text()).toContain('One-liner');
    });

    it('"← Back to chat" returns to the conversation without applying anything', async () => {
      streamMock.mockImplementation(() =>
        (async function* () {
          yield "I'll tighten the one-liner.";
        })(),
      );
      chatMock.mockImplementation(async () => ({
        text: `## One-liner\nShip dramatically faster.\n\n## Why it matters\nCustomers churn without it.\n`,
      }));
      const w = mountPanel();

      await w.find('[data-test="rewrite-instruction"]').setValue('Punch up the one-liner.');
      await w.find('[data-test="rewrite-send"]').trigger('click');
      await flushPromises();
      await w.find('[data-test="rewrite-apply-inline"]').trigger('click');
      await flushPromises();
      await nextTick();
      expect(w.find('[data-test="rewrite-diff"]').exists()).toBe(true);

      await w.find('[data-test="rewrite-diff-back"]').trigger('click');
      await nextTick();

      expect(w.emitted('accept')).toBeFalsy();
      expect(w.find('[data-test="rewrite-diff"]').exists()).toBe(false);
      expect(w.find('[data-test="rewrite-transcript"]').exists()).toBe(true);
      // Nothing was applied, but the conversation (and the Apply affordance on the
      // still-latest plan turn) is exactly as it was.
      expect(w.find('[data-test="rewrite-apply-inline"]').exists()).toBe(true);
    });
  });
});
