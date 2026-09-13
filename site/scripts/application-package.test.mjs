import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyApplicationPackage } from './application-package.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-package-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [];
  for (const path of ['private/renderer.mjs', 'private/template.html', 'public/.vite/manifest.json']) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), 'fixture');
    files.push({ path, hash: hash('fixture'), size: 7 });
  }
  const manifest = { type: 'module', protocol: 1, source: 'a'.repeat(40), base: '/', audience: 'internal',
    nodeMajor: Number(process.versions.node.split('.')[0]), dependencyDigest: 'b'.repeat(64),
    profile: { siteUrl: 'https://example.test', base: '/', audience: 'internal', editApi: '', canvasBackend: '' }, files };
  const save = async () => { const bytes = JSON.stringify(manifest); await writeFile(join(root, 'package.json'), bytes); return hash(bytes); };
  return { root, manifest, save, digest: await save() };
}

test('requires independently supplied digest before trusting executable files', async t => {
  const f = await fixture(t);
  assert.equal((await verifyApplicationPackage(f.root, { digest: f.digest })).source, f.manifest.source);
  await assert.rejects(verifyApplicationPackage(f.root, {}), /digest/i);
  await assert.rejects(verifyApplicationPackage(f.root, { digest: 'c'.repeat(64) }), /digest/i);
  f.manifest.source = 'd'.repeat(40);
  await f.save();
  await assert.rejects(verifyApplicationPackage(f.root, { digest: f.digest }), /digest/i);
});

test('rejects tampering, unlisted files and symlinks', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'private/renderer.mjs'), 'tampered');
  await assert.rejects(verifyApplicationPackage(f.root, { digest: f.digest }), /checksum/i);
  await writeFile(join(f.root, 'private/renderer.mjs'), 'fixture');
  await writeFile(join(f.root, 'private/unlisted.mjs'), 'unlisted');
  await assert.rejects(verifyApplicationPackage(f.root, { digest: f.digest }), /inventory/i);
  await rm(join(f.root, 'private/unlisted.mjs'));
  await rm(join(f.root, 'private/template.html'));
  await symlink('renderer.mjs', join(f.root, 'private/template.html'));
  await assert.rejects(verifyApplicationPackage(f.root, { digest: f.digest }), /regular|symbolic/i);
});

test('rejects profile, runtime, traversal and case-collision mismatches', async t => {
  const f = await fixture(t);
  await assert.rejects(verifyApplicationPackage(f.root, { digest: f.digest, profile: { ...f.manifest.profile, audience: 'public' } }), /profile/i);
  f.manifest.nodeMajor++;
  await assert.rejects(verifyApplicationPackage(f.root, { digest: await f.save() }), /runtime/i);
  f.manifest.nodeMajor--;
  for (const path of ['private/../outside', 'private/back\\slash', 'private/renderer.mjs', 'PRIVATE/renderer.mjs']) {
    f.manifest.files.push({ path, hash: hash('fixture'), size: 7 });
    await assert.rejects(verifyApplicationPackage(f.root, { digest: await f.save() }), /path|collision/i);
    f.manifest.files.pop();
  }
  assert.equal((await readFile(join(f.root, 'private/renderer.mjs'), 'utf8')), 'fixture');
});
