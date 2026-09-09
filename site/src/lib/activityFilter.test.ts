import { describe, expect, it } from 'vitest';
import { activityDate, activityFromParams, activityLabel, activityRange, matchesActivity, parseActivity, writeActivityParams, type ActivityFilter } from './activityFilter';
const range: ActivityFilter = { field: 'updated', period: 'range', from: '2026-08-01', to: '2026-08-31', timeZone: 'Europe/Stockholm' };
describe('activity dates', () => {
  it('matches any published change during a historical range, including its last day', () => {
    expect(matchesActivity({ updatedAt: '2026-09-06T12:00:00Z', updated: '2026-09-06', activityDates: ['2026-09-06T12:00:00Z', '2026-08-31T21:59:59Z'] }, range)).toBe(true);
    expect(matchesActivity({ updated: '2026-09-06', activityDates: ['2026-08-31T22:00:00Z'] }, range)).toBe(false);
  });
  it('uses creation alone for Created, while Updated includes the first publication', () => {
    const item = { createdAt: '2026-07-02T10:00:00Z', updated: '2026-08-04', activityDates: ['2026-07-02T10:00:00Z', '2026-08-04T10:00:00Z'] };
    expect(matchesActivity(item, { ...range, field: 'created' })).toBe(false);
    expect(matchesActivity(item, range)).toBe(true);
  });
  it('calculates calendar days across DST and rolls relative periods forward', () => {
    const filter: ActivityFilter = { field: 'updated', period: 'relative', days: 7, timeZone: 'America/New_York' };
    expect(activityRange(filter, Date.parse('2026-03-09T02:00:00Z'))).toEqual({ from: '2026-03-02', to: '2026-03-08' });
    expect(activityRange(filter, Date.parse('2026-03-10T02:00:00Z'))).toEqual({ from: '2026-03-03', to: '2026-03-09' });
    expect(activityDate('2026-09-06T22:30:00Z', 'Europe/Stockholm')).toBe('2026-09-07');
  });
  it('excludes unknown dates only while filtering and tolerates an older API response', () => {
    expect(matchesActivity({ updated: '' }, null)).toBe(true);
    expect(matchesActivity({ updated: '' }, range)).toBe(false);
    expect(matchesActivity({ updated: '2026-08-04' }, range)).toBe(true);
    expect(matchesActivity({ updated: '2026-08-04', activityDates: [] }, range)).toBe(false);
  });
  it.each([
    { ...range, from: '2026-02-30' }, { ...range, from: '2026-09-02' },
    { ...range, timeZone: 'invalid' }, { ...range, field: 'deleted' },
    { field: 'created', period: 'relative', days: 0, timeZone: 'UTC' },
    { field: 'created', period: 'relative', days: 1.5, timeZone: 'UTC' },
  ])('ignores malformed date filters: %j', value => expect(parseActivity(value)).toBeNull());
  it('round trips rolling and fixed ranges in URLs without converting relative days to fixed dates', () => {
    for (const filter of [range, { field: 'created', period: 'relative', days: 14, timeZone: 'UTC' } as ActivityFilter]) {
      const params = new URLSearchParams(); writeActivityParams(params, filter);
      expect(activityFromParams(params)).toEqual(filter);
    }
    expect(activityFromParams(new URLSearchParams('activity=updated&days=wat'))).toBeNull();
    expect(activityLabel(range)).toBe('Updated · Aug 1, 2026 – Aug 31, 2026');
  });
});


it('uses stable defaults for compact date URLs and keeps legacy links readable', () => {
  const filter: ActivityFilter = { field: 'updated', period: 'relative', days: 7, timeZone: 'UTC' };
  const params = new URLSearchParams();
  writeActivityParams(params, filter);
  expect(params.toString()).toBe('days=7');
  expect(activityFromParams(params)).toEqual(filter);
  expect(activityFromParams(new URLSearchParams('activity=updated&tz=UTC&days=7'))).toEqual(filter);
  expect(activityFromParams(new URLSearchParams())).toBeNull();
  const created = new URLSearchParams();
  writeActivityParams(created, { ...filter, field: 'created', timeZone: 'Europe/Stockholm' });
  expect(created.toString()).toBe('activity=created&days=7&tz=Europe%2FStockholm');
  expect(activityFromParams(created)).toEqual({ ...filter, field: 'created', timeZone: 'Europe/Stockholm' });
});
