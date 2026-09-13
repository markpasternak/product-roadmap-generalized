import { describe, expect, it } from 'vitest';
import { pageSeed } from './seed';
import { buildPublishedModel, type PublishedContent } from './model';
import { EMPTY_ITEM_HISTORY } from '../itemHistory';
import { itemSchema } from '../schema';

const model: PublishedContent = { ...buildPublishedModel({
  items: ['A', 'B', 'C', 'D'].map(id => ({ id, data: itemSchema.parse({ id, title: id, product: 'Studio', horizon: 'Now', stage: 'Building', owner: 'Owner', visibility: 'Internal', order: id.charCodeAt(0) }), body: `## Context\n${id}` })),
  documents: [],
}, { base: '/', audience: 'internal', historyForPath: () => EMPTY_ITEM_HISTORY }), audience: 'internal', documentHtml: {} };

describe('page seed', () => {
  it('keeps a board usable without embedding unrelated document or source bodies', () => {
    const seed = pageSeed(model, '/', '');
    expect(seed.boardItems).toEqual(model.boardItems);
    expect(seed.items).toEqual([]);
    expect(seed.documents).toEqual([]);
  });
  it('preserves current item and immediate sibling navigation only', () => {
    const seed = pageSeed(model, '/', 'item/B');
    expect(seed.items.map(item => item.data.id)).toEqual(['B']);
    expect(seed.boardItems.map(item => item.id)).toEqual(['A', 'B', 'C']);
    expect(pageSeed(model, '/', 'item/removed').boardItems).toEqual([]);
    expect(model.items).toHaveLength(4);
  });
});
