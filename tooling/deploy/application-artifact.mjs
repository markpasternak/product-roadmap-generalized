// Private CI artifacts, never Canvas files, authorize executable package reuse.
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyApplicationPackage } from '../../site/scripts/application-package.mjs';
import { writePrivateJSON } from './coordinate.mjs';
import { responseJSON } from './staged.mjs';

const maxArchive = 512 * 1024 * 1024;
const fail = () => { throw new Error('UNTRUSTED_APPLICATION_ARTIFACT'); };
export function validateArtifactProvenance({ expected, workflow, run, artifact }) {
  const { repo, source, digest } = expected;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '') || !/^[a-f0-9]{64}$/.test(digest ?? '') ||
    workflow?.path !== '.github/workflows/deploy.yml' || !Number.isSafeInteger(workflow.id) ||
    run?.workflow_id !== workflow.id || run.path !== workflow.path || run.head_branch !== 'main' || run.head_sha !== source ||
    !['push', 'workflow_dispatch'].includes(run.event) || run.status !== 'completed' || run.conclusion !== 'success' ||
    run.repository?.full_name !== repo || run.head_repository?.full_name !== repo || run.repository.id !== run.head_repository.id ||
    !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.repository.id) ||
    artifact?.expired !== false || !Number.isSafeInteger(artifact.id) || artifact.name !== `roadmap-application-${digest}` ||
    !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 || artifact.size_in_bytes > maxArchive ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '') || artifact.workflow_run?.id !== run.id ||
    artifact.workflow_run.head_sha !== source || artifact.workflow_run.head_branch !== 'main' ||
    artifact.workflow_run.repository_id !== run.repository.id || artifact.workflow_run.head_repository_id !== run.repository.id) fail();
  return { ...expected, artifactId: artifact.id, archiveDigest: artifact.digest.slice(7), archiveSize: artifact.size_in_bytes, workflowRunId: run.id };
}

async function api(repo, token, path, redirect = 'error') {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !token) fail();
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect, signal: AbortSignal.timeout(15000),
  });
  if (redirect === 'manual' && response.status === 302) return response;
  if (!response.ok) throw new Error(`ARTIFACT_HTTP_${response.status}`);
  return responseJSON(response);
}

export async function findApplicationArtifact(expected, token) {
  if (!/^[a-f0-9]{64}$/.test(expected.digest ?? '') || !/^[a-f0-9]{40}$/.test(expected.source ?? '')) fail();
  const workflow = await api(expected.repo, token, 'actions/workflows/deploy.yml');
  const data = await api(expected.repo, token, `actions/artifacts?name=roadmap-application-${expected.digest}&per_page=100`);
  for (const artifact of data.artifacts ?? []) {
    if (artifact.expired || artifact.workflow_run?.head_sha !== expected.source || !Number.isSafeInteger(artifact.workflow_run?.id)) continue;
    const run = await api(expected.repo, token, `actions/runs/${artifact.workflow_run.id}`);
    try { return validateArtifactProvenance({ expected, workflow, run, artifact }); } catch { /* A failed rerun cannot hide an older valid artifact. */ }
  }
  fail();
}

export async function downloadApplicationArtifact(provenance, token, directory, profile) {
  // Metadata is authenticated again, including completed workflow state, before
  // download. Callers cannot construct an arbitrary trusted provenance object.
  const expected = { repo: provenance.repo, source: provenance.source, digest: provenance.digest };
  const checked = await findApplicationArtifact(expected, token);
  const response = await api(expected.repo, token, `actions/artifacts/${checked.artifactId}/zip`, 'manual');
  if (!(response instanceof Response) || response.status !== 302) fail();
  const url = new URL(response.headers.get('location'));
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail();
  // The signed object-store URL is returned by authenticated GitHub. Never
  // forward the GitHub credential to that different origin or follow redirects.
  const archive = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!archive.ok || !archive.body) throw new Error('ARTIFACT_DOWNLOAD_FAILED');
  const temporary = await mkdtemp(join(tmpdir(), 'roadmap-private-artifact-'));
  let created = false;
  try {
    const archivePath = join(temporary, 'application.zip');
    const handle = await open(archivePath, 'wx', 0o600);
    const hash = createHash('sha256'); let size = 0;
    try {
      for await (const chunk of archive.body) {
        size += chunk.length;
        if (size > checked.archiveSize || size > maxArchive) fail();
        hash.update(chunk); await handle.writeFile(chunk);
      }
    } finally { await handle.close(); }
    if (size !== checked.archiveSize || hash.digest('hex') !== checked.archiveDigest) fail();
    await mkdir(directory, { mode: 0o700 }); created = true;
    execFileSync('python3', [fileURLToPath(new URL('./extract-application.py', import.meta.url)), archivePath, directory],
      { env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    const manifest = await verifyApplicationPackage(directory, { digest: checked.digest, profile });
    if (manifest.source !== checked.source) fail();
    return { ...checked, directory: resolve(directory) };
  } catch (error) {
    if (created) await rm(directory, { recursive: true, force: true }); // Only the fresh directory created above.
    throw error;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

// Recovery/manual operator entrypoint. The independent root-owned reconciler
// reuses these provenance checks; the content worker never promotes code.
async function main() {
  const [action, source, digest, directory, pointer] = process.argv.slice(2);
  if (action !== 'promote' || !directory || !pointer) throw new Error('EXPECTED_PROMOTE_SOURCE_DIGEST_DIRECTORY_POINTER');
  const profile = { siteUrl: process.env.SITE_URL, base: process.env.SITE_BASE, audience: process.env.SITE_AUDIENCE,
    editApi: process.env.PUBLIC_EDIT_API, canvasBackend: process.env.PUBLIC_CANVAS_BACKEND };
  const provenance = await findApplicationArtifact({ repo: process.env.GITHUB_REPOSITORY, source, digest }, process.env.GH_TOKEN);
  const installed = await downloadApplicationArtifact(provenance, process.env.GH_TOKEN, resolve(directory), profile);
  await writePrivateJSON(resolve(pointer), installed);
  console.log(`Approved application ${source} from successful deployment run ${installed.workflowRunId}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => { console.error('APPLICATION_PROMOTION_FAILED'); process.exitCode = 1; });
