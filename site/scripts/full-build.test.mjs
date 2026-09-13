import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installBuildOutput } from './full-build.mjs';

test('replaces complete build output, removing stale routes without exposing private files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-full-build-'));
  try {
    const candidate = join(root, 'attempt/candidate');
    await mkdir(join(candidate, 'public'), { recursive: true });
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist/removed.html'), 'old');
    await writeFile(join(candidate, 'public/index.html'), 'new');
    await writeFile(join(candidate, 'candidate.json'), 'private');
    await installBuildOutput(root, candidate);
    assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'new');
    await assert.rejects(readFile(join(root, 'dist/removed.html')));
    await assert.rejects(readFile(join(root, 'dist/candidate.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects a missing candidate or symlinked destination without changing existing output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-full-build-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist/index.html'), 'existing');
    await assert.rejects(installBuildOutput(root, join(root, 'missing')));
    assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'existing');
    await mkdir(join(root, 'other'));
    await symlink(join(root, 'dist'), join(root, 'other/dist'));
    await mkdir(join(root, 'candidate/public'), { recursive: true });
    await writeFile(join(root, 'candidate/public/index.html'), 'replacement');
    await assert.rejects(installBuildOutput(join(root, 'other'), join(root, 'candidate')), /Invalid build destination/);
    assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), 'existing');
  } finally { await rm(root, { recursive: true, force: true }); }
});
