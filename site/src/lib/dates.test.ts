import { describe, expect, it } from 'vitest';
import { formatDateOnly, formatDateTime, formatDateTimeOrDate, formatRelativeTime, isoDateOnly, isoDateTime } from './dates';

describe('date display helpers', () => {
  it('formats editorial date-only values without timezone drift', () => {
    expect(formatDateOnly('2026-07-08')).toBe('Jul 8, 2026');
    expect(formatDateOnly(new Date('2026-07-08T00:00:00.000Z'))).toBe('Jul 8, 2026');
    expect(isoDateOnly('2026-07-08T22:10:00.000Z')).toBe('2026-07-08');
  });

  it('formats real instants with time', () => {
    expect(formatDateTime('2026-07-08T07:10:00.000Z', { timeZone: 'UTC', suffix: 'UTC' })).toBe('Jul 8, 2026, 07:10 UTC');
    expect(formatDateTimeOrDate('2026-07-08T07:10:00.000Z', '2026-07-08', { timeZone: 'UTC' })).toBe('Jul 8, 2026, 07:10');
    expect(formatDateTimeOrDate('', '2026-07-08')).toBe('Jul 8, 2026');
    expect(isoDateTime('2026-07-08T07:10:00.000Z')).toBe('2026-07-08T07:10:00.000Z');
  });

  it('formats relative activity times', () => {
    const now = new Date('2026-07-08T12:00:00.000Z').getTime();
    expect(formatRelativeTime(new Date(now - 10_000).toISOString(), now)).toBe('just now');
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago');
    expect(formatRelativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago');
  });
});
