// Rewrite-with-AI (U5, R6-R9): a conversational plan-then-apply flow over the whole
// current item. Two phases share one running conversation:
//   PLAN  — "state what you WOULD change; do not rewrite yet" (R7). Streamed (R8).
//   APPLY — "return the full item, exact section structure, massage/augment only" (R9).
// KTD5: the conversation carries a STABLE prefix — the item snapshot — first and
// unchanged across every turn; only new user/assistant turns append after it, so the
// conversation benefits automatically once canvas-drop adds prompt caching. KTD1: the
// APPLY response is tolerantly parsed — a section the AI drops or renames keeps the
// ORIGINAL item's exact section set/order; nothing here ever adds/removes/reorders a
// heading (never restructure).
import { chat, stream } from './client';
import type { AiMessage } from '../share/canvasdrop';
import { parseSections, serializeSections, type Section } from '../edit/sections';
import { STAGES, HORIZONS } from '../schema';
import { YAML_BLOCK_RE, parseYamlBlock } from './yamlBlock';

export const PLAN_SYSTEM_PROMPT = `You help an editor refine ONE item on a product roadmap. You are given the current \
item exactly as written, plus the running conversation about how to change it.

When the editor gives an instruction (or refines an earlier one), respond with a PLAN: \
state, section by section, what you WOULD change and why. Be concrete — name the section \
headings you'd touch and what changes there — but do NOT rewrite the item itself yet. \
Never restate the whole item back. If the instruction is unclear, briefly ask a clarifying \
question instead of guessing. Keep the plan short: a few sentences per section you'd touch, \
not a full essay.

Every reply MUST begin with a single marker line, exactly \`READY\` or \`ASK\` (nothing else \
on that line), then a blank line, then the plan or question:
- \`READY\` — you have a concrete plan the editor can apply now.
- \`ASK\` — you need the editor to answer a clarifying question before you have a plan to apply.

STRONGLY prefer \`READY\`. Apply your own good judgment and produce a concrete plan rather \
than asking: pick sensible defaults instead of asking about trivial, stylistic, or aesthetic \
choices. Use \`ASK\` ONLY when a decision would materially change the result AND there is no \
reasonable default you could pick yourself — never ask about anything you could simply decide. \
Do NOT loop: ask at most ONE clarifying round for a given instruction. If the conversation \
already contains a prior \`ASK\` from you, do not ask again — proceed with \`READY\` using your \
best judgment.

When you use \`ASK\`, after the question offer a short list of concrete options the editor \
can pick instead of typing — the editor can also just type their own answer, so cover the \
common cases rather than being exhaustive. Use EXACTLY this shape for an ASK reply:

ASK

<one short question>

OPTIONS:
- <option 1>
- <option 2>
- <option 3>

Include 2 to 5 options, each a short, concrete answer (an option can itself be worded as an \
instruction, e.g. "Add a technical risk about integration complexity"). Omit the OPTIONS: \
block entirely if you genuinely can't offer sensible options.

Presenting the editor with a CHOICE between alternative directions is itself an \`ASK\`. Whenever \
you offer alternatives to pick from, you MUST mark the turn \`ASK\` and give each alternative a \
SHORT label in the OPTIONS: block so it renders as a clickable chip — the editor cannot click \
prose. Never list pickable alternatives only as prose like "Option 1 … Option 2 … Option 3 …" \
followed by "let me know which one." Put any longer explanation in the text above, but every \
choice the editor could pick MUST also appear as a short OPTIONS: label.`;

export const APPLY_SYSTEM_PROMPT = `You are given the current roadmap item, plus a conversation in which changes were \
discussed and refined. Now produce the FULL rewritten item.

Rules:
- Preserve the EXACT existing section structure: the same \`## Heading\` set, in the same \
order. Never add, remove, rename, or reorder a section.
- Massage and augment the prose within each section according to the conversation — never \
restructure.
- A section the conversation never touched should usually be left as-is (light copy-edits \
only), not silently rewritten.

Respond with EXACTLY this shape, nothing before or after it:

1. An OPTIONAL single fenced \`\`\`yaml block with suggested metadata changes, only if the \
conversation clearly called for one. Include only keys you're confident about:
   - stage: one of ${STAGES.join(', ')}
   - horizon: one of ${HORIZONS.join(', ')}
   - tags: a short comma-separated list of lowercase tags

2. Then the full item body as \`## Section\` markdown, covering every section the current \
item has, using the exact same headings.

Do not include any preamble, explanation, or text outside the yaml block (if present) and \
the sections.`;

export type RewriteRole = 'user' | 'assistant';
export interface RewriteTurn {
  role: RewriteRole;
  content: string;
}

/** The running conversation: a stable `snapshot` (the item, rendered once) followed by
 * an append-only list of turns. Every helper below returns a NEW conversation object
 * rather than mutating — callers hold whatever they treat as "current". */
export interface RewriteConversation {
  snapshot: string;
  turns: RewriteTurn[];
}

export interface RewriteFrontmatter {
  stage?: string;
  horizon?: string;
  tags?: string;
}

export interface RewrittenItem {
  frontmatter: RewriteFrontmatter;
  body: string;
}

function buildSnapshot(body: string, frontmatter: RewriteFrontmatter): string {
  const meta = [
    frontmatter.stage ? `Stage: ${frontmatter.stage}` : null,
    frontmatter.horizon ? `Horizon: ${frontmatter.horizon}` : null,
    frontmatter.tags ? `Tags: ${frontmatter.tags}` : null,
  ]
    .filter((line): line is string => !!line)
    .join('\n');
  return `Here is the current roadmap item, exactly as written.${meta ? `\n${meta}` : ''}\n\n${body.trim()}`;
}

/** Starts a fresh conversation: the stable KTD5 prefix, no turns yet. */
export function createRewriteConversation(body: string, frontmatter: RewriteFrontmatter = {}): RewriteConversation {
  return { snapshot: buildSnapshot(body, frontmatter), turns: [] };
}

/** Appends the editor's instruction/refinement as a new user turn. Pure — returns a new
 * conversation; the snapshot is untouched (KTD5). */
export function appendInstruction(convo: RewriteConversation, instruction: string): RewriteConversation {
  return { snapshot: convo.snapshot, turns: [...convo.turns, { role: 'user', content: instruction }] };
}

/** Appends the (now-complete) streamed PLAN response as an assistant turn, so the next
 * call carries it as context. Pure, like `appendInstruction`. */
export function appendAssistantTurn(convo: RewriteConversation, content: string): RewriteConversation {
  return { snapshot: convo.snapshot, turns: [...convo.turns, { role: 'assistant', content }] };
}

/** The message list sent to the AI client for either phase: the stable snapshot first
 * (KTD5's caching-friendly prefix), then every turn so far, in order. */
export function messagesFor(convo: RewriteConversation): AiMessage[] {
  return [{ role: 'user', content: convo.snapshot }, ...convo.turns];
}

/** A plan turn is either a concrete proposal the editor can apply now (`ready`) or a
 * clarifying question waiting on the editor to answer (`ask`) — read off the `READY`/
 * `ASK` marker line `PLAN_SYSTEM_PROMPT` asks the model to lead with. Case-insensitive,
 * trimmed, and tolerant of surrounding markdown emphasis (e.g. `**READY**`) since models
 * don't always follow formatting instructions literally. When no marker is present at
 * all (the model forgot it, or an older transcript predates this convention), default to
 * `ready` — the existing no-change guard in `RewriteWithAi.vue` is the backstop for a
 * plan that turns out not to be a real proposal, so failing open here never strands the
 * editor with an unusable panel.
 *
 * An `ask` turn may also carry `options`: a short list of pickable answers parsed out of
 * an AskUserQuestion-style \`OPTIONS:\` block (each \`- \` bullet line, trimmed) — the
 * block is stripped from `text` entirely, since it renders as chips, not prose. `ready`
 * and no-marker turns always have `options: []`. */
/** Fallback for when the model offers a choice as PROSE ("Option 1: …", "Option 2: …")
 * instead of the structured `OPTIONS:` block — a common non-compliance we still want to make
 * pickable rather than stranding the editor with un-clickable prose. Pulls the short label
 * after each `Option N:` header (tolerating `**bold**` and `:`/`-`/`–`/`—` separators). Only
 * kicks in with 2+ such headers, so a passing mention of "option" never turns into chips. */
function proseOptionLabels(text: string): string[] {
  const opts: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*\*{0,2}option\s+\d+\s*[:.\-–—]\s*(.+?)\s*\*{0,2}\s*$/i.exec(line);
    if (m) opts.push(m[1]!.replace(/\*+$/, '').trim());
  }
  return opts.length >= 2 ? opts : [];
}

export function parsePlanTurn(content: string): { status: 'ready' | 'ask'; text: string; options: string[] } {
  // A choice offered as prose is still a choice: surface it as pickable chips (status `ask`)
  // even on a `ready`/unmarked turn, rather than leaving the editor nothing to click.
  const askFromProse = (
    status: 'ready' | 'ask',
    text: string,
  ): { status: 'ready' | 'ask'; text: string; options: string[] } => {
    const prose = proseOptionLabels(text);
    return prose.length ? { status: 'ask', text, options: prose } : { status, text, options: [] };
  };

  const lines = content.split('\n');
  const firstNonEmptyIdx = lines.findIndex((line) => line.trim() !== '');
  if (firstNonEmptyIdx === -1) return { status: 'ready', text: content, options: [] };

  const firstLine = lines[firstNonEmptyIdx]!;
  const marker = firstLine.trim().replace(/^\*+|\*+$/g, '').trim().toUpperCase();
  if (marker !== 'READY' && marker !== 'ASK') return askFromProse('ready', content);

  const status: 'ready' | 'ask' = marker === 'READY' ? 'ready' : 'ask';
  const rest = lines.slice(firstNonEmptyIdx + 1).join('\n').replace(/^\n+/, '');
  if (status === 'ready') return askFromProse('ready', rest);

  // ASK: pull an optional `OPTIONS:` block out of the question — a short list of pickable
  // answers (AskUserQuestion-style). Found by a whole line reading exactly `OPTIONS:`;
  // every `- ` bullet line right after it (skipping at most one blank separator line
  // before the first bullet) is one option, trimmed. Everything before that line is the
  // displayed question; the block itself never appears in `text`.
  const restLines = rest.split('\n');
  const optionsIdx = restLines.findIndex((line) => line.trim().toUpperCase() === 'OPTIONS:');
  if (optionsIdx === -1) return askFromProse(status, rest.trimEnd());

  const options: string[] = [];
  for (let i = optionsIdx + 1; i < restLines.length; i++) {
    const trimmed = restLines[i]!.trim();
    if (trimmed === '' && options.length === 0) continue; // one blank separator line, tolerated
    if (!trimmed.startsWith('-')) break;
    options.push(trimmed.slice(1).trim());
  }
  const question = restLines.slice(0, optionsIdx).join('\n').trim();
  return { status, text: question, options };
}

/** PLAN turn (R7, R8): streams "what I would change" — writes nothing anywhere. The
 * caller accumulates the yielded deltas and, once the stream completes, hands the full
 * text to `appendAssistantTurn` to carry it into the next turn. `signal` (client-side
 * cancellation): forwarded to `stream` unchanged — see `client.ts`. */
export function planStream(convo: RewriteConversation, options: { signal?: AbortSignal } = {}): AsyncIterable<string> {
  return stream(messagesFor(convo), { system: PLAN_SYSTEM_PROMPT, signal: options.signal });
}

/**
 * Tolerant parse of an APPLY response (KTD1). Strips a leading fenced yaml block (if
 * any) into suggested frontmatter, validated against `schema.ts`'s enums. The remaining
 * text is parsed into `## Section` sections and reconciled against `currentBody`'s own
 * section set: every section `currentBody` has comes back, IN THE SAME ORDER, with the
 * AI's rewritten body when a matching heading (case-insensitively) is present AND
 * non-empty, or the ORIGINAL body untouched when the AI dropped, renamed, mangled, or
 * blanked it out. Any heading in the AI's response that isn't part of the original
 * structure is ignored — Rewrite-with-AI never restructures.
 */
export function parseRewritten(text: string, currentBody: string): RewrittenItem {
  const trimmed = text.trim();
  const m = YAML_BLOCK_RE.exec(trimmed);

  let fields: Record<string, string> = {};
  let rest = trimmed;
  if (m) {
    fields = parseYamlBlock(m[1]!);
    rest = trimmed.slice(m[0].length).trimStart();
  }

  const frontmatter: RewriteFrontmatter = {};
  if (fields.stage && (STAGES as readonly string[]).includes(fields.stage)) frontmatter.stage = fields.stage;
  if (fields.horizon && (HORIZONS as readonly string[]).includes(fields.horizon)) frontmatter.horizon = fields.horizon;
  if (fields.tags) frontmatter.tags = fields.tags;

  const current = parseSections(currentBody);
  const rewritten = parseSections(rest);
  if (rewritten.sections.length === 0 && current.sections.length > 0) {
    // No parseable `## ` sections in the APPLY response — the rewrite couldn't be applied
    // (the model returned prose, not the item). Surface it for debugging rather than
    // silently returning the original, which the UI then reports as "nothing changed".
    console.warn('[rewrite] APPLY response had no parseable `## ` sections; keeping original.', { preview: rest.slice(0, 300) });
  }
  const rewrittenByHeading = new Map(rewritten.sections.map((s) => [s.heading.toLowerCase(), s.body]));

  const mergedSections: Section[] = current.sections.map((s) => {
    const rewrittenBody = rewrittenByHeading.get(s.heading.toLowerCase());
    // KTD1's "a dropped/mangled section keeps the original" guarantee also covers an
    // EMPTY rewritten body: a matching heading with nothing (or only whitespace) under
    // it isn't a deliberate "blank this section out" — the APPLY prompt never asks for
    // that — so treat it the same as a missing heading and keep the original prose.
    const body = rewrittenBody !== undefined && rewrittenBody.trim() !== '' ? rewrittenBody : s.body;
    return { heading: s.heading, body };
  });

  const body = serializeSections(current.preamble, mergedSections);
  return { frontmatter, body };
}

/** APPLY (R9): a blocking `chat` call (callers should show a spinner) with the whole
 * conversation so far, then the tolerant parse above. Quota/unavailable errors from
 * `chat` propagate unchanged — callers map them to a friendly message (R10). `signal`
 * (client-side cancellation): forwarded to `chat` unchanged — an aborted signal makes
 * `chat` throw `AiAbortedError` instead of resolving (see `client.ts`). */
export async function applyRewrite(
  convo: RewriteConversation,
  currentBody: string,
  options: { signal?: AbortSignal } = {},
): Promise<RewrittenItem> {
  // The APPLY request MUST end on a user turn. At apply-time the conversation ends with
  // the assistant's PLAN, and a request whose last message is `assistant` is treated as a
  // prefill: the model CONTINUES that plan (more prose, no `## ` sections) instead of
  // producing the item — so nothing parses and every section wrongly falls back to the
  // original ("nothing changed" despite a good plan). A final user turn makes it generate
  // the rewrite fresh.
  const messages: AiMessage[] = [
    ...messagesFor(convo),
    {
      role: 'user',
      content:
        'Now apply everything we discussed and output the FULL rewritten item in the required ' +
        'format: the optional yaml block only if metadata changed, then every `## ` section using ' +
        'the exact same headings, actually applying the changes. Output only that — no preamble or commentary.',
    },
  ];
  const { text } = await chat(messages, { system: APPLY_SYSTEM_PROMPT, maxTokens: 4096, signal: options.signal });
  return parseRewritten(text, currentBody);
}
