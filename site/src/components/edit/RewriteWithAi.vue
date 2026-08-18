<script setup lang="ts">
// U5 (R6-R10): "Rewrite with AI" — a conversational plan-then-apply panel over the whole
// current item. Presentational + store-agnostic like ItemEditor/SectionEditor: this
// component never touches the edit store. On Accept it EMITs the rewritten
// `{ body, frontmatter }` up; the parent (ItemEditor, then Board.vue) owns the actual
// `setBody`/`setField` writes (see Board.vue's `onEditorBody`/`onEditorField`).
//
// A right side-sheet on desktop, a full-screen takeover on mobile (this site is
// mobile-critical). A11y (focus trap, Escape-to-close, scroll lock) mirrors
// `ShareDialog.vue` + `lib/focusTrap.ts`. All AI text — the chat transcript and the
// before/after diff — renders through the sanitized `renderMarkdown()` (KTD7): never a
// fresh `v-html` on raw AI output.
//
// Redesign: apply is no longer a persistent footer button disconnected from the
// conversation ("I don't understand how to apply"). Instead an "Apply these changes"
// affordance is attached directly beneath the single most-recent AI PLAN turn in the
// transcript (`timeline`, below) — older plan turns never show it again once a newer
// one (or a system note) supersedes them. The APPLY result's before/after diff is a
// clearly-labeled next step of the same conversation (a "← Back to chat" link, not a
// dead end), and both a no-op APPLY ("nothing to apply") and a successful Accept report
// back into the chat as a plain-language note rather than leaving the editor guessing.
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import Button from '../ui/Button.vue';
import { PhX, PhSparkle, PhPaperPlaneTilt, PhCircleNotch, PhCheck, PhArrowCounterClockwise, PhStop, PhCaretLeft } from '@phosphor-icons/vue';
import { trapFocus } from '../../lib/focusTrap';
import { renderMarkdown } from '../../lib/edit/renderMarkdown';
import { parseSections } from '../../lib/edit/sections';
import {
  createRewriteConversation,
  appendInstruction,
  appendAssistantTurn,
  planStream,
  applyRewrite,
  parsePlanTurn,
  type RewriteConversation,
  type RewrittenItem,
} from '../../lib/ai/rewrite';
import { sectionDiff, type SectionDiffEntry, type SectionDiffStatus } from '../../lib/ai/sectionDiff';
import { friendlyAiMessage, AiAbortedError } from '../../lib/ai/client';

const props = defineProps<{
  /** The current full markdown body — the conversation's stable KTD5 snapshot and the
   * baseline `sectionDiff`/tolerant-parse compare against. */
  body: string;
  /** Current stage/horizon/tags, folded into the snapshot and diffed against the AI's
   * suggested metadata on Accept — only CHANGED fields are ever emitted. */
  frontmatter: { stage?: string; horizon?: string; tags?: string };
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'accept', payload: { body: string; frontmatter: Record<string, string> }): void;
}>();

const convo = ref<RewriteConversation>(createRewriteConversation(props.body, props.frontmatter));
const instruction = ref('');
const planning = ref(false);
const applying = ref(false);
const streamingText = ref('');
const error = ref<string | null>(null);

const mode = ref<'chat' | 'diff'>('chat');
const diff = ref<SectionDiffEntry[]>([]);
const pendingResult = ref<RewrittenItem | null>(null);

/** The transcript as rendered in the UI: `convo`'s user/assistant turns (which is what
 * actually gets sent back to the AI as context) PLUS UI-only "note" entries — the
 * no-change guard and the post-Accept confirmation — that are never fed back into
 * `convo`/the AI conversation. Keeping these separate means "the most recent AI turn"
 * (where the inline Apply affordance lives) unambiguously means the most recent PLAN,
 * never a system note reporting on a previous one. */
type TimelineEntry = { kind: 'user' | 'plan' } | { kind: 'note'; noteKind: 'no-change' | 'applied' };
const timeline = ref<Array<TimelineEntry & { content: string }>>([]);

/** Displayed text for a plan turn (or the live streaming reply): the READY/ASK marker
 * line `parsePlanTurn` reads off is never shown to the editor, only the plan/question
 * text after it. */
function planDisplayText(content: string): string {
  return parsePlanTurn(content).text;
}

/** Fix 1: a plan turn is either a concrete proposal (`ready`, applyable) or a clarifying
 * question waiting on the editor (`ask`) — read off the latest plan turn's marker. The
 * inline "Apply these changes" affordance only ever makes sense on a `ready` plan; an
 * `ask` plan means the AI needs an answer before it has anything to apply. `null` when
 * there's no plan turn yet at all (nothing to gate). */
const latestPlanStatus = computed<'ready' | 'ask' | null>(() => {
  for (let i = timeline.value.length - 1; i >= 0; i--) {
    const entry = timeline.value[i]!;
    if (entry.kind === 'plan') return parsePlanTurn(entry.content).status;
  }
  return null;
});

/** The latest `ask` plan's pickable options (AskUserQuestion-style), or `[]` when the
 * latest plan isn't an `ask` or offered none — rendered as chips beneath the question. */
const latestPlanOptions = computed<string[]>(() => {
  for (let i = timeline.value.length - 1; i >= 0; i--) {
    const entry = timeline.value[i]!;
    if (entry.kind === 'plan') return parsePlanTurn(entry.content).options;
  }
  return [];
});

const instructionInput = ref<HTMLTextAreaElement>();

/** The "enough, just do it" escape directive — sent as an ordinary user turn so the next
 * PLAN turn is forced to stop asking and produce something applyable. Used both by the
 * explicit "Apply your best judgment" button (always available on any ASK) and by the
 * automatic loop guard below. */
const BEST_JUDGMENT_DIRECTIVE =
  'Proceed now with your best judgment and produce the rewrite — do not ask any more questions.';

/** Clicking an ASK option answers the question exactly like typing it and pressing Send —
 * it becomes the editor's next instruction, triggering a fresh PLAN turn. Chips are only
 * ever a shortcut for typing, never a different code path. */
function pickOption(option: string) {
  if (planning.value || applying.value) return;
  instruction.value = option;
  void sendInstruction();
}

/** Escape hatch: force the AI to stop asking and produce a rewrite using its best
 * judgment. Same code path as the editor typing the directive and pressing Send. */
function applyBestJudgment() {
  if (planning.value || applying.value) return;
  instruction.value = BEST_JUDGMENT_DIRECTIVE;
  void sendInstruction();
}

/** How many ASK plan turns are in the transcript so far — the loop-guard signal: a second
 * ASK for the same instruction thread (count ≥ 2) must never trap the editor. */
function askTurnCount(): number {
  return timeline.value.filter((e) => e.kind === 'plan' && parsePlanTurn(e.content).status === 'ask').length;
}

function friendlyMessage(err: unknown): string {
  return friendlyAiMessage(err, "Couldn't reach the AI right now. Please try again.");
}

// Client-side cancellation (R: stop button/close-while-in-flight): canvas-drop's
// `ai.chat`/`ai.stream` don't accept an AbortSignal, so we can't abort the underlying
// network call — instead each PLAN stream / APPLY chat gets its own `AbortController`,
// and cancelling means "stop consuming and discard the result" at our wrapper boundary
// (`client.ts`'s `stream`/`chat`), not an actual network abort.
let planController: AbortController | null = null;
let applyController: AbortController | null = null;

/** PLAN turn (R7, R8): streams "what I would change" — nothing is written anywhere. A
 * failed stream rolls back the just-added instruction (rather than leaving a dangling
 * question with no reply) so the editor can simply retry. A cancelled stream (aborted
 * via `stopGeneration`/close-while-planning) rolls back the same way, silently. */
async function sendInstruction() {
  const text = instruction.value.trim();
  if (!text || planning.value || applying.value) return;
  error.value = null;
  convo.value = appendInstruction(convo.value, text);
  timeline.value = [...timeline.value, { kind: 'user', content: text }];
  instruction.value = '';
  planning.value = true;
  streamingText.value = '';
  const controller = new AbortController();
  planController = controller;
  try {
    for await (const delta of planStream(convo.value, { signal: controller.signal })) {
      streamingText.value += delta;
    }
    if (controller.signal.aborted) {
      // Cancelled — discard the partial reply and roll back the instruction so the
      // editor can simply retry, same as a failed stream.
      convo.value = { snapshot: convo.value.snapshot, turns: convo.value.turns.slice(0, -1) };
      timeline.value = timeline.value.slice(0, -1);
    } else {
      convo.value = appendAssistantTurn(convo.value, streamingText.value);
      timeline.value = [...timeline.value, { kind: 'plan', content: streamingText.value }];
      // Fix 1: an `ask` plan has no Apply affordance — send focus back to the
      // instruction box so the editor's next keystroke answers the question, rather
      // than leaving focus stranded with nothing to click.
      if (parsePlanTurn(streamingText.value).status === 'ask') {
        // Loop guard (addendum 2): a SECOND ASK in the same thread (a prior ASK already
        // exists) must not be able to stall the editor — auto-send the best-judgment
        // directive so the next turn is forced to produce something applyable. Deferred to
        // nextTick so it runs after this generation's `finally` clears `planning`.
        if (askTurnCount() >= 2) {
          void nextTick(() => applyBestJudgment());
        } else {
          void nextTick(() => instructionInput.value?.focus());
        }
      }
    }
  } catch (err) {
    if (!(err instanceof AiAbortedError)) error.value = friendlyMessage(err);
    convo.value = { snapshot: convo.value.snapshot, turns: convo.value.turns.slice(0, -1) };
    timeline.value = timeline.value.slice(0, -1);
  } finally {
    planning.value = false;
    streamingText.value = '';
    if (planController === controller) planController = null;
  }
}

/** Apply (R9): a blocking `chat` call — spinner while in flight — then a per-section
 * before/after diff of the tolerant-parsed result against the current body. A cancelled
 * chat throws `AiAbortedError` (client.ts) once it eventually resolves — swallowed here,
 * no error toast, no diff shown.
 *
 * No-change guard: if every section comes back `unchanged` (the AI's tolerant-parsed
 * rewrite is identical to the current body — e.g. it decided nothing needed changing,
 * or echoed the input back), showing an all-"Unchanged" diff reads as "nothing
 * happened, why did I even apply?" — the actual root cause of "it says nothing to
 * apply". Instead stay in chat and append a clear note asking for a more specific
 * instruction, same as a real failure would. */
async function applyChanges() {
  if (applying.value || planning.value || !convo.value.turns.length) return;
  error.value = null;
  applying.value = true;
  const controller = new AbortController();
  applyController = controller;
  try {
    const result = await applyRewrite(convo.value, props.body, { signal: controller.signal });
    const nextDiff = sectionDiff(parseSections(props.body).sections, parseSections(result.body).sections);
    if (nextDiff.every((entry) => entry.status === 'unchanged')) {
      timeline.value = [
        ...timeline.value,
        {
          kind: 'note',
          noteKind: 'no-change',
          content: "I didn't end up changing anything — try a more specific instruction (e.g. name the section and what to change).",
        },
      ];
    } else {
      pendingResult.value = result;
      diff.value = nextDiff;
      mode.value = 'diff';
    }
  } catch (err) {
    if (!(err instanceof AiAbortedError)) error.value = friendlyMessage(err);
  } finally {
    applying.value = false;
    if (applyController === controller) applyController = null;
  }
}

/** Accept (R9): emit the full rewritten body plus only the frontmatter fields that
 * actually differ from the current values — the parent writes `setBody` once and
 * `setField` per changed field. Then return to chat and append a confirmation note
 * naming the sections that changed (the "what happens then" feedback), keeping the
 * panel open so the editor can keep refining or close on their own terms. */
function accept() {
  if (!pendingResult.value) return;
  const cur = props.frontmatter;
  const next = pendingResult.value.frontmatter;
  const changed: Record<string, string> = {};
  if (next.stage !== undefined && next.stage !== (cur.stage ?? '')) changed.stage = next.stage;
  if (next.horizon !== undefined && next.horizon !== (cur.horizon ?? '')) changed.horizon = next.horizon;
  if (next.tags !== undefined && next.tags !== (cur.tags ?? '')) changed.tags = next.tags;
  emit('accept', { body: pendingResult.value.body, frontmatter: changed });

  const changedSections = diff.value.filter((entry) => entry.status !== 'unchanged').map((entry) => entry.key);
  const summary = changedSections.length
    ? `✓ Applied — updated ${changedSections.map((key) => `*${key}*`).join(', ')}.`
    : '✓ Applied.';
  timeline.value = [...timeline.value, { kind: 'note', noteKind: 'applied', content: summary }];

  pendingResult.value = null;
  diff.value = [];
  mode.value = 'chat';
}

/** Back to chat / Discard: drop the proposed rewrite and return to the conversation
 * (which is kept, so the editor can keep refining) rather than closing the whole
 * panel. Used by both the diff step's "← Back to chat" link and its "Discard" button —
 * there's no meaningful difference between "I changed my mind" and "let me keep
 * talking", so both just return to the same live conversation. */
function backToChat() {
  pendingResult.value = null;
  diff.value = [];
  mode.value = 'chat';
}

function diffStatusLabel(status: SectionDiffStatus): string {
  return ({ added: 'Added', changed: 'Changed', unchanged: 'Unchanged' } satisfies Record<SectionDiffStatus, string>)[status];
}
function diffBadgeClass(status: SectionDiffStatus): string {
  return ({
    added: 'bg-surface-transparent-green-25',
    changed: 'bg-surface-transparent-orange-25',
    unchanged: 'bg-surface-transparent-blue-25',
  } satisfies Record<SectionDiffStatus, string>)[status];
}
function noteBubbleClass(noteKind: 'no-change' | 'applied'): string {
  return noteKind === 'applied' ? 'bg-surface-transparent-green-25' : 'bg-surface-transparent-orange-25';
}

/** Aborts whatever's in flight (PLAN stream and/or APPLY chat — only one is ever
 * running at a time, but abort both defensively) and resets to an idle state. Used by
 * close/Escape/scrim (which then also emit('close')) and by the "Stop" button (which
 * doesn't — it just cancels and leaves the panel open). */
function abortInFlight() {
  planController?.abort();
  applyController?.abort();
  planController = null;
  applyController = null;
  planning.value = false;
  applying.value = false;
  streamingText.value = '';
}

/** Stop button (visible while planning/applying): cancels the current generation but
 * keeps the panel open, so the editor can immediately try a different instruction. */
function stopGeneration() {
  abortInFlight();
}

// A11y: Escape to close, scrim click to close, and the header close (X) button — none
// of these are blocked while planning/applying anymore (that trapped the user with no
// way out, since canvas-drop's ai.chat/ai.stream have no server-side abort param).
// Instead, closing while a generation is in flight cancels it first (client-side only —
// see abortInFlight/client.ts) and then closes. A focus trap is scoped to this panel.
// No scroll-lock here — this panel only ever opens from inside `ItemEditor`, which
// already locks `document.body` scroll for as long as it's mounted; re-locking/unlocking
// here (this panel is teleported to `<body>`, a sibling of ItemEditor's own DOM, but
// still opens and closes while ItemEditor stays mounted) would otherwise re-enable
// background scroll the moment this panel closes, out from under the still-open item
// editor.
const panel = ref<HTMLElement>();
let release: (() => void) | null = null;
function closePanel() {
  if (planning.value || applying.value) abortInFlight();
  emit('close');
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closePanel();
}
function onScrimClick() {
  closePanel();
}
onMounted(async () => {
  document.addEventListener('keydown', onKey);
  await nextTick();
  if (panel.value) release = trapFocus(panel.value);
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  release?.();
  planController?.abort();
  applyController?.abort();
});

const primaryCls = 'bg-accent-brand-default hover:bg-accent-brand-hover active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none';
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end">
    <div class="rewrite-scrim bg-surface-transparent-black-50 absolute inset-0" @click="onScrimClick" />
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      aria-label="Rewrite with AI"
      tabindex="-1"
      data-test="rewrite-panel"
      class="rewrite-panel bg-background border-border-subtle-default relative z-10 flex h-full w-full flex-col border-l shadow-xl outline-none sm:w-[460px] sm:max-w-[92vw]"
    >
      <header class="border-border-subtle-default flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
        <div class="flex items-center gap-2">
          <PhSparkle :size="18" class="text-[color:var(--color-accent-brand-default)]" />
          <div>
            <p class="roadmap-label">Rewrite with AI</p>
            <p class="text-single-sm-medium text-text-subtle-default mt-1" data-test="rewrite-arc">
              <span :class="{ 'text-text-primary-default font-semibold': mode === 'chat' }">Describe a change</span>
              <span aria-hidden="true"> → </span>
              <span :class="{ 'text-text-primary-default font-semibold': mode === 'diff' }">review</span>
              <span aria-hidden="true"> → </span>
              <span>apply</span>.
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          data-test="rewrite-close"
          class="text-icons-subtle-default hover:text-text-primary-default -mr-1.5 -mt-1 grid size-9 shrink-0 place-items-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-40"
          @click="closePanel"
        >
          <PhX :size="18" />
        </button>
      </header>

      <!-- CHAT (PLAN) MODE -->
      <template v-if="mode === 'chat'">
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4" data-test="rewrite-transcript">
          <p v-if="!timeline.length && !planning" class="text-single-sm-medium text-text-subtle-default">
            Give an instruction — e.g. "Sharpen Why it matters, and add a risk to Open questions."
          </p>
          <div v-for="(entry, i) in timeline" :key="i" :data-test="`rewrite-turn-${entry.kind}`" :class="entry.kind === 'user' ? 'ml-6' : 'mr-6'">
            <p v-if="entry.kind === 'user' || entry.kind === 'plan'" class="text-single-sm-medium text-text-subtle-default mb-1 font-semibold">
              {{ entry.kind === 'user' ? 'You' : 'AI plan' }}
            </p>
            <div
              v-if="entry.kind === 'user'"
              class="roadmap-prose bg-card/70 border-border-subtle-default text-single-sm-medium rounded-lg border px-3 py-2"
            >
              {{ entry.content }}
            </div>
            <div
              v-else
              class="roadmap-prose text-single-sm-medium rounded-lg px-3 py-2"
              :class="entry.kind === 'note' ? noteBubbleClass(entry.noteKind) : 'bg-surface-subtle-default'"
              v-html="renderMarkdown(entry.kind === 'plan' ? planDisplayText(entry.content) : entry.content)"
            />
            <!-- Apply belongs on the suggestion, in the chat: only the single most recent
                 AI plan turn ever shows this — once a newer plan or a system note
                 supersedes it, the affordance moves (or disappears) with it. Fix 1: only
                 when that latest plan is a concrete proposal (`ready`) — an `ask` plan is
                 a clarifying question with nothing to apply yet. -->
            <div v-if="entry.kind === 'plan' && i === timeline.length - 1 && latestPlanStatus === 'ready'" class="mt-2">
              <Button variant="primary" data-test="rewrite-apply-inline" :class="primaryCls" :disabled="applying" @click="applyChanges">
                <PhCircleNotch v-if="applying" :size="15" class="animate-spin" />
                {{ applying ? 'Applying…' : 'Apply these changes' }}
              </Button>
            </div>
            <div v-else-if="entry.kind === 'plan' && i === timeline.length - 1 && latestPlanStatus === 'ask'" class="mt-2">
              <!-- AskUserQuestion-style: a wrap of pickable chips answer the question in
                   one click, same code path as typing + Send (see `pickOption`). The
                   free-text box below always stays available for anything not covered. -->
              <div v-if="latestPlanOptions.length" class="flex flex-wrap gap-2" data-test="rewrite-ask-options">
                <button
                  v-for="(option, oi) in latestPlanOptions"
                  :key="oi"
                  type="button"
                  data-test="rewrite-ask-option"
                  :disabled="planning || applying"
                  class="border-border-subtle-default bg-card text-single-sm-medium text-text-primary-default hover:bg-surface-primary-hover rounded-full border px-3 py-1.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-40"
                  @click="pickOption(option)"
                >
                  {{ option }}
                </button>
              </div>
              <p data-test="rewrite-ask-hint" class="text-single-sm-medium text-text-subtle-default mt-2 italic">
                {{ latestPlanOptions.length ? '…or type your own.' : 'Answer above to continue.' }}
              </p>
              <!-- Escape hatch (addendum 2): always available on any ASK, visually
                   separated from the AI's own option chips — the editor's "enough, just do
                   the changes". Forces the next turn to stop asking and produce a rewrite. -->
              <div class="border-border-subtle-default mt-3 border-t pt-3">
                <Button
                  variant="primary"
                  data-test="rewrite-best-judgment"
                  :class="primaryCls"
                  :disabled="planning || applying"
                  @click="applyBestJudgment"
                >
                  <PhSparkle :size="15" />
                  Apply your best judgment
                </Button>
              </div>
            </div>
          </div>
          <div v-if="planning" data-test="rewrite-streaming" class="mr-6">
            <p class="text-single-sm-medium text-text-subtle-default mb-1 font-semibold">AI plan</p>
            <div class="roadmap-prose bg-surface-subtle-default rounded-lg px-3 py-2" v-html="renderMarkdown(planDisplayText(streamingText) || '…')" />
          </div>
        </div>

        <p
          v-if="error"
          data-test="rewrite-error"
          class="bg-surface-transparent-orange-25 text-single-sm-medium mx-5 mb-2 shrink-0 rounded-lg px-3 py-2 text-[color:var(--color-accent-brand-default)]"
        >
          {{ error }}
        </p>

        <div class="border-border-subtle-default shrink-0 space-y-3 border-t px-5 py-4">
          <textarea
            ref="instructionInput"
            v-model="instruction"
            data-test="rewrite-instruction"
            rows="2"
            placeholder="What should change?"
            :disabled="planning || applying"
            class="border-border-subtle-default bg-card text-single-sm-medium text-text-primary-default w-full resize-none rounded-lg border px-3 py-2.5 outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)] disabled:opacity-60"
            @keydown.enter.exact.prevent="sendInstruction"
            @keydown.meta.enter.prevent="sendInstruction"
            @keydown.ctrl.enter.prevent="sendInstruction"
          />
          <div class="flex items-center justify-between gap-2">
            <Button variant="ghost" data-test="rewrite-send" :disabled="!instruction.trim() || planning || applying" @click="sendInstruction">
              <PhPaperPlaneTilt :size="15" />
              {{ planning ? 'Thinking…' : 'Send' }}
            </Button>
            <Button v-if="planning || applying" variant="ghost" data-test="rewrite-stop" @click="stopGeneration">
              <PhStop :size="15" />
              Stop
            </Button>
          </div>
        </div>
      </template>

      <!-- DIFF (APPLY result) MODE -->
      <template v-else>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4" data-test="rewrite-diff">
          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              data-test="rewrite-diff-back"
              class="text-single-sm-medium text-text-subtle-default hover:text-text-primary-default -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 transition-colors"
              @click="backToChat"
            >
              <PhCaretLeft :size="14" />
              Back to chat
            </button>
            <p class="roadmap-label">Review changes</p>
          </div>
          <div v-for="entry in diff" :key="entry.key" :data-test="`rewrite-diff-${entry.key}`" class="border-border-subtle-default rounded-lg border px-3 py-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="font-display roadmap-title text-[0.95rem]">{{ entry.key }}</p>
              <span
                class="text-single-sm-medium rounded-md px-2 py-0.5 font-semibold"
                :class="diffBadgeClass(entry.status)"
                :data-test="`rewrite-diff-status-${entry.key}`"
              >
                {{ diffStatusLabel(entry.status) }}
              </span>
            </div>
            <p v-if="entry.status === 'unchanged'" class="text-single-sm-medium text-text-subtle-default">No changes.</p>
            <div v-else class="grid gap-3 sm:grid-cols-2">
              <div>
                <p class="text-single-sm-medium text-text-subtle-default mb-1 font-semibold">Before</p>
                <p v-if="!entry.before.trim()" class="text-single-sm-medium text-text-subtle-default bg-card/50 rounded-lg px-3 py-2 italic">Empty</p>
                <div v-else class="roadmap-prose bg-card/50 text-single-sm-medium rounded-lg px-3 py-2" v-html="renderMarkdown(entry.before)" />
              </div>
              <div>
                <p class="text-single-sm-medium text-text-subtle-default mb-1 font-semibold">After</p>
                <div class="roadmap-prose bg-surface-subtle-default text-single-sm-medium rounded-lg px-3 py-2" v-html="renderMarkdown(entry.after)" />
              </div>
            </div>
          </div>
        </div>

        <p
          v-if="error"
          data-test="rewrite-error"
          class="bg-surface-transparent-orange-25 text-single-sm-medium mx-5 mb-2 shrink-0 rounded-lg px-3 py-2 text-[color:var(--color-accent-brand-default)]"
        >
          {{ error }}
        </p>

        <div class="border-border-subtle-default shrink-0 flex items-center justify-between gap-3 border-t px-5 py-4">
          <Button variant="ghost" data-test="rewrite-discard" @click="backToChat"> <PhArrowCounterClockwise :size="15" /> Discard </Button>
          <Button variant="primary" data-test="rewrite-accept" :class="primaryCls" @click="accept"> <PhCheck :size="15" /> Accept </Button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rewrite-scrim {
  animation: rewrite-fade 0.18s ease;
}
.rewrite-panel {
  animation: rewrite-slide 0.22s cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes rewrite-fade {
  from {
    opacity: 0;
  }
}
@keyframes rewrite-slide {
  from {
    opacity: 0;
    transform: translateX(12px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rewrite-scrim,
  .rewrite-panel {
    animation: none;
  }
}
</style>
