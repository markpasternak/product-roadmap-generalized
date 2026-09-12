import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildHistorySnapshot, readHistoryLog } from './build-item-history.mjs';

test('incremental history equals fresh Git history through edits, reverts, renames and corrupt caches', () => {
  const root = mkdtempSync(join(tmpdir(), 'roadmap-history-test-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.test');
    mkdirSync(join(root, 'content/items'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'site/.cache/\n');
    const file = 'content/items/A.md',
      other = 'content/items/B.md';
    writeFileSync(join(root, file), 'title: First\n');
    writeFileSync(join(root, other), 'title: Other\n');
    git('add', '.');
    git('commit', '-qm', 'Create');
    const cold = buildHistorySnapshot(root);
    assert.equal(cold.refreshed, 2);
    assert.equal(buildHistorySnapshot(root).refreshed, 0);
    writeFileSync(join(root, file), 'title: Second\n');
    git('add', '.');
    git('commit', '-qm', 'Edit');
    writeFileSync(join(root, file), 'title: First\n');
    git('add', '.');
    git('commit', '-qm', 'Revert');
    const update = buildHistorySnapshot(root);
    assert.equal(update.refreshed, 1);
    assert.equal(update.snapshot.logs[file], readHistoryLog(root, file));
    const renamed = 'content/items/Renamed.md';
    renameSync(join(root, file), join(root, renamed));
    git('add', '.');
    git('commit', '-qm', 'Rename');
    const rename = buildHistorySnapshot(root);
    assert.equal(rename.refreshed, 1);
    assert.equal(rename.snapshot.logs[file], undefined);
    assert.equal(rename.snapshot.logs[renamed], readHistoryLog(root, renamed));
    writeFileSync(join(root, 'site/.cache/item-history.json'), '{broken');
    assert.equal(buildHistorySnapshot(root).refreshed, 2);
    const base = git('rev-parse', 'HEAD');
    git('switch', '-qc', 'side');
    writeFileSync(join(root, other), 'title: Changed on branch\n');
    git('add', '.');
    git('commit', '-qm', 'Branch edit');
    buildHistorySnapshot(root);
    git('switch', '-qc', 'trunk', base);
    writeFileSync(join(root, renamed), 'title: Changed on trunk\n');
    git('add', '.');
    git('commit', '-qm', 'Trunk edit');
    // A cache from a divergent branch cannot be reused.
    assert.equal(buildHistorySnapshot(root).refreshed, 2);
    git('merge', '--no-ff', '-qm', 'Merge side', 'side');
    const merged = buildHistorySnapshot(root);
    for (const path of [other, renamed])
      assert.equal(merged.snapshot.logs[path], readHistoryLog(root, path));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
