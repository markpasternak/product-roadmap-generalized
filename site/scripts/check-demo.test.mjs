import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('checks an explicit immutable checkout including text attachments', async t => {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-demo-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'content/items/music-app'), { recursive: true });
  await writeFile(join(root, 'content/items/music-app/MUSIC-001.md'), '---\nproduct: Music App\n---\nDemo content\n');
  const run = () => spawnSync(process.execPath, [join(import.meta.dirname, 'check-demo.mjs'), root], { encoding: 'utf8' });
  const clean = run();
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /Demo isolation verified/);
  await mkdir(join(root, 'content/assets/ast_notes/rev_one'), { recursive: true });
  for (const extension of ['TXT', 'CSV']) {
    const path = join(root, `content/assets/ast_notes/rev_one/notes.${extension}`);
    await writeFile(path, 'Internal CM-001 notes');
    const rejected = run();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Non-demo reference/);
    await rm(path);
  }
});
