import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseIdentity, preflight, publish, verify } from '../deploy/coordinate.mjs';

const sha = 'a'.repeat(40);
const profile = { siteUrl: 'https://example.test', base: '/', audience: 'internal', editApi: 'https://api.example.test', canvasBackend: 'true' };
const identity = { repo: 'example/roadmap', commit: sha, profile };
const releaseId = releaseIdentity(identity);
const bytes = Buffer.from(JSON.stringify({ commit: sha }));
const hash = b => createHash('sha256').update(b).digest('hex');

async function fixture(t, options = {}) {
  const calls = [];
  let state = { publicationState: 'published', publicationToken: 'before', currentVersion: { id: 'v1', number: 1, releaseId: 'old' }, currentVersionId: 'v1' };
  let puts = 0;
  const current = () => { state = { ...state, publicationToken: 'after', currentVersionId: 'v2', currentVersion: { id: 'v2', number: 2, releaseId } }; };
  const server = createServer(async (req, res) => {
    calls.push(req.url);
    assert.equal(req.headers.authorization, 'Bearer secret');
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'PUT') {
      puts++;
      let body = Buffer.alloc(0);
      for await (const chunk of req) body = Buffer.concat([body, chunk]);
      assert.equal(body.toString(), 'zip-bytes');
      assert.equal(url.searchParams.get('releaseId'), releaseId);
      assert.equal(url.searchParams.get('expectedPublicationToken'), 'before');
      if (options.conflict) { res.statusCode = 409; res.end(JSON.stringify({ code: options.conflict })); return; }
      const outcome = state.currentVersion.releaseId === releaseId ? 'already_current' : 'published';
      current();
      if (options.lostResponse) { req.socket.destroy(); return; }
      res.end(JSON.stringify({ outcome, releaseId, versionId: 'v2', publicationToken: 'after' }));
    } else if (url.searchParams.has('path')) res.end(bytes);
    else if (url.pathname.endsWith('/files')) {
      if (options.changeDuringVerification) state.publicationToken = 'changed-during-readback';
      res.end(JSON.stringify({ version: state.currentVersion.number, fileCount: 1, files: [{ path: 'version.json', hash: hash(bytes), size: bytes.length }] }));
    }
    else res.end(JSON.stringify(options.legacy ? { currentVersionId: 'v1' } : state));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const dir = await mkdtemp(join(tmpdir(), 'roadmap-coordinate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'version.json'), bytes);
  await writeFile(join(dir, 'site.zip'), 'zip-bytes');
  const config = { ...identity, token: 'secret', api: `http://127.0.0.1:${server.address().port}/v1/canvases/test`, latest: async () => sha };
  return { config, calls, dir, current, state: () => state, puts: () => puts };
}

test('release identity is stable across callers and changes with every effective input', () => {
  assert.equal(releaseIdentity({ ...identity, profile: { ...profile } }), releaseId);
  assert.match(releaseId, /^roadmap-v1-[a-f0-9]{64}$/);
  for (const key of Object.keys(profile)) assert.notEqual(releaseIdentity({ ...identity, profile: { ...profile, [key]: `${profile[key]}changed` } }), releaseId);
  assert.notEqual(releaseIdentity({ ...identity, commit: 'b'.repeat(40) }), releaseId);
  assert.notEqual(releaseIdentity({ ...identity, repo: 'other/roadmap' }), releaseId);
});

test('captures token before work, conditionally uploads once, and verifies live identity', async t => {
  const f = await fixture(t);
  const intent = await preflight(f.config);
  assert.equal(intent.expectedPublicationToken, 'before');
  assert.equal(intent.alreadyCurrent, false);
  const report = await publish(f.config, intent, join(f.dir, 'site.zip'));
  assert.equal(report.releaseId, releaseId);
  assert.equal(report.outcome, 'published');
  assert.equal(report.verification, 'release-identity');
  assert.equal(f.puts(), 1);
});

test('already-current preflight avoids upload and rechecks live state at completion', async t => {
  const f = await fixture(t); f.current();
  const intent = await preflight(f.config);
  assert.equal(intent.alreadyCurrent, true);
  const report = await publish(f.config, intent, '/does-not-exist');
  assert.equal(report.outcome, 'already_current');
  assert.equal(f.puts(), 0);
  f.state().publicationToken = 'rollback'; f.state().currentVersion.releaseId = 'other';
  await assert.rejects(publish(f.config, intent, '/does-not-exist'), /NOT_CURRENT/);
  assert.equal(f.puts(), 0);
});

for (const code of ['PUBLICATION_CHANGED', 'RELEASE_NOT_CURRENT']) test(`${code} never refreshes the token and retries`, async t => {
  const f = await fixture(t, { conflict: code });
  const intent = await preflight(f.config);
  f.state().publicationToken = 'another-publication';
  await assert.rejects(publish(f.config, intent, join(f.dir, 'site.zip')), new RegExp(code));
  assert.equal(f.puts(), 1);
});

test('another publisher finishing this release during our build avoids a second ZIP', async t => {
  const f = await fixture(t);
  const intent = await preflight(f.config);
  f.current();
  assert.equal((await publish(f.config, intent, '/no-zip-needed')).outcome, 'already_current');
  assert.equal(f.puts(), 0);
});

test('two uploads racing with the same release accept published and already_current', async t => {
  const f = await fixture(t);
  let arrivals = 0;
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const callers = [0, 1].map(() => {
    let reads = 0;
    return { ...f.config, latest: async () => {
      if (++reads === 3) {
        if (++arrivals === 2) release();
        await ready; // Both have completed the pre-upload GET before either PUT.
      }
      return sha;
    } };
  });
  const intents = await Promise.all(callers.map(preflight));
  const reports = await Promise.all(callers.map((config, i) => publish(config, intents[i], join(f.dir, 'site.zip'))));
  assert.deepEqual(reports.map(report => report.outcome).sort(), ['already_current', 'published']);
  assert.equal(f.puts(), 2);
  assert.equal(new Set(reports.map(report => report.versionId)).size, 1);
});

test('readback spanning a pointer mutation cannot produce a verified receipt', async t => {
  const f = await fixture(t, { changeDuringVerification: true }); f.current();
  await assert.rejects(verify(f.config), /PUBLICATION_CHANGED_DURING_VERIFICATION/);
});

test('no credentials can be sent to an insecure or credential-bearing endpoint', async t => {
  const f = await fixture(t);
  for (const api of ['http://example.com/v1/canvases/test', 'https://secret@example.com/v1/canvases/test', f.config.api + '?token=secret']) {
    await assert.rejects(preflight({ ...f.config, api }), /INVALID_CANVAS_URL/);
  }
  assert.equal(f.calls.length, 0);
});

test('lost upload response accepts only authenticated proof of our live release', async t => {
  const f = await fixture(t, { lostResponse: true });
  const report = await publish(f.config, await preflight(f.config), join(f.dir, 'site.zip'));
  assert.equal(report.outcome, 'already_current');
  assert.equal(f.puts(), 1);
});

test('old Canvas API and superseded source fail closed without an upload', async t => {
  const legacy = await fixture(t, { legacy: true });
  await assert.rejects(preflight(legacy.config), /COORDINATION_UNAVAILABLE/);
  assert.equal(legacy.puts(), 0);
  const f = await fixture(t);
  const intent = await preflight(f.config);
  f.config.latest = async () => 'b'.repeat(40);
  await assert.rejects(publish(f.config, intent, join(f.dir, 'site.zip')), /SOURCE_SUPERSEDED/);
  assert.equal(f.puts(), 0);
});

test('rejects a receipt from another target or build profile', async t => {
  const f = await fixture(t);
  const intent = await preflight(f.config);
  await assert.rejects(publish({ ...f.config, api: f.config.api + 'other' }, intent, join(f.dir, 'site.zip')), /INTENT_MISMATCH/);
  await assert.rejects(publish({ ...f.config, profile: { ...profile, audience: 'public' } }, intent, join(f.dir, 'site.zip')), /INTENT_MISMATCH/);
  assert.equal(f.puts(), 0);
});

test('verification rejects unpublished identity and mismatched local files', async t => {
  const f = await fixture(t); f.current();
  f.state().publicationState = 'draft';
  await assert.rejects(verify(f.config), /NOT_CURRENT/);
  f.state().publicationState = 'published';
  const report = await verify(f.config, f.dir).catch(e => e);
  assert.match(report.message, /FILE_MISMATCH/); // ZIP is not in the remote manifest.
  await rm(join(f.dir, 'site.zip'));
  assert.equal((await verify(f.config, f.dir)).verifiedFiles, 1);
});
