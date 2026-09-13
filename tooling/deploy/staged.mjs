// Canvas staged sessions capture the publication token at begin. A conflict is
// never permission to replace that token and activate the old candidate.
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const fail = code => { throw new Error(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;

export function validateManifest(manifest) {
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 2000) fail('INVALID_MANIFEST');
  const paths = new Set(), hashes = new Map();
  let total = 0;
  for (const file of manifest) {
    if (!file || typeof file.path !== 'string' || file.path.includes('\\') || /[\u0000-\u001f\u007f]/.test(file.path) ||
        file.path.split('/').some(part => !part || part.startsWith('.')) || file.path.startsWith('private/') ||
        paths.has(file.path.toLowerCase()) || !digestPattern.test(file.hash ?? '') ||
        !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 25 * 1024 * 1024) fail('INVALID_MANIFEST');
    const previous = hashes.get(file.hash);
    if (previous && previous.size !== file.size) fail('INVALID_MANIFEST');
    paths.add(file.path.toLowerCase());
    hashes.set(file.hash, file);
    total += file.size;
    if (total > 100 * 1024 * 1024) fail('INVALID_MANIFEST');
  }
  return hashes;
}

export async function responseBytes(response, limit = 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) fail('INVALID_API_RESPONSE');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) fail('API_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}
export async function responseJSON(response) { return JSON.parse((await responseBytes(response)).toString('utf8')); }
class TransportFailure extends Error {}

export function validateDeployResult(result, releaseId) {
  if (!result || !['published', 'already_current'].includes(result.outcome) || result.releaseId !== releaseId ||
      typeof result.versionId !== 'string' || !result.versionId || typeof result.publicationToken !== 'string' || !result.publicationToken) fail('INVALID_DEPLOY_RESPONSE');
  return result;
}

export async function stagePublication(config) {
  const blobs = validateManifest(config.manifest);
  const concurrency = config.concurrency ?? 8;
  if (![4, 8].includes(concurrency)) fail('INVALID_UPLOAD_CONCURRENCY');
  const expires = Date.now() + 15 * 60 * 1000;
  async function send(path, init, checkSource = true) {
    for (let attempt = 0; ; attempt++) {
      if (Date.now() >= expires) fail('UPLOAD_EXPIRED');
      if (checkSource) await config.assertLatest();
      let response;
      try { response = await config.request(path, init); }
      catch { throw new TransportFailure('STAGED_TRANSPORT_FAILED'); }
      if (response.status !== 429) return response;
      const retry = response.headers.get('Retry-After');
      const delay = /^\d+$/.test(retry ?? '') ? Number(retry) * 1000 : Date.parse(retry ?? '') - Date.now();
      await response.body?.cancel();
      if (attempt >= 2 || !Number.isFinite(delay) || delay < 0 || delay > 60_000 || Date.now() + delay >= expires) fail('DEPLOY_RATE_LIMITED');
      await (config.sleep ?? sleep)(Math.max(100, delay));
    }
  }
  async function checkedJSON(response) {
    const body = await responseJSON(response);
    if (!response.ok) {
      const known = ['PUBLICATION_CHANGED', 'RELEASE_NOT_CURRENT', 'UPLOAD_EXPIRED', 'UPLOAD_HANDLE_INVALID', 'UPLOAD_MISSING_BLOB', 'UPLOAD_ALREADY_FINALIZED', 'UPLOAD_IN_PROGRESS'];
      fail(known.includes(body?.code) ? body.code : `STAGED_HTTP_${response.status}`);
    }
    return body;
  }
  const begin = await checkedJSON(await send('/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest: config.manifest, releaseId: config.releaseId, expectedPublicationToken: config.expectedPublicationToken }) }));
  if (begin.outcome === 'already_current') return validateDeployResult(begin, config.releaseId);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(begin.uploadId ?? '') || !Array.isArray(begin.missingHashes) ||
      begin.missingHashes.length > blobs.size || new Set(begin.missingHashes).size !== begin.missingHashes.length ||
      begin.missingHashes.some(hash => !blobs.has(hash))) fail('INVALID_UPLOAD_RESPONSE');
  let next = 0, stopped = false;
  const workers = Array.from({ length: Math.min(concurrency, begin.missingHashes.length) }, async () => {
    try {
      while (!stopped && next < begin.missingHashes.length) {
        const hash = begin.missingHashes[next++], file = blobs.get(hash);
        const bytes = await config.readBlob(file);
        if (bytes.length !== file.size || sha(bytes) !== hash) fail('LOCAL_BLOB_MISMATCH');
        const response = await send(`/uploads/${begin.uploadId}/blobs/${hash}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }, false);
        if (response.status !== 204) { await checkedJSON(response); fail('INVALID_UPLOAD_RESPONSE'); }
      }
    } catch (error) { stopped = true; throw error; }
  });
  const results = await Promise.allSettled(workers); // Drain active requests before the owner removes candidate files.
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  // send() rechecks authoritative main immediately before every finalize attempt.
  let response;
  try { response = await send(`/uploads/${begin.uploadId}/finalize`, { method: 'POST' }); }
  catch (error) {
    // Only transport failure is ambiguous. Safety checks/rate limits still fail closed.
    if (!(error instanceof TransportFailure)) throw error;
    return null; // Caller must prove the complete live release through authenticated readback.
  }
  return validateDeployResult(await checkedJSON(response), config.releaseId);
}
