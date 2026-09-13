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
    id: 'music-app/music-001-test', filePath: '../content/items/music-app/MUSIC-001-test.md',
    data: itemSchema.parse({ id: 'MUSIC-001', title: 'New listening mode', product: 'Music App', horizon: 'Now', stage: 'Pilot', owner: 'Mark', tags: 'discovery, theme:delivery', cover: '../../assets/ast_test/rev_one/cover.png' }),
    body: '## One-liner\nFaster discovery.\n\n## Why it matters\n- Useful\n\n## Links\n- PRD: content/prds/music-app/brief.md\n',
  }];
  fixtures.documents = [{ coll: 'prds', entries: [{ id: 'music-app/brief', data: { title: 'Listening brief', roadmap_item: 'MUSIC-001', visibility: 'Internal' }, body: 'Document-only search phrase.' }] }];
});

it('preserves the characterized document search, managed cover, history and base URLs', () => {
  const [item] = buildBoardItems('/roadmap/');
  expect(item).toMatchObject({
    id: 'MUSIC-001', owner: 'Mark', horizon: 'Now', stage: 'Pilot', updated: '2026-09-12',
    tags: ['discovery'], themes: ['delivery'], oneliner: 'Faster discovery.',
    cover: '../../assets/ast_test/rev_one/cover.png', href: '/roadmap/item/MUSIC-001',
    editUrl: 'https://github.com/markpasternak/product-roadmap-generalized/edit/main/content/items/music-app/MUSIC-001-test.md',
    sections: [{ heading: 'Why it matters', text: '•  Useful', markdown: '- Useful' }],
  });
  expect(item.links[0]).toMatchObject({ title: 'Listening brief', href: '/roadmap/docs/prd/brief' });
  expect(item.text).toContain('document-only search phrase');
});

it('accepts empty collections', () => {
  fixtures.items = [];
  fixtures.documents = [];
  expect(buildBoardItems('/')).toEqual([]);
});
