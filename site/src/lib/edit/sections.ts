// Structured view over an item's markdown body for U6's SectionEditor: splits the
// free-form `## Heading` prose into an editable preamble + ordered section list, and
// serializes back to the same markdown shape. This is deliberately separate from the
// display-only `parseSections` in `lib/items.ts` (which trims/drops placeholder
// sections for read-only rendering) — this one preserves exact prose so it can
// round-trip through an editor without silently discarding whitespace or content.
export type Section = { heading: string; body: string };

const HEADING_RE = /^##\s+(.*)$/;

/**
 * Splits a body into the text before the first `## Heading` (the `preamble` — usually
 * the `# Title` line plus any lead-in prose) and the ordered `##` sections that follow.
 * Unknown/custom headings and duplicate headings are kept as-is, in file order.
 */
export function parseSections(md: string): { preamble: string; sections: Section[] } {
  const lines = md.split('\n');
  const preambleLines: string[] = [];
  const sections: Section[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n') });
      current = { heading: m[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n') });

  return { preamble: preambleLines.join('\n'), sections };
}

/**
 * Inverse of `parseSections`: `serializeSections(...parseSections(md))` round-trips a
 * real item body exactly. (The one place this can't be byte-exact is a body with zero
 * blank-line separation left over from a fully-empty section with no trailing blank
 * line before the next heading — not a shape that appears in real content — where a
 * separating blank line is reintroduced; this is the "trivially normalized" case.)
 */
export function serializeSections(preamble: string, sections: Section[]): string {
  const parts: string[] = [];
  if (preamble !== '') parts.push(preamble);
  for (const s of sections) parts.push(`## ${s.heading}\n${s.body}`);
  return parts.join('\n');
}

/**
 * The three sections every roadmap item has, in the fixed order the structured editor
 * pins them at the top: an item's "signature" shape. Derived from a survey of the real
 * content/items corpus (see docs/plans) rather than invented — every item has these.
 */
export const CANONICAL_SECTIONS: string[] = ['One-liner', 'Why it matters', 'What ships'];

/**
 * Sections that show up on some items but not others, in the order they're offered in
 * the "+ Add section" menu. Also derived from the real corpus.
 */
export const OPTIONAL_SECTIONS: string[] = [
  "Who it's for",
  'Target outcome',
  'Acceptance criteria',
  'Open questions',
  'Current behavior',
  'In the codebase',
  'Links',
  'What shipped',
];

/**
 * Reshapes a parsed body around the canonical spine for the structured editor: the 3
 * canonical sections always come back in `CANONICAL_SECTIONS` order (stubbed with an
 * empty body if the source body is missing one), matching headings case-insensitively
 * so a real file's exact casing doesn't matter. Everything else comes back as
 * `optional`, in its original file order. Inverse of `assembleBody`.
 */
export function splitSpine(parsed: { preamble: string; sections: Section[] }): {
  preamble: string;
  canonical: Section[];
  optional: Section[];
} {
  const remaining = [...parsed.sections];
  const canonical = CANONICAL_SECTIONS.map((heading) => {
    const idx = remaining.findIndex((s) => s.heading.toLowerCase() === heading.toLowerCase());
    if (idx === -1) return { heading, body: '' };
    return remaining.splice(idx, 1)[0];
  });
  return { preamble: parsed.preamble, canonical, optional: remaining };
}

/**
 * Inverse of `splitSpine`: reassembles a full body from the preamble plus the canonical
 * sections (in canonical order) followed by the optional sections (in the given order),
 * via `serializeSections`. Sections whose body is empty or whitespace-only are dropped
 * before serializing — an unfilled optional section the user added but never wrote
 * into, or a canonical section left at its `splitSpine`-stubbed empty default, would
 * otherwise be written to the file as a bare `## Heading` with nothing under it. This
 * only affects what gets saved: `splitSpine` still re-stubs the canonical spine with an
 * empty body on the next load, so the editor always shows all 3 canonical sections.
 */
export function assembleBody(preamble: string, canonical: Section[], optional: Section[]): string {
  const nonEmpty = [...canonical, ...optional].filter((s) => s.body.trim() !== '');
  return serializeSections(preamble, nonEmpty);
}
