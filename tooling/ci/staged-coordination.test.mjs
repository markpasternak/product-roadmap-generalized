import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseIdentity, preflight, publishStaged, verify, configFromEnv } from '../deploy/coordinate.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const commit = 'a'.repeat(40), application = { source: 'b'.repeat(40), digest: 'c'.repeat(64) };
const profile = { siteUrl: 'https://example.test', base: '/', audience: 'internal', editApi: 'https://edit.example.test', canvasBackend: 'true' };
const identity = { repo: 'example/roadmap', commit, application, profile };
const snapshot = Buffer.from('{"items":[]}');
const release = { commit, applicationCommit: application.source, applicationPackage: application.digest, profile: hash(JSON.stringify(profile)), contentSchema: 1,
  content: { path: `content/${hash(snapshot)}.json`, size: snapshot.length, hash: hash(snapshot) } };

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-staged-coordinator-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = new Map([['index.html', Buffer.from('<h1>Roadmap</h1>')], ['version.json', Buffer.from(JSON.stringify(release))], [release.content.path, snapshot]]);
  const manifest = [...files].map(([path, bytes]) => ({ path, hash: hash(bytes), size: bytes.length }));
  for (const [path, bytes] of files) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), bytes); }
  let token = 'before', current = false, finalized = 0, source = commit;
  const releaseId = releaseIdentity(identity);
  const result = () => ({ outcome: finalized > 1 ? 'already_current' : 'published', releaseId, versionId: 'v2', publicationToken: token });
  const calls = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture');
    const url = new URL(req.url, 'http://localhost');
    calls.push(url.pathname);
    res.setHeader('Content-Type', 'application/json');
    const json = body => res.end(JSON.stringify(body));
    if (req.method === 'POST' && url.pathname.endsWith('/uploads')) {
      let bytes = ''; for await (const chunk of req) bytes += chunk;
      const body = JSON.parse(bytes);
      assert.deepEqual(body.manifest, manifest);
      assert.equal(body.expectedPublicationToken, 'before');
      if (current) return json({ ...result(), outcome: 'already_current' });
      return json({ uploadId: 'up_one', missingHashes: [] });
    }
    if (url.pathname.endsWith('/finalize')) {
      finalized++; current = true; token = 'after';
      if (options.sourceAfter) source = 'd'.repeat(40);
      if (options.lost) return req.socket.destroy();
      return json(result());
    }
    if (url.searchParams.has('path')) {
      const path = url.searchParams.get('path');
      return res.end(options.badSnapshot && path === release.content.path ? 'bad' : files.get(path));
    }
    if (url.pathname.endsWith('/files')) {
      const exposed = options.extra ? [...manifest, { path: 'stale.html', hash: hash('old'), size: 3 }] : manifest;
      return json({ version: 2, fileCount: exposed.length, files: exposed });
    }
    return json({ publicationState: 'published', publicationToken: token, currentVersionId: current ? 'v2' : 'v1',
      currentVersion: { id: current ? 'v2' : 'v1', number: current ? 2 : 1, releaseId: current ? releaseId : 'previous' } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { root, manifest, calls, config: { ...identity, latest: async () => source, token: 'fixture', api: `http://127.0.0.1:${server.address().port}/v1/canvases/test` },
    setCurrent: () => { current = true; token = 'after'; }, finalized: () => finalized };
}

test('application package identity participates in the release shared by both publishers', () => {
  const id = releaseIdentity(identity);
  assert.match(id, /^roadmap-v2-[a-f0-9]{64}$/);
  assert.notEqual(id, releaseIdentity({ ...identity, application: { ...application, digest: 'd'.repeat(64) } }));
  assert.notEqual(id, releaseIdentity({ ...identity, application: { ...application, source: 'e'.repeat(40) } }));
  assert.throws(() => releaseIdentity({ ...identity, application: { source: application.source } }), /INVALID_RELEASE/);
});
test('real HTTP staged coordination proves the complete manifest, snapshot bytes and source freshness', async t => {
  const f = await fixture(t);
  const proof = await publishStaged(f.config, await preflight(f.config), { release, manifest: f.manifest }, f.root);
  assert.equal(proof.verification, 'complete-manifest-and-snapshot');
  assert.equal(proof.verifiedFiles, f.manifest.length);
  assert.equal(proof.outcome, 'published');
  assert.equal(f.finalized(), 1);
});
test('lost finalize reply still requires complete readback without retrying activation', async t => {
  const f = await fixture(t, { lost: true });
  const proof = await publishStaged(f.config, await preflight(f.config), { release, manifest: f.manifest }, f.root);
  assert.equal(proof.outcome, 'already_current');
  assert.equal(f.finalized(), 1);
});
for (const [options, error] of [[{ extra: true }, /MANIFEST_MISMATCH/], [{ badSnapshot: true }, /SNAPSHOT_HASH_MISMATCH/], [{ sourceAfter: true }, /SOURCE_SUPERSEDED/]]) {
  test(`rejects false live proof: ${JSON.stringify(options)}`, async t => {
    const f = await fixture(t, options);
    await assert.rejects(publishStaged(f.config, await preflight(f.config), { release, manifest: f.manifest }, f.root), error);
  });
}
test('already-current preflight verifies application identity and the served snapshot without preparing', async t => {
  const f = await fixture(t); f.setCurrent();
  assert.equal((await preflight(f.config)).alreadyCurrent, true);
  assert.equal(f.finalized(), 0);
  await assert.rejects(verify({ ...f.config, application: { ...application, digest: 'd'.repeat(64) } }), /RELEASE_NOT_CURRENT/);
});
test('local reuse cannot replace a different live application after fallback or rollback', async t => {
  const f = await fixture(t); f.setCurrent();
  assert.equal((await preflight({ ...f.config, reuseApplication: true })).alreadyCurrent, true);
  await assert.rejects(preflight({ ...f.config, reuseApplication: true, application: { ...application, digest: 'd'.repeat(64) } }), /LIVE_APPLICATION_MISMATCH/);
  assert.equal(f.finalized(), 0);
});
test('full-build identity binding retains the token observed before compilation', async t => {
  const f = await fixture(t);
  const observed = { publicationState: 'published', publicationToken: 'before', currentVersionId: 'v1', currentVersion: { id: 'v1', number: 1, releaseId: 'previous' } };
  f.setCurrent(); // Another publisher changed Canvas while compilation ran.
  const intent = await preflight(f.config, { observed });
  assert.equal(intent.expectedPublicationToken, 'before');
  assert.equal(intent.alreadyCurrent, false);
});

test('same-release winner during preparation is verified without a second activation', async t => {
  const f = await fixture(t);
  const intent = await preflight(f.config);
  f.setCurrent();
  const proof = await publishStaged(f.config, intent, { release, manifest: f.manifest }, f.root);
  assert.equal(proof.outcome, 'already_current');
  assert.equal(proof.verification, 'complete-manifest-and-snapshot');
  assert.equal(f.finalized(), 0);
});

test('publisher normalizes the same non-root profile as the application compiler', () => {
  const env = { GITHUB_REPOSITORY: identity.repo, GITHUB_SHA: commit, CANVAS_DROP_TOKEN: 'fixture', CANVAS_API_URL: 'https://example.test/v1/canvases/test', SITE_URL: profile.siteUrl, SITE_BASE: '/roadmap', SITE_AUDIENCE: 'internal', PUBLIC_EDIT_API: profile.editApi, PUBLIC_CANVAS_BACKEND: 'true' };
  assert.equal(configFromEnv(env).profile.base, '/roadmap/');
  assert.equal(releaseIdentity(configFromEnv(env)), releaseIdentity(configFromEnv({ ...env, SITE_BASE: '/roadmap/' })));
  assert.throws(() => configFromEnv({ ...env, SITE_BASE: undefined }), /INVALID_RELEASE_INPUT/);
});
