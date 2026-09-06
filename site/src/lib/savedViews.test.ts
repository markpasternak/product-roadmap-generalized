import { describe, it, expect } from 'vitest';
import { readSavedViews, sameViewSelection, snapshotView } from './savedViews';
import { emptyFilters } from './filters';

describe('saved views', () => {
  it('round trips the complete selection, including owner and intentionally empty horizons', () => {
    const filters = { ...emptyFilters(), owner: 'Axel & Billy', product: 'Podcasts & Audiobooks', tags: ['foundation'] };
    const view = snapshotView('Weekly review', filters, [], 'updated');
    expect(readSavedViews(JSON.stringify([view]))).toEqual([view]);
    filters.tags.push('later');
    expect(view.filters.tags).toEqual(['foundation']);
  });
  it('ignores corrupt or obsolete entries while preserving valid views', () => {
    const valid = snapshotView('Now', emptyFilters(), ['Now'], 'manual');
    expect(readSavedViews('not json')).toEqual([]);
    expect(readSavedViews(JSON.stringify([null, { ...valid, horizons: ['Yesterday'] }, valid]))).toEqual([valid]);
  });
  it('recognizes equivalent selections despite field and toggle order or a legacy missing owner', () => {
    const saved = snapshotView('Review', { ...emptyFilters(), stage: ['Building', 'Shaping'], tags: ['a', 'b'] }, ['Now', 'Next'], 'updated');
    const { owner, ...legacyFilters } = saved.filters;
    const current = { filters: { ...legacyFilters, tags: ['b', 'a'], stage: ['Shaping', 'Building'] }, horizons: ['Next', 'Now'], sort: 'updated' as const };
    expect(sameViewSelection(saved, current)).toBe(true);
    expect(sameViewSelection(saved, { ...current, horizons: [] })).toBe(false);
    expect(sameViewSelection(saved, { ...current, filters: { ...current.filters, owner: 'Axel' } })).toBe(false);
    expect(sameViewSelection(saved, { ...current, sort: 'manual' })).toBe(false);
  });
});
