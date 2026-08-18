// U5 (R9): a section-by-section before/after diff between the current item and an
// applied AI rewrite. `rewrite.ts`'s `parseRewritten` has already reconciled the section
// SET via KTD1's tolerant parse — same headings, same order, nothing added/removed — so
// this only ever needs to line sections up by heading, never invent or drop one.
import type { Section } from '../edit/sections';

export type SectionDiffStatus = 'added' | 'changed' | 'unchanged';

export interface SectionDiffEntry {
  key: string;
  status: SectionDiffStatus;
  before: string;
  after: string;
}

/**
 * Compares `currentSections` (the item as it stands) against `rewrittenSections` (the
 * parsed/reconciled AI rewrite), matching by heading (case-insensitively). A heading
 * present in `currentSections` but missing from `rewrittenSections` — the AI dropped or
 * mangled it — reads as `unchanged` against its own original body, matching KTD1's
 * "keeps the original section" guarantee.
 *
 * Status:
 *  - `unchanged` — the (trimmed) body is identical.
 *  - `added`     — the current body was blank and the rewrite gave it real content.
 *  - `changed`   — anything else.
 */
export function sectionDiff(currentSections: Section[], rewrittenSections: Section[]): SectionDiffEntry[] {
  const rewrittenByHeading = new Map(rewrittenSections.map((s) => [s.heading.toLowerCase(), s.body]));

  return currentSections.map((s) => {
    const before = s.body;
    const after = rewrittenByHeading.get(s.heading.toLowerCase()) ?? s.body;
    const beforeTrim = before.trim();
    const afterTrim = after.trim();

    let status: SectionDiffStatus;
    if (beforeTrim === afterTrim) status = 'unchanged';
    else if (beforeTrim === '') status = 'added';
    else status = 'changed';

    return { key: s.heading, status, before, after };
  });
}
