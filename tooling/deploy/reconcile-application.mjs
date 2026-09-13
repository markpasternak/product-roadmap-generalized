// Installed operator code, separate from the unprivileged content publisher.
// Canvas selects the active identity; successful exact-main Actions provenance
// and complete package verification are the authority to install executable code.
import { readFile, readdir, lstat, chmod, chown, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readCurrentRelease, writePrivateJSON } from './coordinate.mjs';
import { findApplicationArtifact, downloadApplicationArtifact } from './application-artifact.mjs';
import { verifyApplicationPackage, sha256 } from '../../site/scripts/application-package.mjs';
import { responseJSON } from './staged.mjs';

const fail = code => { throw new Error(code); };
const same = (a, b) => a?.applicationCommit === b?.applicationCommit && a?.applicationPackage === b?.applicationPackage;
export function applicationGroup(env) {
  const name = env.ROADMAP_APPLICATION_GROUP || 'roadmap-editor';
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(name)) fail('INVALID_APPLICATION_GROUP');
  return name;
}
export function selectedApplication(release, repo, profile) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[a-f0-9]{40}$/.test(release?.applicationCommit ?? '') ||
      !/^[a-f0-9]{64}$/.test(release?.applicationPackage ?? '') || release.contentSchema !== 1 ||
      release.profile !== sha256(JSON.stringify(profile))) fail('INVALID_ACTIVE_APPLICATION');
  return { repo, source: release.applicationCommit, digest: release.applicationPackage };
}

export async function reconcileApplication({ config, profile, pointer, groupId, token, readLive = () => readCurrentRelease(config),
  find = findApplicationArtifact, download = downloadApplicationArtifact, verify = verifyApplicationPackage, setPermissions, activate = activatePointer }) {
  if (!Number.isInteger(groupId) || groupId < 0 || !pointer || !pointer.startsWith('/')) fail('INVALID_PROMOTION_CONFIG');
  const { release } = await readLive();
  if (!release) return { outcome: 'unpublished' };
  const expected = selectedApplication(release, config.repo, profile);
  const previous = JSON.parse(await readFile(pointer, 'utf8'));
  if (previous.repo === expected.repo && previous.source === expected.source && previous.digest === expected.digest) return { outcome: 'already_approved' };
  const githubToken = await token();
  const provenance = await find(expected, githubToken);
  const parent = dirname(pointer), destination = join(parent, expected.digest);
  // Only a fresh, private directory owned by this invocation can be removed.
  const pending = join(parent, `.promotion-${process.pid}-${Date.now()}`);
  let installed;
  try {
    installed = await download(provenance, githubToken, pending, profile);
    await (setPermissions ?? ((path) => protectPackage(path, groupId)))(pending);
    const current = await readLive();
    if (!same(release, current.release)) fail('ACTIVE_APPLICATION_CHANGED');
    let exists = false;
    try { await lstat(destination); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      const manifest = await verify(destination, { digest: expected.digest, profile });
      if (manifest.source !== expected.source) fail('EXISTING_APPLICATION_MISMATCH');
      await (setPermissions ?? ((path) => protectPackage(path, groupId)))(destination);
      await rm(pending, { recursive: true });
    } else await rename(pending, destination);
    installed = { ...installed, directory: destination };
    await activate(pointer, previous, installed, groupId);
    return { outcome: 'promoted', source: expected.source, digest: expected.digest, workflowRunId: installed.workflowRunId };
  } finally { await rm(pending, { recursive: true, force: true }); }
}

async function activatePointer(pointer, previous, installed, groupId) {
  await writePrivateJSON(`${pointer}.previous`, previous);
  const next = `${pointer}.next`;
  await writePrivateJSON(next, installed);
  await chown(next, 0, groupId); await chmod(next, 0o640);
  await rename(next, pointer);
}

async function protectPackage(root, groupId) {
  async function visit(path) {
    const stat = await lstat(path);
    if (!stat.isDirectory() && !stat.isFile()) fail('NON_REGULAR_APPLICATION_PATH');
    await chown(path, 0, groupId); await chmod(path, stat.isDirectory() ? 0o750 : 0o640);
    if (stat.isDirectory()) for (const name of await readdir(path)) await visit(join(path, name));
  }
  await visit(root);
}

export async function installationToken(env, fetcher = fetch) {
  if (!/^\d+$/.test(env.GITHUB_APP_ID ?? '') || !/^\d+$/.test(env.GITHUB_APP_INSTALLATION_ID ?? '') ||
      !/^[\w.-]+\/[\w.-]+$/.test(env.REPO ?? '')) fail('INVALID_GITHUB_APP_CONFIG');
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 30, exp: now + 300, iss: env.GITHUB_APP_ID })}`;
  const signer = createSign('RSA-SHA256'); signer.update(body);
  const jwt = `${body}.${signer.sign(await readFile(env.GITHUB_APP_PRIVATE_KEY_FILE), 'base64url')}`;
  const response = await fetcher(`https://api.github.com/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositories: [env.REPO.split('/')[1]], permissions: { actions: 'read', contents: 'read' } }),
  });
  if (!response.ok) fail(`INSTALLATION_TOKEN_HTTP_${response.status}`);
  const result = await responseJSON(response);
  if (typeof result.token !== 'string' || !result.token) fail('INVALID_INSTALLATION_TOKEN');
  return result.token;
}

async function main() {
  if (process.getuid?.() !== 0) fail('ROOT_OPERATOR_REQUIRED');
  const env = process.env;
  if (env.ROADMAP_LOCAL_BUILD_MODE !== 'content' || env.ROADMAP_PUBLICATION_PAUSED === 'true') return;
  const profile = { siteUrl: env.SITE_URL, base: env.SITE_BASE, audience: env.SITE_AUDIENCE, editApi: env.PUBLIC_EDIT_API, canvasBackend: env.PUBLIC_CANVAS_BACKEND };
  const config = { repo: env.REPO, api: env.CANVAS_API_URL, token: env.CANVAS_DROP_TOKEN };
  const group = execFileSync('getent', ['group', applicationGroup(env)], { encoding: 'utf8' }).trim().split(':');
  const result = await reconcileApplication({ config, profile, pointer: env.ROADMAP_APPLICATION_POINTER,
    groupId: Number(group[2]), token: () => installationToken(env) });
  if (result.outcome === 'promoted') console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(/^[A-Z_0-9]+$/.test(error.message) ? error.message : 'APPLICATION_RECONCILIATION_FAILED'); process.exitCode = 1; });
