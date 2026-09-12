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
  it('round trips reverse lane order and defaults legacy views to canonical order', () => {
    const reversed = snapshotView('Reverse', emptyFilters(), ['Now'], 'manual', true);
    expect(readSavedViews(JSON.stringify([reversed]))[0].reverseLanes).toBe(true);
    const { reverseLanes, ...legacy } = reversed;
    expect(readSavedViews(JSON.stringify([legacy]))[0].reverseLanes).toBe(false);
    expect(sameViewSelection(reversed, { ...reversed, reverseLanes: false })).toBe(false);
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

it('migrates obsolete resource selections and preserves rolling activity filters', () => {
  const activity = { field: 'updated' as const, period: 'relative' as const, days: 14, timeZone: 'Europe/Stockholm' };
  const saved = snapshotView('Recent', { ...emptyFilters(), assets: ['asset:any'], activity }, ['Now'], 'updated');
  expect(saved.filters.assets).toEqual([]);
  expect(readSavedViews(JSON.stringify([saved]))[0].filters.activity).toEqual(activity);
  expect(sameViewSelection(saved, { ...saved, filters: { ...saved.filters, activity: { ...activity, days: 30 } } })).toBe(false);
  expect(readSavedViews(JSON.stringify([{ ...saved, filters: { ...saved.filters, activity: { ...activity, days: -1 } } }]))[0].filters.activity).toBeNull();
});

it('preserves timeline layout, grouping and range without changing filters', () => {
  const filters = { ...emptyFilters(), layout: 'timeline' as const, timeline: { group: 'tag' as const, scale: 'quarters' as const, anchor: '2026-09-01', fit: false } };
  const saved = snapshotView('Planning', filters, ['Now','Next'], 'updated');
  expect(readSavedViews(JSON.stringify([saved]))[0]).toEqual(saved);
  expect(sameViewSelection(saved, { ...saved, filters: {...filters, layout:'board'} })).toBe(false);
});
