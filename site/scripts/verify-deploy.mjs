// Run inside the deploy workflow: the existing per-canvas key can read its own live files.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const { CANVAS_DROP_TOKEN, CANVAS_HOST, CANVAS_ID, GITHUB_SHA } = process.env;
if (!CANVAS_DROP_TOKEN || !CANVAS_HOST || !CANVAS_ID || !GITHUB_SHA) throw new Error('Missing deployment verification configuration');
const base = `https://${CANVAS_HOST}/v1/canvases/${CANVAS_ID}`;
const headers = { Authorization: `Bearer ${CANVAS_DROP_TOKEN}` };
async function get(path) {
  const response = await fetch(base + path, { headers });
  if (!response.ok) throw new Error(`Deployment readback failed: HTTP ${response.status}`);
  return response.json();
}
const [manifest, version, canvas] = await Promise.all([get('/files'), get('/files?path=version.json'), get('')]);
if (version.commit !== GITHUB_SHA) throw new Error('Live commit does not match this release');
const root = resolve(import.meta.dirname, '../dist');
let verified = 0;
async function verify(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await verify(path); continue; }
    const local = await readFile(path);
    const file = manifest.files.find(file => file.path === relative(root, path));
    if (!file || file.size !== local.length || file.hash !== createHash('sha256').update(local).digest('hex'))
      throw new Error(`Live file mismatch: ${relative(root, path)}`);
    verified++;
  }
}
await verify(root);
if (verified !== manifest.fileCount) throw new Error('Unexpected files in the deployed version');
const report = { commit: GITHUB_SHA, canvas: CANVAS_ID, url: canvas.url, accessMode: canvas.accessMode, version: manifest.version, verifiedFiles: verified };
await writeFile(resolve(import.meta.dirname, '../../deployment-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
