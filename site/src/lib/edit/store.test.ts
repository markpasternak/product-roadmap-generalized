import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEditStore, KEY } from './store';

beforeEach(() => localStorage.clear());

describe('edit store', () => {
  it('tracks field edits into a changeset and dirty count', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    expect(s.dirtyCount.value).toBe(1);
    expect(s.changeset().updated).toEqual([{ id: 'TALK-001', frontmatter: { stage: 'Shipped' }, body: '', bodySet: false }]);
  });
  it('reorder + delete + add compose', () => {
    const s = createEditStore();
    s.reorder('Music App', 'Now', ['MUSIC-002', 'MUSIC-001']);
    s.deleteItem('TALK-009');
    s.addItem('Music App', 'New');
    const cs = s.changeset();
    expect(cs.reorder).toEqual({ 'Music App': { Now: ['MUSIC-002', 'MUSIC-001'] } });
    expect(cs.deletedIds).toEqual(['TALK-009']);
    expect(cs.created[0]).toMatchObject({ product: 'Music App', title: 'New' });
  });
  it('carries frontmatter supplied on add through to the changeset', () => {
    const s = createEditStore();
    s.addItem('Music App', 'New', { horizon: 'Now' });
    expect(s.changeset().created[0]?.frontmatter?.horizon).toBe('Now');
  });
  it('persists to localStorage and clears', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'owner', 'Mark');
    const s2 = createEditStore(); // re-hydrates from localStorage
    expect(s2.dirtyCount.value).toBe(1);
    s2.clear();
    expect(createEditStore().dirtyCount.value).toBe(0);
  });
  it('revertItem discards field/body/delete edits for one item without affecting others', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    s.setBody('TALK-001', 'new body');
    s.deleteItem('TALK-001');
    s.setField('TALK-002', 'owner', 'Mark');
    expect(s.dirtyCount.value).toBe(2);
    s.revertItem('TALK-001');
    expect(s.isDirty('TALK-001')).toBe(false);
    expect(s.dirtyCount.value).toBe(1);
    expect(s.changeset().updated).toEqual([{ id: 'TALK-002', frontmatter: { owner: 'Mark' }, body: '', bodySet: false }]);
  });
  it('deleteItem on a real id supersedes a pending field/body edit — no stray update alongside the delete', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    s.setBody('TALK-001', 'new body');
    s.deleteItem('TALK-001');
    const cs = s.changeset();
    expect(cs.deletedIds).toEqual(['TALK-001']);
    expect(cs.updated).toEqual([]);
    expect(s.fieldValue('TALK-001', 'stage')).toBeUndefined();
    expect(s.bodyValue('TALK-001')).toBeUndefined();
  });

  describe('revertField (fix #5)', () => {
    it('removes just the given field, leaving other pending fields on the same item intact', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'stage', 'Shipped');
      s.setField('TALK-001', 'owner', 'Mark');
      s.revertField('TALK-001', 'stage');
      expect(s.fieldValue('TALK-001', 'stage')).toBeUndefined();
      expect(s.fieldValue('TALK-001', 'owner')).toBe('Mark');
      expect(s.changeset().updated).toEqual([{ id: 'TALK-001', frontmatter: { owner: 'Mark' }, body: '', bodySet: false }]);
    });

    it('drops the fields[id] entry entirely once its last field is reverted, clearing isDirty', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'stage', 'Shipped');
      s.revertField('TALK-001', 'stage');
      expect(s.isDirty('TALK-001')).toBe(false);
      expect(s.dirtyCount.value).toBe(0);
    });

    it('leaves a pending body edit on the item untouched', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'stage', 'Shipped');
      s.setBody('TALK-001', 'new body');
      s.revertField('TALK-001', 'stage');
      expect(s.isDirty('TALK-001')).toBe(true);
      expect(s.bodyValue('TALK-001')).toBe('new body');
    });

    it('does not affect other items', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'stage', 'Shipped');
      s.setField('TALK-002', 'owner', 'Mark');
      s.revertField('TALK-001', 'stage');
      expect(s.fieldValue('TALK-002', 'owner')).toBe('Mark');
    });

    it('is a no-op when the item has no pending fields at all', () => {
      const s = createEditStore();
      expect(() => s.revertField('TALK-999', 'stage')).not.toThrow();
      expect(s.dirtyCount.value).toBe(0);
    });

    it('is a no-op when the field itself was never set on an item with other pending fields', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'owner', 'Mark');
      s.revertField('TALK-001', 'stage');
      expect(s.fieldValue('TALK-001', 'owner')).toBe('Mark');
      expect(s.dirtyCount.value).toBe(1);
    });

    it('persists the revert to localStorage', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'stage', 'Shipped');
      s.revertField('TALK-001', 'stage');
      const s2 = createEditStore(); // re-hydrates from localStorage
      expect(s2.isDirty('TALK-001')).toBe(false);
    });
  });

  it('exposes read-back helpers for controlled inputs', () => {
    const s = createEditStore();
    expect(s.fieldValue('TALK-001', 'stage')).toBeUndefined();
    expect(s.bodyValue('TALK-001')).toBeUndefined();
    expect(s.isDeleted('TALK-001')).toBe(false);
    s.setField('TALK-001', 'stage', 'Shipped');
    s.setBody('TALK-001', 'new body');
    s.deleteItem('TALK-001');
    // deleteItem supersedes any pending field/body edit on the same real item (a delete would
    // otherwise ship alongside a stray `updated` entry for the same id) — so both read back as
    // cleared here, while the delete itself sticks.
    expect(s.fieldValue('TALK-001', 'stage')).toBeUndefined();
    expect(s.bodyValue('TALK-001')).toBeUndefined();
    expect(s.isDeleted('TALK-001')).toBe(true);
  });

  describe('created items are editable via a stable temp id', () => {
    it('addItem returns a unique new-<n> id, distinct across successive adds', () => {
      const s = createEditStore();
      const id1 = s.addItem('Music App', 'First');
      const id2 = s.addItem('Music App', 'Second');
      expect(id1).toMatch(/^new-\d+$/);
      expect(id2).toMatch(/^new-\d+$/);
      expect(id1).not.toBe(id2);
    });

    it('keeps temp ids unique after a reload with a persisted created entry', () => {
      const s = createEditStore();
      const id1 = s.addItem('Music App', 'First');
      const s2 = createEditStore(); // re-hydrates from localStorage
      const id2 = s2.addItem('Music App', 'Second');
      expect(id2).not.toBe(id1);
    });

    it('setField on a temp id lands in changeset().created frontmatter, not in updated', () => {
      const s = createEditStore();
      const id = s.addItem('Music App', 'New');
      s.setField(id, 'horizon', 'Now');
      const cs = s.changeset();
      expect(cs.created[0].frontmatter.horizon).toBe('Now');
      expect(cs.updated).toEqual([]);
    });

    it('setBody on a temp id lands as changeset().created[0].body', () => {
      const s = createEditStore();
      const id = s.addItem('Music App', 'New');
      s.setBody(id, 'x');
      expect(s.changeset().created[0].body).toBe('x');
    });

    it('deleteItem on a temp id removes it from created and never touches deletedIds', () => {
      const s = createEditStore();
      const id = s.addItem('Music App', 'New');
      s.setField(id, 'horizon', 'Now');
      s.setBody(id, 'x');
      s.deleteItem(id);
      const cs = s.changeset();
      expect(cs.created).toEqual([]);
      expect(cs.deletedIds).toEqual([]);
      expect(s.dirtyCount.value).toBe(0);
    });

    it('revertItem on a temp id removes it from created and never touches deletedIds', () => {
      const s = createEditStore();
      const id = s.addItem('Music App', 'New');
      s.setField(id, 'horizon', 'Now');
      s.revertItem(id);
      const cs = s.changeset();
      expect(cs.created).toEqual([]);
      expect(cs.deletedIds).toEqual([]);
    });

    it('dirtyCount counts a created-with-edits item once', () => {
      const s = createEditStore();
      const id = s.addItem('Music App', 'New');
      s.setField(id, 'horizon', 'Now');
      s.setBody(id, 'body text');
      expect(s.dirtyCount.value).toBe(1);
    });

    it('a title edited via setField after addItem overrides the created title in the changeset', () => {
      const s = createEditStore();
      const id = s.addItem('Music App', '');
      s.setField(id, 'title', 'My New Thing');
      expect(s.changeset().created[0].title).toBe('My New Thing');
    });

    it('excludes a created item temp id from reorder, keeping real ids in the same lane', () => {
      const s = createEditStore();
      const id = s.addItem('Music App', 'New');
      s.reorder('Music App', 'Now', ['MUSIC-001', id]);
      expect(s.changeset().reorder['Music App'].Now).toEqual(['MUSIC-001']);
    });

    it('a product edited via setField after addItem overrides the created product in the changeset', () => {
      const s = createEditStore();
      const id = s.addItem('Music App', 'X');
      s.setField(id, 'product', 'Spotify for Artists');
      expect(s.changeset().created[0].product).toBe('Spotify for Artists');
    });

    it('seeds a high default order so a new item sorts to the end of its lane', () => {
      const s = createEditStore();
      s.addItem('Music App', 'X');
      expect(s.changeset().created[0].frontmatter.order).toBe('9999');
    });

    it('keeps an explicitly-passed order instead of the default sentinel', () => {
      const s = createEditStore();
      s.addItem('Music App', 'X', { order: '5' });
      expect(s.changeset().created[0].frontmatter.order).toBe('5');
    });
  });

  describe('U10: hasBodyEdits (R11)', () => {
    it('is false with no pending body edits', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'stage', 'Shipped');
      expect(s.hasBodyEdits.value).toBe(false);
    });

    it('is true once a body edit is pending on a real (non-created) item', () => {
      const s = createEditStore();
      s.setBody('TALK-001', 'new body');
      expect(s.hasBodyEdits.value).toBe(true);
    });

    it('is false for a body edit on a not-yet-synced created item (no real base to reconcile against)', () => {
      const s = createEditStore();
      const id = s.addItem('Music App', 'New');
      s.setBody(id, 'draft body');
      expect(s.hasBodyEdits.value).toBe(false);
    });

    it('drops back to false once the body edit is reverted', () => {
      const s = createEditStore();
      s.setBody('TALK-001', 'new body');
      s.revertItem('TALK-001');
      expect(s.hasBodyEdits.value).toBe(false);
    });
  });

  describe('reconcile', () => {
    it('is a no-op on an empty draft', () => {
      const s = createEditStore();
      s.reconcile([]);
      expect(s.dirtyCount.value).toBe(0);
    });

    it('keeps a same-title draft until a publication receipt maps its identity', () => {
      const s = createEditStore();
      s.addItem('Music App', 'My New Thing');
      s.reconcile([{ id: 'MUSIC-010', product: 'Music App', title: 'my new thing' }]);
      expect(s.changeset().created).toHaveLength(1);
    });

    it('keeps a created item whose title does not match any base item', () => {
      const s = createEditStore();
      s.addItem('Music App', 'Still Unpublished');
      s.reconcile([{ id: 'MUSIC-010', product: 'Music App', title: 'Something Else' }]);
      expect(s.changeset().created).toHaveLength(1);
    });

    it('reverts a field edit that already equals the base value', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'horizon', 'Next');
      s.reconcile([{ id: 'TALK-001', horizon: 'Next' }]);
      expect(s.changeset().updated).toEqual([]);
    });

    it('keeps a field edit when the base still has the old value', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'horizon', 'Next');
      s.reconcile([{ id: 'TALK-001', horizon: 'Now' }]);
      expect(s.changeset().updated).toEqual([{ id: 'TALK-001', frontmatter: { horizon: 'Next' }, body: '', bodySet: false }]);
    });

    it('does not revert an item with a pending body edit even if its fields match base', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'horizon', 'Next');
      s.setBody('TALK-001', 'new body');
      s.reconcile([{ id: 'TALK-001', horizon: 'Next' }]);
      expect(s.changeset().updated).toEqual([{ id: 'TALK-001', frontmatter: { horizon: 'Next' }, body: 'new body', bodySet: true }]);
    });

    it('preserves an upstream-deleted item for explicit recovery', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'stage', 'Shipped');
      s.setBody('TALK-001', 'new body');
      // TALK-001 was deleted upstream: it no longer appears in the reconcile base at all.
      s.reconcile([{ id: 'TALK-002' }]);
      expect(s.changeset().updated[0]?.id).toBe('TALK-001');
      expect(s.isDirty('TALK-001')).toBe(true);
      expect(s.dirtyCount.value).toBe(1);
    });

    it('drops a delete whose id is gone from the base', () => {
      const s = createEditStore();
      s.deleteItem('TALK-009');
      s.reconcile([]);
      expect(s.changeset().deletedIds).toEqual([]);
    });

    it('keeps a delete whose id is still present in the base', () => {
      const s = createEditStore();
      s.deleteItem('TALK-009');
      s.reconcile([{ id: 'TALK-009' }]);
      expect(s.changeset().deletedIds).toEqual(['TALK-009']);
    });

    it('treats pending tags as matching the base set regardless of order/spacing', () => {
      const s = createEditStore();
      s.setField('TALK-001', 'tags', 'b, a');
      s.reconcile([{ id: 'TALK-001', tags: ['a', 'b'] }]);
      expect(s.changeset().updated).toEqual([]);
    });

    describe('body reconcile with rawBodies', () => {
      it('reverts a body edit whose value now equals the published rawBody, with no pending fields', () => {
        const s = createEditStore();
        s.setBody('TALK-001', 'published body');
        s.reconcile([{ id: 'TALK-001' }], { 'TALK-001': 'published body' });
        expect(s.changeset().updated).toEqual([]);
      });

      it('reverts a body edit whose value matches rawBody AND whose pending fields match base', () => {
        const s = createEditStore();
        s.setField('TALK-001', 'horizon', 'Next');
        s.setBody('TALK-001', 'published body');
        s.reconcile([{ id: 'TALK-001', horizon: 'Next' }], { 'TALK-001': 'published body' });
        expect(s.changeset().updated).toEqual([]);
      });

      it('keeps a body edit whose value differs from the published rawBody', () => {
        const s = createEditStore();
        s.setBody('TALK-001', 'still-local body');
        s.reconcile([{ id: 'TALK-001' }], { 'TALK-001': 'published body' });
        expect(s.changeset().updated).toEqual([{ id: 'TALK-001', frontmatter: {}, body: 'still-local body', bodySet: true }]);
      });

      it('keeps a body edit whose fields still differ from base even though the body matches', () => {
        const s = createEditStore();
        s.setField('TALK-001', 'horizon', 'Next');
        s.setBody('TALK-001', 'published body');
        s.reconcile([{ id: 'TALK-001', horizon: 'Now' }], { 'TALK-001': 'published body' });
        expect(s.changeset().updated).toEqual([
          { id: 'TALK-001', frontmatter: { horizon: 'Next' }, body: 'published body', bodySet: true },
        ]);
      });

      it('remains conservative (never reverts a body-bearing edit) when rawBodies is omitted', () => {
        const s = createEditStore();
        s.setBody('TALK-001', 'published body');
        s.reconcile([{ id: 'TALK-001' }]);
        expect(s.changeset().updated).toEqual([{ id: 'TALK-001', frontmatter: {}, body: 'published body', bodySet: true }]);
      });

      it('accepts rawBodies as a Map, not just a plain object', () => {
        const s = createEditStore();
        s.setBody('TALK-001', 'published body');
        s.reconcile([{ id: 'TALK-001' }], new Map([['TALK-001', 'published body']]));
        expect(s.changeset().updated).toEqual([]);
      });
    });

    describe('safer create-dup matching', () => {
      it('preserves both independent creates even when a published item has the same title', () => {
        const s = createEditStore();
        s.addItem('Music App', 'Duplicate Title');
        s.addItem('Music App', 'Duplicate Title');
        s.reconcile([{ id: 'MUSIC-010', product: 'Music App', title: 'Duplicate Title' }]);
        expect(s.changeset().created).toHaveLength(2);
      });
    });

    describe('every editable field reconciles', () => {
      it('reverts a product edit that already equals the base product (a published product move)', () => {
        const s = createEditStore();
        s.setField('TALK-001', 'product', 'Music App');
        s.reconcile([{ id: 'TALK-001', product: 'Music App' }]);
        expect(s.changeset().updated).toEqual([]);
      });

      it('keeps a product edit when the base still has the old product', () => {
        const s = createEditStore();
        s.setField('TALK-001', 'product', 'Music App');
        s.reconcile([{ id: 'TALK-001', product: 'Spotify for Artists' }]);
        expect(s.changeset().updated).toEqual([
          { id: 'TALK-001', frontmatter: { product: 'Music App' }, body: '', bodySet: false },
        ]);
      });
    });

    describe('pruning stale reorder ids', () => {
      it('drops an id from a reorder lane once it no longer resolves to that product+horizon in the base', () => {
        const s = createEditStore();
        s.reorder('Music App', 'Now', ['A', 'B', 'GONE']);
        s.reconcile([
          { id: 'A', product: 'Music App', horizon: 'Now' },
          { id: 'B', product: 'Music App', horizon: 'Now' },
        ]);
        expect(s.changeset().reorder).toEqual({ 'Music App': { Now: ['A', 'B'] } });
      });

      it('drops a landed reorder — base already reflects that order (fixes the reload loop)', () => {
        const s = createEditStore();
        s.reorder('Music App', 'Now', ['B', 'A']);
        // After sync + rebuild, the published base carries the reordered `order` values.
        s.reconcile([
          { id: 'A', product: 'Music App', horizon: 'Now', order: 2 },
          { id: 'B', product: 'Music App', horizon: 'Now', order: 1 },
        ]);
        expect(s.changeset().reorder).toEqual({});
        expect(s.dirtyCount.value).toBe(0);
      });

      it('keeps a reorder the base does not yet reflect', () => {
        const s = createEditStore();
        s.reorder('Music App', 'Now', ['B', 'A']);
        // Base still in the OLD order (A before B) — the reorder has not landed.
        s.reconcile([
          { id: 'A', product: 'Music App', horizon: 'Now', order: 1 },
          { id: 'B', product: 'Music App', horizon: 'Now', order: 2 },
        ]);
        expect(s.changeset().reorder).toEqual({ 'Music App': { Now: ['B', 'A'] } });
      });

      it('removes a lane (and empty product entry) once every id in it has vanished', () => {
        const s = createEditStore();
        s.reorder('Music App', 'Now', ['GONE1', 'GONE2']);
        s.reconcile([]);
        expect(s.changeset().reorder).toEqual({});
      });

      it('drops an id whose base item moved to a different horizon in the same product', () => {
        const s = createEditStore();
        s.reorder('Music App', 'Now', ['A', 'B']);
        s.reconcile([
          { id: 'A', product: 'Music App', horizon: 'Now' },
          { id: 'B', product: 'Music App', horizon: 'Later' }, // moved lanes since the reorder was recorded
        ]);
        expect(s.changeset().reorder).toEqual({ 'Music App': { Now: ['A'] } });
      });

      it('drops an id whose base item moved to a different product', () => {
        const s = createEditStore();
        s.reorder('Music App', 'Now', ['A', 'B']);
        s.reconcile([
          { id: 'A', product: 'Music App', horizon: 'Now' },
          { id: 'B', product: 'Spotify for Artists', horizon: 'Now' },
        ]);
        expect(s.changeset().reorder).toEqual({ 'Music App': { Now: ['A'] } });
      });

      it('leaves other lanes and products untouched', () => {
        const s = createEditStore();
        s.reorder('Music App', 'Now', ['A', 'GONE']);
        s.reorder('Music App', 'Later', ['C']);
        s.reorder('Spotify for Artists', 'Now', ['D']);
        s.reconcile([
          { id: 'A', product: 'Music App', horizon: 'Now' },
          { id: 'C', product: 'Music App', horizon: 'Later' },
          { id: 'D', product: 'Spotify for Artists', horizon: 'Now' },
        ]);
        expect(s.changeset().reorder).toEqual({
          'Music App': { Now: ['A'], Later: ['C'] },
          'Spotify for Artists': { Now: ['D'] },
        });
      });

      it('never prunes a created temp id out of the persisted reorder draft', () => {
        const s = createEditStore();
        const id = s.addItem('Music App', 'New');
        s.reorder('Music App', 'Now', ['A', id]);
        s.reconcile([{ id: 'A', product: 'Music App', horizon: 'Now' }]);
        // The temp id survives reconcile (only stripped from the *emitted* changeset, per
        // changeset()'s own reorder handling), so the raw draft still carries it here.
        expect(s.changeset().reorder['Music App'].Now).toEqual(['A']);
      });
    });
  });
});

describe('U2: base-version sha threaded through changeset (R1/R2)', () => {
  it('puts an updated item id in the single baseShas map when a base-version map is supplied', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const cs = s.changeset({ 'TALK-001': 'sha-abc' });
    expect(cs.baseShas).toEqual({ 'TALK-001': 'sha-abc' });
    // The per-item `updated` entry itself stays clean (no embedded baseSha).
    expect(cs.updated).toEqual([{ id: 'TALK-001', frontmatter: { stage: 'Shipped' }, body: '', bodySet: false }]);
  });

  it('accepts the base-version map as a Map, not just a plain object', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    expect(s.changeset(new Map([['TALK-001', 'sha-abc']])).baseShas).toEqual({ 'TALK-001': 'sha-abc' });
  });

  it('omits an updated item from baseShas when the map has no entry for it (not loaded/known)', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    expect(s.changeset({}).baseShas).toEqual({});
  });

  it('omits baseShas entirely when no base-version map is supplied at all — the plain zero-arg shape', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const cs = s.changeset();
    expect(cs.baseShas).toBeUndefined(); // undefined ⇒ dropped by JSON.stringify (server sees no baseShas, omitempty)
    expect(cs.updated).toEqual([{ id: 'TALK-001', frontmatter: { stage: 'Shipped' }, body: '', bodySet: false }]);
  });

  it('never puts a created item in baseShas, even when the map carries an entry for its temp id (creates are exempt)', () => {
    const s = createEditStore();
    const id = s.addItem('Music App', 'New');
    expect(s.changeset({ [id]: 'sha-should-not-apply' }).baseShas ?? {}).not.toHaveProperty(id);
  });

  it('carries a deleted item id in the same baseShas map, keyed by id', () => {
    const s = createEditStore();
    s.deleteItem('TALK-009');
    expect(s.changeset({ 'TALK-009': 'sha-del' }).baseShas).toEqual({ 'TALK-009': 'sha-del' });
  });

  it('omits a deleted id from baseShas when the map has no entry for it', () => {
    const s = createEditStore();
    s.deleteItem('TALK-009');
    expect(s.changeset({}).baseShas).toEqual({});
  });

  it('leaves deletedIds untouched (still a flat id array) regardless of the base-version map', () => {
    const s = createEditStore();
    s.deleteItem('TALK-009');
    expect(s.changeset({ 'TALK-009': 'sha-del' }).deletedIds).toEqual(['TALK-009']);
  });
});

describe('U3: idempotent Sync requestId (R3/KTD3)', () => {
  it('mints a crypto-random requestId and persists it before the caller sends anything', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const id = s.ensureRequestId();
    expect(id).toBeTruthy();
    expect(s.pendingRequestId()).toBe(id);
    // Persisted synchronously — a fresh instance re-hydrated from localStorage already sees it,
    // simulating a crash between persist and the actual network send.
    expect(createEditStore().pendingRequestId()).toBe(id);
  });

  it('reuses the same requestId across repeated calls for the identical (unchanged) changeset', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const id1 = s.ensureRequestId();
    const id2 = s.ensureRequestId();
    expect(id2).toBe(id1);
  });

  it('mints a fresh requestId once the changeset actually changes since the pending id was minted', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const id1 = s.ensureRequestId();
    s.setField('TALK-001', 'stage', 'Building');
    const id2 = s.ensureRequestId();
    expect(id2).not.toBe(id1);
  });

  it('clears the pending requestId on success, so the next call mints a fresh one', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const id1 = s.ensureRequestId();
    s.clearRequestId();
    expect(s.pendingRequestId()).toBeNull();
    const id2 = s.ensureRequestId();
    expect(id2).not.toBe(id1);
  });

  it('mints a fresh id once the ~10-minute TTL bound has passed, even for the identical changeset', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const id1 = s.ensureRequestId();
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    try {
      const id2 = s.ensureRequestId();
      expect(id2).not.toBe(id1);
    } finally {
      Date.now = realNow;
    }
  });

  it('does not affect the plain changeset() shape — requestId lives outside it', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    s.ensureRequestId();
    expect(s.changeset()).not.toHaveProperty('requestId');
  });
});

describe('U4: committed sha persists for deploy-status resume (R5/KTD4)', () => {
  it('is null until a commit is recorded', () => {
    const s = createEditStore();
    expect(s.committedSha.value).toBeNull();
    expect(s.committedSnapshot.value).toBeNull();
  });

  it('records the sha, the snapshot it was sent for, and a timestamp', () => {
    const s = createEditStore();
    const before = Date.now();
    s.recordCommit('abc123', '{"updated":[]}');
    expect(s.committedSha.value).toBe('abc123');
    expect(s.committedSnapshot.value).toBe('{"updated":[]}');
    // committedAt stamps ~now so a reload can age out a stale commit (see Board's resume).
    expect(s.committedAt.value).toBeGreaterThanOrEqual(before);
  });

  it('clearCommit nulls the timestamp too', () => {
    const s = createEditStore();
    s.recordCommit('abc123', '{"updated":[]}');
    s.clearCommit();
    expect(s.committedAt.value).toBeNull();
  });

  it('survives a reload — a fresh store instance re-hydrates it from localStorage', () => {
    const s = createEditStore();
    s.recordCommit('abc123', '{"updated":[]}');
    const s2 = createEditStore();
    expect(s2.committedSha.value).toBe('abc123');
    expect(s2.committedSnapshot.value).toBe('{"updated":[]}');
  });

  it('clearCommit drops both fields, and that survives a reload too', () => {
    const s = createEditStore();
    s.recordCommit('abc123', '{"updated":[]}');
    s.clearCommit();
    expect(s.committedSha.value).toBeNull();
    expect(createEditStore().committedSha.value).toBeNull();
  });

  it('a later recordCommit overwrites an earlier one (e.g. a second Sync before the first went live)', () => {
    const s = createEditStore();
    s.recordCommit('abc123', '{"a":1}');
    s.recordCommit('def456', '{"b":2}');
    expect(s.committedSha.value).toBe('def456');
    expect(s.committedSnapshot.value).toBe('{"b":2}');
  });
});

describe('cross-tab draft sync', () => {
  it('preserves this tab when another tab writes a competing draft', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    expect(s.dirtyCount.value).toBe(1);

    // Simulate another tab writing a different draft directly to the shared localStorage,
    // then firing the `storage` event this tab's listener reacts to (real cross-tab storage
    // events never fire in the writing tab itself, so we dispatch it manually here).
    const otherDraft = {
      fields: { 'TALK-002': { owner: 'Mark' } },
      bodies: {},
      created: [],
      deleted: [],
      reorder: {},
    };
    localStorage.setItem(KEY, JSON.stringify(otherDraft));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: JSON.stringify(otherDraft) }));

    expect(s.dirtyCount.value).toBe(1);
    expect(s.changeset().updated).toEqual([{ id: 'TALK-001', frontmatter: { stage: 'Shipped' }, body: '', bodySet: false }]);
  });

  it('ignores a storage event for an unrelated key', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'some-other-key', newValue: JSON.stringify({ unrelated: true }) }),
    );

    expect(s.dirtyCount.value).toBe(1);
    expect(s.changeset().updated).toEqual([{ id: 'TALK-001', frontmatter: { stage: 'Shipped' }, body: '', bodySet: false }]);
    expect(s.crossTabChanged.value).toBe(false);
  });
});

describe('U6: durable-draft warning (R7)', () => {
  it('a setItem failure sets persistFailed, does not throw, and the edit is still readable in-session', () => {
    const s = createEditStore();
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    try {
      expect(() => s.setField('TALK-001', 'stage', 'Shipped')).not.toThrow();
      expect(s.persistFailed.value).toBe(true);
      // The mutation happened on the in-memory draft before persist() was ever called —
      // still fully readable/editable this session even though it isn't durable.
      expect(s.fieldValue('TALK-001', 'stage')).toBe('Shipped');
      expect(s.dirtyCount.value).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('clears persistFailed the moment a later persist actually succeeds', () => {
    const s = createEditStore();
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    s.setField('TALK-001', 'stage', 'Shipped');
    expect(s.persistFailed.value).toBe(true);
    spy.mockRestore();

    s.setField('TALK-001', 'owner', 'Mark');
    expect(s.persistFailed.value).toBe(false);
  });

  it('starts false for a fresh store', () => {
    expect(createEditStore().persistFailed.value).toBe(false);
  });
});

describe('U9: cross-tab-change flag (R10)', () => {
  it('sets crossTabChanged when another tab writes a genuinely different draft', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    expect(s.crossTabChanged.value).toBe(false);

    const otherDraft = {
      fields: { 'TALK-002': { owner: 'Mark' } },
      bodies: {},
      created: [],
      deleted: [],
      reorder: {},
    };
    localStorage.setItem(KEY, JSON.stringify(otherDraft));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: JSON.stringify(otherDraft) }));

    expect(s.crossTabChanged.value).toBe(true);
  });

  it('does not set crossTabChanged for an identical-draft storage event', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const sameJson = localStorage.getItem(KEY)!;

    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: sameJson }));

    expect(s.crossTabChanged.value).toBe(false);
  });

  it('dismissCrossTabChanged clears the flag without touching the draft', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const otherDraft = { fields: {}, bodies: {}, created: [], deleted: [], reorder: {} };
    localStorage.setItem(KEY, JSON.stringify(otherDraft));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: JSON.stringify(otherDraft) }));
    expect(s.crossTabChanged.value).toBe(true);

    s.dismissCrossTabChanged();
    expect(s.crossTabChanged.value).toBe(false);
  });

  it('clear() also resets crossTabChanged — a discarded draft leaves no stale notice behind', () => {
    const s = createEditStore();
    s.setField('TALK-001', 'stage', 'Shipped');
    const otherDraft = { fields: {}, bodies: {}, created: [], deleted: [], reorder: {} };
    localStorage.setItem(KEY, JSON.stringify(otherDraft));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: JSON.stringify(otherDraft) }));
    expect(s.crossTabChanged.value).toBe(true);

    s.clear();
    expect(s.crossTabChanged.value).toBe(false);
  });
});
