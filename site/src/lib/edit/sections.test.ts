import { describe, it, expect } from 'vitest';
import {
  parseSections,
  serializeSections,
  splitSpine,
  assembleBody,
  CANONICAL_SECTIONS,
  OPTIONAL_SECTIONS,
} from './sections';

// The body (frontmatter stripped) of content/items/podcasts-audiobooks/TALK-013-migrate-off-supabase.md,
// copied verbatim — a real item body with a title preamble, single-paragraph sections, a
// list-only section, and a trailing `## Links` section with no blank line after it (just
// the file's final newline). Used to assert an exact round-trip against real content, not
// a synthetic fixture.
const REAL_BODY = `# Migrate off Supabase

## One-liner
Move off Supabase with no feature loss.

## Why it matters
MediaOS runs on Supabase across the stack — Postgres with row-level security, Auth, Edge Functions (parser, CRM order flow, platform push), Storage and Realtime — and everything works in production today. This card is about understanding what we actually depend on Supabase for and what a move would require, before committing to anything.

## What ships
An exploration and a decision, not a committed migration. Scope to be defined by Love.

## Open questions
- What exactly do we rely on Supabase for (Postgres, Auth, RLS, Edge Functions, Storage, Realtime), and which parts are hardest to replace?
- What would a target stack look like, and what does each piece map to (auth, an RLS-equivalent authorization layer, a functions runtime, storage)?
- What is the migration path with no data loss and no access or permission regressions, with minimal downtime?
- What is the cost and benefit, and what would trigger actually doing it?

## Links
- Notion card: https://app.notion.com/p/3878599dda6281afb0b0fd4dbc509002
`;

describe('parseSections / serializeSections', () => {
  it('round-trips a real item body exactly', () => {
    const { preamble, sections } = parseSections(REAL_BODY);
    expect(serializeSections(preamble, sections)).toBe(REAL_BODY);
  });

  it('splits the real body into the expected preamble and headings, in order', () => {
    const { preamble, sections } = parseSections(REAL_BODY);
    expect(preamble).toBe('# Migrate off Supabase\n');
    expect(sections.map((s) => s.heading)).toEqual([
      'One-liner',
      'Why it matters',
      'What ships',
      'Open questions',
      'Links',
    ]);
    expect(sections[0].body).toBe('Move off Supabase with no feature loss.\n');
    expect(sections[3].body).toContain('- What is the cost and benefit');
  });

  it('treats a body with no ## headings as all preamble', () => {
    const md = 'Just some prose.\nNo sections here.';
    const { preamble, sections } = parseSections(md);
    expect(preamble).toBe(md);
    expect(sections).toEqual([]);
    expect(serializeSections(preamble, sections)).toBe(md);
  });

  it('keeps an unknown/custom heading as-is and round-trips it', () => {
    const md = '# Title\n\n## Totally Custom Heading\nSome body text.\n';
    const { preamble, sections } = parseSections(md);
    expect(sections).toEqual([{ heading: 'Totally Custom Heading', body: 'Some body text.\n' }]);
    expect(serializeSections(preamble, sections)).toBe(md);
  });

  it('is robust to duplicate headings, keeping both as separate ordered sections', () => {
    const md = '## Links\n- one\n\n## Links\n- two\n';
    const { sections } = parseSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toEqual({ heading: 'Links', body: '- one\n' });
    expect(sections[1]).toEqual({ heading: 'Links', body: '- two\n' });
  });

  it('is robust to an empty section (heading followed immediately by another heading)', () => {
    const md = '## Empty\n\n## Next\nContent.\n';
    const { sections } = parseSections(md);
    expect(sections[0]).toEqual({ heading: 'Empty', body: '' });
    expect(sections[1].heading).toBe('Next');
  });

  it('handles a body with no preamble (first line is already a heading)', () => {
    const md = '## One-liner\nJust this.\n';
    const { preamble, sections } = parseSections(md);
    expect(preamble).toBe('');
    expect(sections).toEqual([{ heading: 'One-liner', body: 'Just this.\n' }]);
    expect(serializeSections(preamble, sections)).toBe(md);
  });

  it('re-serializing after editing a section body reflects the edit', () => {
    const { preamble, sections } = parseSections(REAL_BODY);
    const edited = sections.map((s) => (s.heading === 'One-liner' ? { ...s, body: 'Rewritten one-liner.\n' } : s));
    const out = serializeSections(preamble, edited);
    expect(out).toContain('## One-liner\nRewritten one-liner.\n');
    expect(out).not.toContain('Move off Supabase with no feature loss.');
  });
});

describe('splitSpine / assembleBody', () => {
  it.each(['Scope', 'What ships', 'What shipped'])('loads %s into the Scope field without changing stored copy', heading => {
    const body = `## One-liner\nSummary\n\n## Why it matters\nReason\n\n## ${heading}\nThe work.\n`;
    const spine = splitSpine(parseSections(body));
    expect(CANONICAL_SECTIONS[2]).toBe('Scope');
    expect(spine.canonical[2]).toEqual({ heading, body: 'The work.\n' });
    expect(spine.optional).toEqual([]);
    expect(assembleBody(spine.preamble, spine.canonical, spine.optional)).toBe(body);
  });

  it('splits the real body into canonical (in canonical order) + optional (in file order)', () => {
    const { preamble, canonical, optional } = splitSpine(parseSections(REAL_BODY));
    expect(preamble).toBe('# Migrate off Supabase\n');
    expect(canonical.map((s) => s.heading)).toEqual(['One-liner', 'Why it matters', 'What ships']);
    expect(canonical.map((s) => s.heading)).toEqual(['One-liner', 'Why it matters', 'What ships']);
    expect(optional.map((s) => s.heading)).toEqual(['Open questions', 'Links']);
  });

  it('round-trips a real body that is already in canonical order exactly', () => {
    const parsed = parseSections(REAL_BODY);
    const { preamble, canonical, optional } = splitSpine(parsed);
    expect(assembleBody(preamble, canonical, optional)).toBe(REAL_BODY);
  });

  it('stubs missing canonical sections with an empty body, matching case-insensitively', () => {
    const md = '# Title\n\n## why it matters\nReasoning.\n\n## Links\n- a link\n';
    const { canonical, optional } = splitSpine(parseSections(md));
    expect(canonical).toEqual([
      { heading: 'One-liner', body: '' },
      { heading: 'why it matters', body: 'Reasoning.\n' },
      { heading: 'Scope', body: '' },
    ]);
    expect(optional).toEqual([{ heading: 'Links', body: '- a link\n' }]);
  });

  it('preserves the optional set/content even when canonicals are reordered back to canonical order', () => {
    // Canonicals out of file order, interleaved with an optional section.
    const md =
      '# Title\n\n## What ships\nShip content.\n\n## Links\n- a link\n\n## One-liner\nThe one-liner.\n\n## Why it matters\nReasoning.\n';
    const parsed = parseSections(md);
    const { preamble, canonical, optional } = splitSpine(parsed);
    const out = assembleBody(preamble, canonical, optional);

    // Canonical order is normalized...
    expect(canonical.map((s) => s.heading)).toEqual(['One-liner', 'Why it matters', 'What ships']);
    // ...but no content is lost, and the optional section survives untouched.
    expect(out).toContain('## One-liner\nThe one-liner.\n');
    expect(out).toContain('## Why it matters\nReasoning.\n');
    expect(out).toContain('## What ships\nShip content.\n');
    expect(out).toContain('## Links\n- a link\n');
    expect(optional).toEqual([{ heading: 'Links', body: '- a link\n' }]);
  });

  it('exposes every real-corpus optional heading in a stable menu order', () => {
    expect(OPTIONAL_SECTIONS).toEqual([
      'Bottom line',
      "Who it's for",
      'Target outcome',
      'Acceptance criteria',
      'Open questions',
      'Current behavior',
      'In the codebase',
      'Resources',
      'Links',
    ]);
  });

  it('drops an empty optional section (added but never filled in) from the saved output', () => {
    const parsed = parseSections(REAL_BODY);
    const { preamble, canonical, optional } = splitSpine(parsed);
    const withEmptyOptional = [...optional, { heading: "Who it's for", body: '' }];
    const out = assembleBody(preamble, canonical, withEmptyOptional);

    expect(out).not.toContain("Who it's for");
    expect(out).toBe(REAL_BODY);
  });

  it('drops a whitespace-only section from the saved output', () => {
    const parsed = parseSections(REAL_BODY);
    const { preamble, canonical, optional } = splitSpine(parsed);
    const withBlankOptional = [...optional, { heading: 'Links', body: '   \n\n  ' }];
    const out = assembleBody(preamble, canonical, withBlankOptional);

    expect((out.match(/## Links/g) ?? []).length).toBe(1); // the real, filled Links section survives; the blank one is dropped
  });

  it('drops an untouched canonical section (still at its splitSpine-stubbed empty default) from the saved output', () => {
    const md = '# Title\n\n## why it matters\nReasoning.\n\n## Links\n- a link\n';
    const { preamble, canonical, optional } = splitSpine(parseSections(md));
    // canonical is [{heading: 'One-liner', body: ''}, {heading: 'why it matters', body: 'Reasoning.\n'}, {heading: 'What ships', body: ''}]
    const out = assembleBody(preamble, canonical, optional);

    expect(out).not.toContain('## One-liner');
    expect(out).not.toContain('## What ships');
    expect(out).toBe('# Title\n\n## why it matters\nReasoning.\n\n## Links\n- a link\n');

    // But the empty canonicals are re-stubbed on the next parse, so the editor still
    // shows all 3 canonical sections for the user to fill in. ("why it matters" keeps
    // its original file casing, same as splitSpine's case-insensitive matching above.)
    const reparsed = splitSpine(parseSections(out));
    expect(reparsed.canonical).toHaveLength(3);
    expect(reparsed.canonical[0]).toEqual({ heading: 'One-liner', body: '' });
    expect(reparsed.canonical[1]).toEqual({ heading: 'why it matters', body: 'Reasoning.\n' });
    expect(reparsed.canonical[2]).toEqual({ heading: 'Scope', body: '' });
  });

  it('round-trips a fully-filled real body unchanged (no empty sections to drop)', () => {
    const parsed = parseSections(REAL_BODY);
    const { preamble, canonical, optional } = splitSpine(parsed);
    expect(assembleBody(preamble, canonical, optional)).toBe(REAL_BODY);
  });
});
