// @vitest-environment node
import { expect, it } from 'vitest';
import { historyFromLog } from './itemHistory.server';
it('includes content history before renames and excludes timestamp-only maintenance and pure renames', () => {
  const log = [
    '\x1erenamed\x1f2026-09-06T12:00:00Z\x1fAlice\x1fRename\nrename from old.md\nrename to new.md',
    '\x1emaintenance\x1f2026-09-05T12:00:00Z\x1fAlice\x1fDate\n-updated: 2026-09-01\n+updated: 2026-09-05',
    '\x1eupdated\x1f2026-08-04T12:00:00Z\x1fAlice\x1fImprove\n--- a/old.md\n+++ b/old.md\n-Old\n+New',
    '\x1ecreated\x1f2026-07-01T12:00:00Z\x1fBob\x1fCreate\n+Title\n+updated: 2026-07-01',
  ].join('\n');
  const history = historyFromLog(log);
  expect(history.createdAt).toBe('2026-07-01T12:00:00Z');
  expect(history.updatedAt).toBe('2026-08-04T12:00:00Z');
  expect(history.activityDates).toEqual(['2026-08-04T12:00:00Z', '2026-07-01T12:00:00Z']);
});
