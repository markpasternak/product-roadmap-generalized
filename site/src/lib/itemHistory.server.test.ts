// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { historyFromLog, createItemHistoryReader } from './itemHistory.server';

it('binds each reader to its own checkout instead of process cwd or a prior render', () => {
  const root = mkdtempSync(join(tmpdir(), 'roadmap-history-reader-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init'); git('config', 'user.name', 'Fixture Author'); git('config', 'user.email', 'fixture@example.test');
    mkdirSync(join(root, 'content/items'), { recursive: true });
    writeFileSync(join(root, 'content/items/test.md'), 'First content');
    git('add', '.'); git('commit', '-m', 'First fixture');
    const first = createItemHistoryReader(root);
    expect(first('content/items/test.md').updatedSubject).toBe('First fixture');
    writeFileSync(join(root, 'content/items/test.md'), 'Second content');
    git('add', '.'); git('commit', '-m', 'Second fixture');
    expect(createItemHistoryReader(root)('content/items/test.md').updatedSubject).toBe('Second fixture');
    expect(first('content/items/test.md').updatedSubject).toBe('First fixture');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
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
