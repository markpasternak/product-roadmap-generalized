// @vitest-environment node
import { expect, it } from 'vitest';
import { itemSchema } from '../schema';
import { EMPTY_ITEM_HISTORY } from '../itemHistory';
import { buildPublishedModel } from './model';

const item = (id = 'STUDIO-001', visibility = 'Public') => ({
  id: `studio/${id.toLowerCase()}`, filePath: `content/items/studio/${id}.md`,
  data: itemSchema.parse({ id, title: id, product: 'Studio', horizon: 'Now', stage: 'Pilot', owner: 'private-owner-sentinel', visibility }),
  body: '## One-liner\nA useful improvement\n\n## Scope\nVisible scope\n\n## In the codebase\nprivate-section-sentinel\n',
});
const doc = (id: string, visibility = 'Public') => ({ id, data: { title: 'Source title', visibility, roadmap_item: 'STUDIO-001', owner: 'private-doc-owner-sentinel' }, body: visibility === 'Public' ? 'backing-search-sentinel' : 'private-doc-sentinel' });
const options = { base: '/', audience: 'internal' as const, historyForPath: () => ({ ...EMPTY_ITEM_HISTORY, updated: '2026-09-12' }) };

it('uses the same enriched model for documents, items and the board without Astro', () => {
  const source = { items: [item()], documents: [{ coll: 'prds' as const, entries: [doc('studio/brief')] }] };
  const model = buildPublishedModel(source, options);
  expect(model.boardItems[0].text).toContain('backing-search-sentinel');
  expect(model.boardItems[0].updated).toBe('2026-09-12');
  expect(model.documents[0].href).toBe('/docs/prd/brief');
  expect(model.documents[0].backlinks[0].id).toBe('STUDIO-001');
  expect(model.items[0].body).toContain('private-section-sentinel');
  expect(source.items[0].data.owner).toBe('private-owner-sentinel');
});

it('filters public data before search, backlinks and serialization', () => {
  const source = { items: [item(), item('STUDIO-002', 'Internal')], documents: [{ coll: 'prds' as const, entries: [doc('brief'), doc('secret', 'Internal')] }] };
  source.items[0].body += '\n## Links\n- private-link-sentinel: content/prds/secret.md\n';
  const model = buildPublishedModel(source, { ...options, audience: 'public' });
  expect(model.items).toHaveLength(1);
  expect(model.documents).toHaveLength(1);
  expect(model.boardItems[0].text).toContain('backing-search-sentinel');
  expect(JSON.stringify(model)).not.toContain('private-');
  expect(model.items[0].body).toContain('Visible scope');
  expect(source.items[0].body).toContain('private-section-sentinel');
});

it('rejects duplicate identifiers, colliding document routes and source traversal', () => {
  expect(() => buildPublishedModel({ items: [item(), item()], documents: [] }, options)).toThrow(/duplicate/i);
  expect(() => buildPublishedModel({ items: [], documents: [{ coll: 'prds', entries: [doc('a/brief'), doc('b/brief')] }] }, options)).toThrow(/collision/i);
  expect(() => buildPublishedModel({ items: [{ ...item(), filePath: 'content/items/../../secret.md' }], documents: [] }, options)).toThrow(/path/i);
});

it('handles no content and does not mutate the source ordering', () => {
  expect(buildPublishedModel({ items: [], documents: [] }, options)).toMatchObject({ items: [], documents: [], boardItems: [] });
  const source = { items: [item('STUDIO-002'), item('STUDIO-001')], documents: [] };
  expect(buildPublishedModel(source, options).boardItems.map(x => x.id)).toEqual(['STUDIO-001', 'STUDIO-002']);
  expect(source.items.map(x => x.data.id)).toEqual(['STUDIO-002', 'STUDIO-001']);
});
