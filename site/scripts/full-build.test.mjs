import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installBuildOutput, retireBuildAttempt } from './full-build.mjs';

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

test('retires only the previous receipt-owned attempt, never current, unrelated or linked directories', async t => {
  const site = await mkdtemp(join(tmpdir(), 'roadmap-build-retention-'));
  t.after(() => rm(site, { recursive: true, force: true }));
  await mkdir(join(site, '.cache'));
  const old = await mkdtemp(join(site, '.cache/full-build-'));
  const current = await mkdtemp(join(site, '.cache/full-build-'));
  const other = await mkdtemp(join(site, '.cache/full-build-'));
  const receipt = attempt => ({ application: join(attempt, 'application'), candidate: join(attempt, 'candidate'), output: join(site, 'dist') });
  for (const dir of [old, current, other]) await writeFile(join(dir, 'proof'), 'keep');
  await retireBuildAttempt(site, receipt(current), current);
  await retireBuildAttempt(site, { ...receipt(other), candidate: join(old, 'candidate') }, current);
  assert.equal(await readFile(join(current, 'proof'), 'utf8'), 'keep');
  assert.equal(await readFile(join(other, 'proof'), 'utf8'), 'keep');
  await retireBuildAttempt(site, receipt(old), current);
  await assert.rejects(readFile(join(old, 'proof')));
  const linked = join(site, '.cache/full-build-linked');
  await symlink(other, linked);
  await retireBuildAttempt(site, receipt(linked), current);
  assert.equal(await readFile(join(other, 'proof'), 'utf8'), 'keep');
  await retireBuildAttempt(site, receipt(site), current);
  assert.equal(await readFile(join(current, 'proof'), 'utf8'), 'keep');
});
