import { readFile, lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const profileKeys = ['siteUrl', 'base', 'audience', 'editApi', 'canvasBackend'];

/** digest/profile come from trusted installation or CI provenance, never Canvas or this directory. */
export async function verifyApplicationPackage(directory, { digest, profile } = {}) {
  if (!digestPattern.test(digest ?? '')) throw new Error('Expected approved package digest is required');
  const root = resolve(directory);
  if (!(await lstat(root)).isDirectory() || !(await lstat(join(root, 'package.json'))).isFile()) throw new Error('Non-regular application package');
  const bytes = await readFile(join(root, 'package.json'));
  if (sha256(bytes) !== digest) throw new Error('Application manifest digest mismatch');
  const manifest = JSON.parse(bytes);
  if (manifest.type !== 'module' || manifest.protocol !== 1 || !/^[a-f0-9]{40}$/.test(manifest.source) || !digestPattern.test(manifest.dependencyDigest ?? '')) throw new Error('Incompatible application protocol');
  if (manifest.nodeMajor !== Number(process.versions.node.split('.')[0])) throw new Error('Incompatible application runtime');
  if (!manifest.profile || profileKeys.some(key => typeof manifest.profile[key] !== 'string') ||
      !['internal', 'public'].includes(manifest.audience) || manifest.profile.audience !== manifest.audience || manifest.profile.base !== manifest.base ||
      !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(manifest.base) ||
      (profile && profileKeys.some(key => profile[key] !== manifest.profile[key]))) throw new Error('Application profile mismatch');
  if (!Array.isArray(manifest.files) || manifest.files.length > 20000) throw new Error('Invalid application inventory');
  const seen = new Set(), normalized = new Set();
  let total = 0;
  const checks = [];
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !/^(?:private|public)\//.test(file.path) ||
        file.path.includes('\\') || /[\u0000-\u001f]/.test(file.path) || file.path.split('/').some(p => !p || p === '.' || p === '..') ||
        normalized.has(file.path.toLowerCase())) throw new Error('Invalid application path or collision');
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !digestPattern.test(file.hash ?? '')) throw new Error('Invalid application inventory');
    total += file.size;
    if (total > 512 * 1024 * 1024) throw new Error('Application package exceeds size budget');
    seen.add(file.path); normalized.add(file.path.toLowerCase());
    checks.push(async () => {
      let path = root;
      const parts = file.path.split('/');
      for (let index = 0; index < parts.length; index++) {
        path = join(path, parts[index]);
        const stat = await lstat(path);
        if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) throw new Error('Non-regular or symbolic application path');
      }
      const content = await readFile(path);
      if (content.length !== file.size || sha256(content) !== file.hash) throw new Error('Application checksum mismatch');
    });
  }
  // Bound concurrent reads while retaining every path, byte and inventory check.
  for (let offset = 0; offset < checks.length; offset += 4) {
    const results = await Promise.allSettled(checks.slice(offset, offset + 4).map(check => check()));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  for (const required of ['private/renderer.mjs', 'private/template.html', 'private/template-docs.html', 'public/.vite/manifest.json'])
    if (!seen.has(required)) throw new Error('Incomplete application inventory');
  async function checkInventory(relative = '') {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await checkInventory(path);
      else if (!entry.isFile() || (path !== 'package.json' && !seen.has(path))) throw new Error('Application inventory contains unlisted or non-regular files');
    }
  }
  await checkInventory();
  return manifest;
}
