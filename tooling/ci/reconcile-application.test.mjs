import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import { applicationGroup, reconcileApplication, selectedApplication, installationToken } from '../deploy/reconcile-application.mjs';
import { sha256 } from '../../site/scripts/application-package.mjs';
const profile = { siteUrl: 'https://example.test', base: '/', audience: 'internal', editApi: 'https://api.example.test', canvasBackend: 'true' };
const release = { applicationCommit: 'a'.repeat(40), applicationPackage: 'b'.repeat(64), contentSchema: 1, profile: sha256(JSON.stringify(profile)) };
test('uses a configurable, validated editor group for package access', () => {
  assert.equal(applicationGroup({}), 'roadmap-editor');
  assert.equal(applicationGroup({ ROADMAP_APPLICATION_GROUP: 'roadmap-demo-editor' }), 'roadmap-demo-editor');
  assert.throws(() => applicationGroup({ ROADMAP_APPLICATION_GROUP: '../root' }), /INVALID_APPLICATION_GROUP/);
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-reconcile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pointer = join(root, 'approved.json');
  const previous = { source: 'c'.repeat(40), digest: 'd'.repeat(64), repo: 'example/roadmap' };
  await writeFile(pointer, JSON.stringify(previous));
  let live = { release }, authorized = false, downloads = 0;
  const config = { repo: 'example/roadmap' };
  const args = { config, profile, pointer, groupId: 1, token: async () => 'fixture', readLive: async () => live,
    find: async expected => { authorized = true; return { ...expected, workflowRunId: 123 }; },
    download: async (provenance, token, directory) => { assert(authorized); assert.equal(token, 'fixture'); downloads++; await mkdir(directory); await writeFile(join(directory, 'verified'), 'yes'); return { ...provenance, directory }; },
    verify: async () => ({ source: release.applicationCommit }), setPermissions: async () => {},
    activate: async (path, before, after) => { assert.deepEqual(before, previous); await writeFile(path+'.previous', JSON.stringify(before)); await writeFile(path, JSON.stringify(after)); },
  };
  return { root, pointer, previous, args, read: async () => JSON.parse(await readFile(pointer)), setLive: x => live = x, downloads: () => downloads };
}
test('promotes only after independent CI authorization and preserves the old pointer', async t => {
  const f = await fixture(t);
  assert.equal((await reconcileApplication(f.args)).outcome, 'promoted');
  assert.equal((await f.read()).digest, release.applicationPackage);
  assert.equal((await f.read()).directory, join(f.root, release.applicationPackage));
  assert.deepEqual(JSON.parse(await readFile(f.pointer+'.previous')), f.previous);
  assert(!(await readdir(f.root)).some(p => p.startsWith('.promotion-')));
  assert.equal((await reconcileApplication(f.args)).outcome, 'already_approved');
  assert.equal(f.downloads(), 1);
});
test('first approval bootstraps a missing pointer', async t => {
  const f = await fixture(t);
  await rm(f.pointer);
  f.args.activate = async (path, before, after) => {
    assert.deepEqual(before, {});
    await writeFile(path, JSON.stringify(after));
  };
  assert.equal((await reconcileApplication(f.args)).outcome, 'promoted');
  assert.equal((await f.read()).digest, release.applicationPackage);
});
test('failed authorization or download never replaces the pointer', async t => {
  for (const step of ['find', 'download']) {
    const f = await fixture(t); f.args[step] = async () => { throw Error('UNTRUSTED_APPLICATION_ARTIFACT'); };
    await assert.rejects(reconcileApplication(f.args), /UNTRUSTED/);
    assert.deepEqual(await f.read(), f.previous);
  }
});
test('a changed application or unpublish during download prevents promotion', async t => {
  for (const next of [null, { ...release, applicationCommit: 'e'.repeat(40) }]) {
    const f = await fixture(t), download = f.args.download;
    f.args.download = async (...args) => { const result = await download(...args); f.setLive({ release: next }); return result; };
    await assert.rejects(reconcileApplication(f.args), /ACTIVE_APPLICATION_CHANGED/);
    assert.deepEqual(await f.read(), f.previous);
    assert.deepEqual((await readdir(f.root)).sort(), ['approved.json']);
  }
});
test('content advances under the same application do not block promotion', async t => {
  const f = await fixture(t), download = f.args.download;
  f.args.download = async (...args) => { const result = await download(...args); f.setLive({ release: { ...release, commit: 'f'.repeat(40) } }); return result; };
  assert.equal((await reconcileApplication(f.args)).outcome, 'promoted');
});
test('unpublished and incompatible profiles cannot install code', async t => {
  const f = await fixture(t); f.setLive({ release: null });
  assert.equal((await reconcileApplication(f.args)).outcome, 'unpublished');
  assert.equal(f.downloads(), 0);
  assert.throws(() => selectedApplication({ ...release, profile: 'f'.repeat(64) }, f.args.config.repo, profile));
});
test('a corrupt existing package fails closed without treating missing files as a missing directory', async t => {
  const f = await fixture(t); await mkdir(join(f.root, release.applicationPackage));
  f.args.verify = async () => { throw Object.assign(Error('missing package file'), { code: 'ENOENT' }); };
  await assert.rejects(reconcileApplication(f.args), /missing package file/);
  assert.deepEqual(await f.read(), f.previous);
});

test('installation authentication requests only this repository and read permissions', async t => {
  const f = await fixture(t);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyFile = join(f.root, 'test-key.pem');
  await writeFile(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '456', REPO: 'example/roadmap', GITHUB_APP_PRIVATE_KEY_FILE: keyFile };
  const token = await installationToken(env, async (url, options) => {
    assert.equal(url, 'https://api.github.com/app/installations/456/access_tokens');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { repositories: ['roadmap'], permissions: { actions: 'read', contents: 'read' } });
    const [header, payload, signature] = options.headers.Authorization.slice(7).split('.');
    assert(verifySignature('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')));
    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(claims.iss, '123');
    assert.equal(claims.exp - claims.iat, 330);
    return Response.json({ token: 'test-installation-token' });
  });
  assert.equal(token, 'test-installation-token');
  await assert.rejects(installationToken(env, async () => new Response(null, { status: 403 })), /INSTALLATION_TOKEN_HTTP_403/);
});
