// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { itemSchema } from './schema';
import { EMPTY_ITEM_HISTORY } from './itemHistory';

const fixtures = vi.hoisted(() => ({ items: [] as unknown[], docs: [] as unknown[] }));
vi.mock('astro:content', () => ({ getCollection: async () => fixtures.items }));
vi.mock('./docs', () => ({ getVisibleDocCollections: async () => fixtures.docs }));
vi.mock('./itemHistory.server', () => ({ itemHistoryForPath: () => ({ ...EMPTY_ITEM_HISTORY, updated: '2026-09-12' }) }));
import { buildBoardItems } from './board';

beforeEach(() => {
  fixtures.items = [{
    id: 'studio/studio-001-test', filePath: '../content/items/studio/STUDIO-001-test.md',
    data: itemSchema.parse({ id: 'STUDIO-001', title: 'New creative', product: 'Studio', horizon: 'Now', stage: 'Pilot', owner: 'Mark', tags: 'creative, theme:delivery', cover: '../../assets/ast_test/rev_one/cover.png' }),
    body: '## One-liner\nFaster creation.\n\n## Why it matters\n- Useful\n\n## Links\n- PRD: content/prds/studio/brief.md\n',
  }];
  fixtures.docs = [{ root: 'prds', coll: 'prds', entries: [{ id: 'studio/brief', data: { title: 'Creative brief', roadmap_item: 'STUDIO-001', visibility: 'Internal' }, body: 'Document-only search phrase.' }] }];
});

it('characterizes the Astro adapter including document search, managed cover, history and base URLs', async () => {
  const [item] = await buildBoardItems('/roadmap/');
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

it('accepts empty collections', async () => {
  fixtures.items = [];
  fixtures.docs = [];
  expect(await buildBoardItems('/')).toEqual([]);
});
