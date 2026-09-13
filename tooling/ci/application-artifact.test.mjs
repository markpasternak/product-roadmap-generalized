import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArtifactProvenance, downloadApplicationArtifact } from '../deploy/application-artifact.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const source = 'a'.repeat(40), digest = 'b'.repeat(64), repo = 'example/roadmap';
function fixture() {
  return { expected: { repo, source, digest }, workflow: { id: 10, path: '.github/workflows/deploy.yml' },
    run: { id: 20, workflow_id: 10, path: '.github/workflows/deploy.yml', head_branch: 'main', head_sha: source,
      event: 'push', status: 'completed', conclusion: 'success', repository: { id: 30, full_name: repo }, head_repository: { id: 30, full_name: repo } },
    artifact: { id: 40, name: `roadmap-application-${digest}`, expired: false, size_in_bytes: 100,
      digest: `sha256:${'c'.repeat(64)}`, workflow_run: { id: 20, head_sha: source, head_branch: 'main', repository_id: 30, head_repository_id: 30 } } };
}
test('only the exact successful main deployment run can authorize an application artifact', () => {
  assert.doesNotThrow(() => validateArtifactProvenance(fixture()));
  for (const mutate of [
    f => f.run.conclusion = 'failure', f => f.run.status = 'in_progress', f => f.run.event = 'pull_request',
    f => f.run.head_branch = 'feature', f => f.run.head_sha = 'd'.repeat(40),
    f => f.run.repository.full_name = 'other/roadmap', f => f.run.head_repository.id = 999,
    f => f.run.workflow_id = 999, f => f.workflow.path = '.github/workflows/checks.yml',
    f => f.artifact.expired = true, f => f.artifact.name += '-other', f => f.artifact.digest = undefined,
    f => f.artifact.workflow_run.id = 999, f => f.artifact.workflow_run.head_repository_id = 999,
    f => f.artifact.size_in_bytes = 513 * 1024 * 1024,
  ]) { const f = fixture(); mutate(f); assert.throws(() => validateArtifactProvenance(f)); }
});
test('download verifies archive and every package byte without forwarding credentials to storage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-artifact-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'application'); await mkdir(app);
  const hash = b => createHash('sha256').update(b).digest('hex');
  const files = [];
  for (const path of ['private/renderer.mjs', 'private/template.html', 'private/template-docs.html', 'public/.vite/manifest.json']) {
    await mkdir(join(app, path, '..'), { recursive: true }); await writeFile(join(app, path), 'fixture');
    files.push({ path, hash: hash('fixture'), size: 7 });
  }
  const profile = { siteUrl: 'https://example.test', base: '/', audience: 'internal', editApi: '', canvasBackend: '' };
  const bytes = JSON.stringify({ type: 'module', protocol: 1, source, nodeMajor: 24, dependencyDigest: 'c'.repeat(64), profile, base: '/', audience: 'internal', files });
  await writeFile(join(app, 'package.json'), bytes);
  const zip = join(root, 'application.zip');
  execFileSync('python3', ['-c', 'import pathlib,sys,zipfile\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w") as z:\n for p in r.rglob("*"):\n  if p.is_file(): z.write(p,p.relative_to(r))', app, zip]);
  const archive = await readFile(zip);
  const f = fixture(); f.expected.digest = hash(bytes); f.artifact.name = `roadmap-application-${hash(bytes)}`;
  f.artifact.digest = `sha256:${hash(archive)}`; f.artifact.size_in_bytes = archive.length;
  const provenance = validateArtifactProvenance(f);
  const originalFetch = globalThis.fetch; t.after(() => globalThis.fetch = originalFetch);
  let corrupt = false;
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'storage.example.test') {
      assert.equal(options.headers, undefined); assert.equal(options.redirect, 'error');
      return new Response(corrupt ? Buffer.alloc(archive.length) : archive);
    }
    assert.equal(parsed.hostname, 'api.github.com');
    assert.equal(options.headers.Authorization, 'Bearer private-test-token');
    if (parsed.pathname.endsWith('/zip')) return new Response(null, { status: 302, headers: { location: 'https://storage.example.test/private?signature=do-not-log' } });
    if (parsed.pathname.endsWith('/deploy.yml')) return Response.json(f.workflow);
    if (parsed.pathname.endsWith('/artifacts')) return Response.json({ artifacts: [f.artifact] });
    if (parsed.pathname.endsWith('/runs/20')) return Response.json(f.run);
    throw new Error('unexpected API request');
  };
  const installed = await downloadApplicationArtifact(provenance, 'private-test-token', join(root, 'installed'), profile);
  assert.equal(installed.digest, hash(bytes));
  assert.equal(await readFile(join(installed.directory, 'private/renderer.mjs'), 'utf8'), 'fixture');
  corrupt = true;
  await assert.rejects(downloadApplicationArtifact(provenance, 'private-test-token', join(root, 'corrupt'), profile), /UNTRUSTED/);
});
