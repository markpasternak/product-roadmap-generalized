// Shared by Actions and the editor. Canvas owns atomic activation; GitHub owns
// source freshness. A conflict is a stop, never permission to retry a stale build.
import { createHash } from 'node:crypto';
import { readFile, writeFile, appendFile, readdir, rename } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const profileKeys = ['siteUrl', 'base', 'audience', 'editApi', 'canvasBackend'];

export function releaseIdentity({ repo, commit, profile }) {
  const inputs = ['roadmap-v1', repo, commit, ...profileKeys.map(key => profile[key])];
  if (inputs.some(value => typeof value !== 'string' || !value || value.includes('\0'))) fail('INVALID_RELEASE_INPUT');
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('INVALID_RELEASE_INPUT');
  return `roadmap-v1-${digest(inputs.join('\0'))}`;
}

function apiURL(config, suffix = '') {
  const url = new URL(config.api);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || !/^\/v1\/canvases\/[a-zA-Z0-9_-]+$/.test(url.pathname)) fail('INVALID_CANVAS_URL');
  if (!config.token) fail('MISSING_CANVAS_TOKEN');
  return new URL(url.href + suffix);
}

async function request(config, suffix = '', options = {}) {
  return fetch(apiURL(config, suffix), {
    ...options, headers: { Authorization: `Bearer ${config.token}`, ...options.headers },
    redirect: 'error', signal: AbortSignal.timeout(45_000),
  });
}

async function get(config, suffix = '') {
  const response = await request(config, suffix);
  if (!response.ok) fail(`READBACK_HTTP_${response.status}`);
  return response.json();
}

async function status(config) {
  const canvas = await get(config);
  if (typeof canvas.publicationToken !== 'string' || !canvas.publicationToken || !Object.hasOwn(canvas, 'currentVersion')) fail('COORDINATION_UNAVAILABLE');
  return canvas;
}

function isCurrent(canvas, releaseId) {
  return canvas.publicationState === 'published' && canvas.currentVersion?.releaseId === releaseId &&
    typeof canvas.currentVersion.id === 'string' && canvas.currentVersion.id === canvas.currentVersionId;
}

async function assertLatest(config) {
  if (await config.latest() !== config.commit) fail('SOURCE_SUPERSEDED');
}

export async function preflight(config) {
  await assertLatest(config);
  const releaseId = releaseIdentity(config);
  const canvas = await status(config);
  const alreadyCurrent = isCurrent(canvas, releaseId);
  if (alreadyCurrent) await verify(config);
  return { releaseId, api: config.api, expectedPublicationToken: canvas.publicationToken, alreadyCurrent };
}

// On the cheap already-current path there is no local build to compare. Record
// identity proof explicitly; only a fresh upload gets full local-file hash proof.
export async function verify(config, dist) {
  const releaseId = releaseIdentity(config);
  const before = await status(config);
  if (!isCurrent(before, releaseId)) fail('RELEASE_NOT_CURRENT');
  const manifest = await get(config, '/files');
  const response = await request(config, '/files?path=version.json');
  if (!response.ok) fail(`READBACK_HTTP_${response.status}`);
  const versionBytes = Buffer.from(await response.arrayBuffer());
  if (JSON.parse(versionBytes).commit !== config.commit) fail('LIVE_COMMIT_MISMATCH');
  if (!Array.isArray(manifest.files) || manifest.fileCount !== manifest.files.length || manifest.version !== before.currentVersion.number) fail('MANIFEST_MISMATCH');
  const files = new Map(manifest.files.map(file => [file.path, file]));
  if (files.size !== manifest.fileCount) fail('MANIFEST_MISMATCH');
  const version = files.get('version.json');
  if (version?.hash !== digest(versionBytes) || version.size !== versionBytes.length) fail('VERSION_HASH_MISMATCH');
  let verifiedFiles = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue; // Same archive policy as the Go worker.
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.isFile()) fail('NON_REGULAR_OUTPUT');
      const bytes = await readFile(path);
      const file = files.get(relative(resolve(dist), path).split('\\').join('/'));
      if (!file || file.size !== bytes.length || file.hash !== digest(bytes)) fail('FILE_MISMATCH');
      verifiedFiles++;
    }
  }
  if (dist) {
    await walk(dist);
    if (verifiedFiles !== manifest.fileCount) fail('FILE_COUNT_MISMATCH');
  }
  const after = await status(config);
  if (!isCurrent(after, releaseId) || after.publicationToken !== before.publicationToken || after.currentVersionId !== before.currentVersionId) fail('PUBLICATION_CHANGED_DURING_VERIFICATION');
  return { commit: config.commit, releaseId, versionId: before.currentVersionId, publicationToken: before.publicationToken,
    version: manifest.version, url: before.url, accessMode: before.accessMode,
    verification: dist ? 'all-local-files' : 'release-identity', verifiedFiles, fileCount: manifest.fileCount };
}

export async function publish(config, intent, archive, dist) {
  const releaseId = releaseIdentity(config);
  if (intent.releaseId !== releaseId || intent.api !== config.api || typeof intent.expectedPublicationToken !== 'string' || !intent.expectedPublicationToken || typeof intent.alreadyCurrent !== 'boolean') fail('INTENT_MISMATCH');
  await assertLatest(config);
  if (intent.alreadyCurrent) return { ...await verify(config), outcome: 'already_current' };
  // Avoid sending another ZIP if the other publisher finished while we built.
  if (isCurrent(await status(config), releaseId)) return { ...await verify(config), outcome: 'already_current' };
  const body = await readFile(archive);
  if (!body.length) fail('EMPTY_ARCHIVE');
  await assertLatest(config);
  const query = new URLSearchParams({ releaseId, expectedPublicationToken: intent.expectedPublicationToken });
  let response;
  try {
    response = await request(config, `/deploy?${query}`, { method: 'PUT', body, headers: { 'Content-Type': 'application/zip' } });
  } catch {
    // An accepted activation can lose its HTTP reply. Read only, never re-PUT.
    return { ...await verify(config), outcome: 'already_current' };
  }
  if (response.status === 409) {
    const conflict = await response.json();
    if (conflict.code === 'PUBLICATION_CHANGED' || conflict.code === 'RELEASE_NOT_CURRENT') fail(conflict.code);
    fail('DEPLOY_CONFLICT');
  }
  if (response.status !== 200) fail(`DEPLOY_HTTP_${response.status}`);
  const result = await response.json();
  if (!['published', 'already_current'].includes(result.outcome) || result.releaseId !== releaseId || !result.versionId || !result.publicationToken) fail('INVALID_DEPLOY_RESPONSE');
  const proof = await verify(config, result.outcome === 'published' ? dist : undefined);
  if (proof.versionId !== result.versionId || proof.publicationToken !== result.publicationToken) fail('PUBLICATION_CHANGED_DURING_VERIFICATION');
  return { ...proof, outcome: result.outcome };
}

export function configFromEnv(env = process.env) {
  const config = { repo: env.GITHUB_REPOSITORY, commit: env.GITHUB_SHA, token: env.CANVAS_DROP_TOKEN,
    api: env.CANVAS_API_URL || `https://${env.CANVAS_HOST}/v1/canvases/${env.CANVAS_ID}`,
    profile: { siteUrl: env.SITE_URL, base: env.SITE_BASE, audience: env.SITE_AUDIENCE, editApi: env.PUBLIC_EDIT_API, canvasBackend: env.PUBLIC_CANVAS_BACKEND },
  };
  releaseIdentity(config);
  apiURL(config);
  config.latest = async () => {
    if (!env.GH_TOKEN) fail('MISSING_GITHUB_TOKEN');
    const response = await fetch(`https://api.github.com/repos/${config.repo}/git/ref/heads/main`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
      redirect: 'error', signal: AbortSignal.timeout(15_000), cache: 'no-store',
    });
    if (!response.ok) fail(`GITHUB_HTTP_${response.status}`);
    return (await response.json()).object?.sha;
  };
  return config;
}

export async function runCLI(config = configFromEnv()) {
  const [action, intentPath = '.deployment-intent.json', archive = 'site.zip', reportPath = 'deployment-verification.json'] = process.argv.slice(2);
  if (action === 'preflight') {
    const intent = await preflight(config);
    await writePrivateJSON(intentPath, intent);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `already_current=${intent.alreadyCurrent}\n`);
  } else if (action === 'publish') {
    const intent = JSON.parse(await readFile(intentPath, 'utf8'));
    const report = await publish(config, intent, archive, resolve('site/dist'));
    await assertLatest(config);
    await writePrivateJSON(reportPath, report);
    console.log(`Deployment verified: ${report.outcome} (${report.verification})`);
  } else fail('EXPECTED_PREFLIGHT_OR_PUBLISH');
}

export async function writePrivateJSON(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCLI().catch(error => {
    // Never print remote bodies, credential-bearing URLs or arbitrary diagnostics.
    console.error(/^[A-Z_0-9]+$/.test(error.message) ? error.message : 'COORDINATED_DEPLOY_FAILED');
    process.exitCode = 1;
  });
}
