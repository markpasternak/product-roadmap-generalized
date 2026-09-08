import { describe, it, expect } from 'vitest';
import { projectBoard, type BoardChangeset } from './project';
import type { ItemVM } from '../filters';

const item = (over: Partial<ItemVM> = {}): ItemVM => ({
  id: 'TALK-1', title: 'Existing item', product: 'Podcasts & Audiobooks',
  horizon: 'Now', stage: 'Building', owner: 'mark@example.com',
  impact: 'High', effort: 'Low', visibility: 'Internal', order: 1, updated: '2026-07-01',
  tags: ['workflow'], themes: ['one-view'], oneliner: 'An existing card',
  outcome: 'The outcome', sections: [{ heading: 'Why it matters', text: 'because' }],
  editUrl: 'https://github.com/edit/x', links: [], text: 'haystack', href: '/item/TALK-1',
  ...over,
});

const emptyChangeset = (): BoardChangeset => ({ updated: [], created: [], deletedIds: [], reorder: {} });

describe('projectBoard', () => {
  it('returns items unchanged (no pending flags) for an empty changeset', () => {
    const items = [item(), item({ id: 'TALK-2', order: 2 })];
    const out = projectBoard(items, emptyChangeset());
    expect(out).toEqual(items);
    expect(out.every((it) => !('pending' in it) || it.pending === undefined)).toBe(true);
  });

  it('applies a horizon edit so the item renders in its new lane, flagged edited', () => {
    const items = [item()];
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      updated: [{ id: 'TALK-1', frontmatter: { horizon: 'Later' }, body: '' }],
    };
    const [p] = projectBoard(items, cs);
    expect(p.horizon).toBe('Later');
    expect(p.pending).toBe('edited');
  });

  it('applies a stage/order edit in place, flagged edited', () => {
    const items = [item()];
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      updated: [{ id: 'TALK-1', frontmatter: { stage: 'Shipped', order: '5' }, body: '' }],
    };
    const [p] = projectBoard(items, cs);
    expect(p.stage).toBe('Shipped');
    expect(p.order).toBe(5);
    expect(p.pending).toBe('edited');
  });

  it('appends a created entry as a pending:new item using its own temp id', () => {
    const items = [item()];
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      created: [{ id: 'new-1', product: 'Music App', title: 'New idea', frontmatter: { horizon: 'Next' } }],
    };
    const out = projectBoard(items, cs);
    const created = out.find((it) => it.pending === 'new');
    expect(created).toBeDefined();
    expect(created?.product).toBe('Music App');
    expect(created?.title).toBe('New idea');
    expect(created?.horizon).toBe('Next');
    expect(created?.stage).toBe('Discovery');
    expect(created?.id).toBe('new-1');
    expect(created?.tags).toEqual([]);
    expect(created?.oneliner).toBe('');
  });

  it('projects a created entry under the product carried by the changeset (overridden product wins)', () => {
    // Mirrors store.ts's changeset(): a product override lands directly on the created
    // entry's `product` field (not in frontmatter), so a created card projects under its
    // overridden product's lane rather than the one originally passed to addItem.
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      created: [{ id: 'new-1', product: 'Spotify for Artists', title: 'Moved before sync', frontmatter: {} }],
    };
    const [created] = projectBoard([], cs);
    expect(created.product).toBe('Spotify for Artists');
  });

  it('defaults a created entry with no frontmatter to Next/Discovery', () => {
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      created: [{ id: 'new-1', product: 'Music App', title: 'Bare idea', frontmatter: {} }],
    };
    const [created] = projectBoard([], cs);
    expect(created.horizon).toBe('Next');
    expect(created.stage).toBe('Discovery');
  });

  it('splits a tags frontmatter string into an array for a created item', () => {
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      created: [
        { id: 'new-1', product: 'Music App', title: 'Tagged idea', frontmatter: { tags: 'alpha, beta,, gamma ' } },
      ],
    };
    const [created] = projectBoard([], cs);
    expect(created.tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('splits a tags frontmatter string into an array when updating an existing item', () => {
    const items = [item({ tags: ['workflow'] })];
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      updated: [{ id: 'TALK-1', frontmatter: { tags: 'one, two' }, body: '' }],
    };
    const [p] = projectBoard(items, cs);
    expect(p.tags).toEqual(['one', 'two']);
  });

  it('does not produce NaN order for a non-numeric order value', () => {
    const items = [item({ id: 'TALK-1', order: 1 })];
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      updated: [{ id: 'TALK-1', frontmatter: { order: 'not-a-number' }, body: '' }],
    };
    const [p] = projectBoard(items, cs);
    expect(p.order).toBe(1);
    expect(Number.isNaN(p.order)).toBe(false);
  });

  it('keeps a deleted item present, flagged pending:deleted', () => {
    const items = [item(), item({ id: 'TALK-2', order: 2 })];
    const cs: BoardChangeset = { ...emptyChangeset(), deletedIds: ['TALK-1'] };
    const out = projectBoard(items, cs);
    expect(out).toHaveLength(2);
    const deleted = out.find((it) => it.id === 'TALK-1');
    expect(deleted?.pending).toBe('deleted');
  });

  it('applies reorder, setting order to index+1 for listed items', () => {
    const items = [
      item({ id: 'TALK-1', order: 1 }),
      item({ id: 'TALK-2', order: 2 }),
      item({ id: 'TALK-3', order: 3 }),
    ];
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      reorder: { 'Podcasts & Audiobooks': { Now: ['TALK-3', 'TALK-1', 'TALK-2'] } },
    };
    const out = projectBoard(items, cs);
    expect(out.find((it) => it.id === 'TALK-3')?.order).toBe(1);
    expect(out.find((it) => it.id === 'TALK-1')?.order).toBe(2);
    expect(out.find((it) => it.id === 'TALK-2')?.order).toBe(3);
  });

  it('applies a product edit so the item projects under its new product, flagged edited', () => {
    const items = [item({ product: 'Podcasts & Audiobooks' })];
    const cs: BoardChangeset = {
      ...emptyChangeset(),
      updated: [{ id: 'TALK-1', frontmatter: { product: 'Music App' }, body: '' }],
    };
    const [p] = projectBoard(items, cs);
    expect(p.product).toBe('Music App');
    expect(p.pending).toBe('edited');
  });

  it('reorder overrides the order set by an updated-field edit', () => {
    const items = [item({ id: 'TALK-1', order: 1 }), item({ id: 'TALK-2', order: 2 })];
    const cs: BoardChangeset = {
      updated: [{ id: 'TALK-1', frontmatter: { order: '99' }, body: '' }],
      created: [],
      deletedIds: [],
      reorder: { 'Podcasts & Audiobooks': { Now: ['TALK-2', 'TALK-1'] } },
    };
    const out = projectBoard(items, cs);
    expect(out.find((it) => it.id === 'TALK-1')?.order).toBe(2);
    expect(out.find((it) => it.id === 'TALK-2')?.order).toBe(1);
  });
});

it('projects date changes and clearing into the timeline without changing horizons', () => {
  const original=item({startDate:'2026-09-01',endDate:'2026-09-30'});
  const cs=emptyChangeset();
  cs.updated=[{id:original.id,body:'',frontmatter:{startDate:'2026-09-15',endDate:''}}];
  const [changed]=projectBoard([original],cs);
  expect(changed.startDate).toBe('2026-09-15');
  expect(changed.endDate).toBe('');
  expect(changed.horizon).toBe(original.horizon);
  expect(original.endDate).toBe('2026-09-30');
});
