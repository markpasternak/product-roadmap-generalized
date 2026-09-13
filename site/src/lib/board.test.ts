// @vitest-environment node
import { beforeEach, expect, it } from 'vitest';
import { itemSchema } from './schema';
import { EMPTY_ITEM_HISTORY } from './itemHistory';

import { buildPublishedModel } from './published/model';
import type { ContentSource } from './published/schema';
const fixtures: ContentSource = { items: [], documents: [] };
const buildBoardItems = (base: string) => buildPublishedModel(fixtures, { base, audience: 'internal', historyForPath: () => ({ ...EMPTY_ITEM_HISTORY, updated: '2026-09-12' }) }).boardItems;

beforeEach(() => {
  fixtures.items = [{
    id: 'studio/studio-001-test', filePath: '../content/items/studio/STUDIO-001-test.md',
    data: itemSchema.parse({ id: 'STUDIO-001', title: 'New creative', product: 'Studio', horizon: 'Now', stage: 'Pilot', owner: 'Mark', tags: 'creative, theme:delivery', cover: '../../assets/ast_test/rev_one/cover.png' }),
    body: '## One-liner\nFaster creation.\n\n## Why it matters\n- Useful\n\n## Links\n- PRD: content/prds/studio/brief.md\n',
  }];
  fixtures.documents = [{ coll: 'prds', entries: [{ id: 'studio/brief', data: { title: 'Creative brief', roadmap_item: 'STUDIO-001', visibility: 'Internal' }, body: 'Document-only search phrase.' }] }];
});

it('preserves the characterized document search, managed cover, history and base URLs', () => {
  const [item] = buildBoardItems('/roadmap/');
  expect(item).toMatchObject({
    id: 'STUDIO-001', owner: 'Mark', horizon: 'Now', stage: 'Pilot', updated: '2026-09-12',
    tags: ['creative'], themes: ['delivery'], oneliner: 'Faster creation.',
    cover: '../../assets/ast_test/rev_one/cover.png', href: '/roadmap/item/STUDIO-001',
    editUrl: 'https://github.com/seenthis-ab/product-roadmap/edit/main/content/items/studio/STUDIO-001-test.md',
    sections: [{ heading: 'Why it matters', text: '•  Useful', markdown: '- Useful' }],
  });
  expect(item.links[0]).toMatchObject({ title: 'Creative brief', href: '/roadmap/docs/prd/brief' });
  expect(item.text).toContain('document-only search phrase');
});

it('accepts empty collections', () => {
  fixtures.items = [];
  fixtures.documents = [];
  expect(buildBoardItems('/')).toEqual([]);
});
