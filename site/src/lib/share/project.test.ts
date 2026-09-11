import { describe, it, expect } from 'vitest';
import { projectForShare } from './project';
import type { ItemVM } from '../filters';

const base: ItemVM = {
  id: 'TALK-1', title: 'Internal Title', product: 'Podcasts & Audiobooks',
  horizon: 'Now', stage: 'Building', owner: 'secret@example.com',
  impact: 'High', effort: 'Low', visibility: 'Internal', order: 1, updated: '2026-07-01',
  tags: ['workflow'], themes: ['one-view'], oneliner: 'Internal one-liner',
  outcome: 'The outcome', sections: [{ heading: 'Why it matters', text: 'because' }],
  editUrl: 'https://github.com/edit/x', links: [{ label: 'Notion card', kind: 'doc', href: '#', target: 't', title: null }],
  text: 'internal haystack', href: '/item/TALK-1',
};

describe('projectForShare', () => {
  it('keeps inline image positions and Bottom line while excluding internal sections and link targets', () => {
    const href = '../../assets/ast_example/rev_one/screen.png';
    const projected = projectForShare({ ...base, sections: [
      { heading: 'What shipped', text: 'Before Image After', markdown: `Before\n\n![Image](${href})\n\nAfter [internal](https://internal.example/private)` },
      { heading: 'Bottom line', text: 'The work is complete.' },
      { heading: 'In the codebase', text: 'private implementation' },
    ] });
    expect(projected.sections.map(section => section.heading)).toEqual(['Scope', 'Bottom line']);
    expect(projected.sections[0].blocks).toEqual([{ text: 'Before' }, { image: { href, label: 'Image' } }, { text: 'After internal' }]);
    expect(JSON.stringify(projected)).not.toContain('https://internal.example');
    expect(JSON.stringify(projected)).not.toContain('private implementation');
  });

  it('uses canonical title and one-liner', () => {
    const p = projectForShare(base);
    expect(p.title).toBe('Internal Title');
    expect(p.oneliner).toBe('Internal one-liner');
  });

  it('carries no internal-only fields', () => {
    const p = projectForShare(base) as unknown as Record<string, unknown>;
    for (const k of ['owner', 'editUrl', 'links', 'text', 'href', 'visibility']) {
      expect(k in p).toBe(false);
    }
  });

  it('does not emit share-gating metadata', () => {
    const p = projectForShare(base) as unknown as Record<string, unknown>;
    expect('hasExternalCopy' in p).toBe(false);
    expect('externalVisibility' in p).toBe(false);
  });

  it('keeps the curated card fields', () => {
    const p = projectForShare(base);
    expect(p.outcome).toBe('The outcome');
    expect(p.sections).toEqual([{ heading: 'Why it matters', text: 'because' }]);
    expect(p.tags).toEqual(['workflow']);
    expect(p.horizon).toBe('Now');
  });
});
