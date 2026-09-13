import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stagePublication } from '../deploy/staged.mjs';

const bytes = Buffer.from('new snapshot');
const hash = createHash('sha256').update(bytes).digest('hex');
const manifest = [{ path: 'index.html', size: bytes.length, hash }, { path: 'copy.html', size: bytes.length, hash }];
const published = { outcome: 'published', releaseId: 'release', versionId: 'version', publicationToken: 'after' };
function fixture(options = {}) {
  const calls = [], waits = [];
  let latest = true;
  let attempt = 0;
  const config = {
    manifest, releaseId: 'release', expectedPublicationToken: 'before',
    readBlob: async () => options.corrupt ? Buffer.from('corrupt') : bytes,
    assertLatest: async () => { if (!latest) throw new Error('SOURCE_SUPERSEDED'); },
    sleep: async delay => { waits.push(delay); },
    request: async (path, init) => {
      calls.push({ path, init });
      if (path === '/uploads') {
        if (options.already) return Response.json({ ...published, outcome: 'already_current' });
        if (options.beginConflict) return Response.json({ code: 'PUBLICATION_CHANGED' }, { status: 409 });
        return Response.json({ uploadId: 'up_test', missingHashes: options.missing ?? [hash] });
      }
      if (path.includes('/blobs/')) {
        if (options.supersede) latest = false;
        return new Response(null, { status: 204 });
      }
      if (options.lost) throw new Error('connection closed');
      if (options.rateLimit && attempt++ === 0) return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '2' } });
      if (options.finalizeError) return Response.json({ code: options.finalizeError }, { status: options.finalizeError === 'UPLOAD_EXPIRED' ? 400 : 409 });
      return Response.json(published);
    },
  };
  return { config, calls, waits };
}

test('stages each missing hash once and finalizes with the originally captured token', async () => {
  const f = fixture();
  assert.deepEqual(await stagePublication(f.config), published);
  assert.equal(f.calls.filter(call => call.path.includes('/blobs/')).length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { manifest, releaseId: 'release', expectedPublicationToken: 'before' });
  assert.equal(f.calls.at(-1).path, '/uploads/up_test/finalize');
  assert.equal(f.calls.at(-1).init.body, undefined); // Never refresh the captured token.
});
test('already-current and stored blobs need no body reads', async () => {
  for (const options of [{ already: true }, { missing: [] }]) {
    const f = fixture(options);
    f.config.readBlob = async () => { throw Error('must not read'); };
    await stagePublication(f.config);
    assert(!f.calls.some(call => call.path.includes('/blobs/')));
  }
});
test('source supersession after upload cannot finalize', async () => {
  const f = fixture({ supersede: true });
  await assert.rejects(stagePublication(f.config), /SOURCE_SUPERSEDED/);
  assert(!f.calls.some(call => call.path.endsWith('/finalize')));
});
test('publication conflicts and expired handles stop without refreshing or re-beginning', async () => {
  for (const options of [{ beginConflict: true }, { finalizeError: 'PUBLICATION_CHANGED' }, { finalizeError: 'UPLOAD_EXPIRED' }, { finalizeError: 'RELEASE_NOT_CURRENT' }]) {
    const f = fixture(options);
    await assert.rejects(stagePublication(f.config), /PUBLICATION_CHANGED|UPLOAD_EXPIRED|RELEASE_NOT_CURRENT/);
    assert.equal(f.calls.filter(call => call.path === '/uploads').length, 1);
    assert(f.calls.filter(call => call.path.endsWith('/finalize')).length <= 1);
  }
});
test('lost finalize response returns a readback-required result, not a second finalize', async () => {
  const f = fixture({ lost: true });
  assert.equal(await stagePublication(f.config), null);
  assert.equal(f.calls.filter(call => call.path.endsWith('/finalize')).length, 1);
});
test('429 honors Retry-After before a bounded retry of the same handle', async () => {
  const f = fixture({ rateLimit: true });
  await stagePublication(f.config);
  assert.deepEqual(f.waits, [2000]);
  assert.equal(f.calls.filter(call => call.path === '/uploads').length, 1);
});
test('unknown missing hashes and corrupt local bytes cannot reach finalize', async () => {
  for (const options of [{ missing: ['b'.repeat(64)] }, { corrupt: true }]) {
    const f = fixture(options);
    await assert.rejects(stagePublication(f.config), /INVALID_UPLOAD_RESPONSE|LOCAL_BLOB_MISMATCH/);
    assert(!f.calls.some(call => call.path.endsWith('/finalize')));
  }
});
test('rejects ambiguous, private or unsafe manifest paths before contacting Canvas', async () => {
  for (const path of ['../secret', '.env', 'private/renderer.mjs', '/index.html', 'a\\b', 'index.html']) {
    const f = fixture();
    f.config.manifest = [...manifest, { ...manifest[0], path }];
    await assert.rejects(stagePublication(f.config), /INVALID_MANIFEST/);
    assert.equal(f.calls.length, 0);
  }
});
