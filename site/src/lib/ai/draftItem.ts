// New-with-AI (U4, R3-R5): drafts an expansive roadmap item from a short prompt. Calls the
// thin `chat` wrapper (`./client`) with a system prompt teaching Sonnet the item shape/house
// style, then tolerantly parses the response (KTD1) into the same section-markdown shape the
// editor/edit-service already read/write — no new JSON schema, no new dependency.
import { chat } from './client';
import type { AiMessage } from '../share/canvasdrop';
import { PRODUCTS, STAGES, HORIZONS, type Product } from '../schema';
import { YAML_BLOCK_RE, parseYamlBlock } from './yamlBlock';

export interface DraftedFrontmatter {
  stage?: string;
  horizon?: string;
  tags?: string;
}

export interface DraftedItem {
  title: string;
  frontmatter: DraftedFrontmatter;
  body: string;
}

// Taught against the depth of the repo's fullest specs (e.g.
// content/items/podcasts-audiobooks/TALK-001-media-plan-import-creation.md): an expansive, fully
// fleshed-out draft rather than a stub — every section filled with real, specific prose.
export const ROADMAP_ITEM_SYSTEM = `You draft a new roadmap item for a product roadmap tool. Given a short prompt and a \
product, write a full, expansive item — not a stub. Match the depth and specificity of the \
best specs on this roadmap: concrete outcomes, real tradeoffs, named constraints — never \
generic filler.

Respond with EXACTLY this shape, nothing before or after it:

1. A single fenced \`\`\`yaml block with the item's metadata. These keys keep the item VALID, so \
set them from the allowed values (never invent values outside the lists):
   - title: a concise, specific item title (REQUIRED)
   - horizon: REQUIRED — exactly one of ${HORIZONS.join(', ')} (pick the single best fit)
   - stage: exactly one of ${STAGES.join(', ')} (pick the best fit)
   - tags: a short comma-separated list of lowercase tags (optional)

2. Then the item body as \`## Section\` markdown, in this order, filling in every section you \
have real content for (skip a section entirely rather than leaving it a placeholder):
   ## One-liner
   ## Why it matters
   ## Target outcome
   ## Scope
   ## Who it's for
   ## Acceptance criteria
   ## Open questions

Do not repeat the title as a heading. Do not include any preamble, explanation, or text \
outside the yaml block and the sections above.`;

/** Tolerant parse (KTD1): strips a leading fenced yaml block (if any), validates the
 * suggested stage/horizon against `schema.ts`'s enums (dropping anything out-of-enum), and
 * treats everything else as the body verbatim. A missing/mangled yaml block, a missing title,
 * or a missing section all degrade gracefully rather than throwing. */
export function parseDraft(text: string): DraftedItem {
  const trimmed = text.trim();
  const m = YAML_BLOCK_RE.exec(trimmed);

  let fields: Record<string, string> = {};
  let body = trimmed;
  if (m) {
    fields = parseYamlBlock(m[1]!);
    body = trimmed.slice(m[0].length).trimStart();
  }

  const title = (fields.title ?? '').trim() || 'Untitled draft';

  const frontmatter: DraftedFrontmatter = {};
  // `stage` has a server-side create default ('Discovery'), so an omitted/out-of-enum one is
  // safe to leave for the server — only carry a valid suggestion.
  if (fields.stage && (STAGES as readonly string[]).includes(fields.stage)) frontmatter.stage = fields.stage;
  // `horizon` is REQUIRED and has NO server default: a drafted item missing (or with an
  // out-of-enum) horizon would be invalid and unplaceable on the board, and would block at Sync
  // (see U5 validation). So always land a valid one, defaulting to 'Next' (the same fallback the
  // manual add path uses) when the model omits or mangles it.
  frontmatter.horizon =
    fields.horizon && (HORIZONS as readonly string[]).includes(fields.horizon) ? fields.horizon : 'Next';
  if (fields.tags) frontmatter.tags = fields.tags;

  return { title, frontmatter, body };
}

/** Drafts a full item from a prompt + product. `maxTokens: 4096` gives Sonnet room for an
 * expansive, multi-section draft (R4) — the call is blocking; callers should show a spinner.
 * `signal` (client-side cancellation): forwarded to `chat` unchanged — an aborted signal
 * makes `chat` throw `AiAbortedError` instead of resolving (see `client.ts`). */
export async function draftItem(prompt: string, product: string, options: { signal?: AbortSignal } = {}): Promise<DraftedItem> {
  const validProduct: Product = (PRODUCTS as readonly string[]).includes(product)
    ? (product as Product)
    : PRODUCTS[0];
  const messages: AiMessage[] = [
    { role: 'user', content: `Product: ${validProduct}\n\nPrompt: ${prompt.trim()}` },
  ];
  const { text } = await chat(messages, { system: ROADMAP_ITEM_SYSTEM, maxTokens: 4096, signal: options.signal });
  return parseDraft(text);
}
