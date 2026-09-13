// Run after the full build: reuse its internal package, then compile a public
// package so the integration test also exercises filtering and a non-root base.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './application-package.mjs';

const site = fileURLToPath(new URL('../', import.meta.url));
const receipt = JSON.parse(await readFile(join(site, '.cache/full-build.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(receipt.application, 'package.json'), 'utf8'));
if (manifest.audience !== 'internal' || !receipt.packageDigest) throw new Error('Run an internal full build first');

function test(application, digest) {
  execFileSync(process.execPath, ['--test', 'scripts/content-output.integration.test.mjs'], {
    cwd: site, stdio: 'inherit',
    env: { ...process.env, CONTENT_TEST_APPLICATION: application, CONTENT_TEST_PACKAGE_DIGEST: digest },
  });
}

test(receipt.application, receipt.packageDigest);
const temporary = await mkdtemp(join(tmpdir(), 'roadmap-content-test-'));
try {
  const application = join(temporary, 'application');
  execFileSync(process.execPath, ['scripts/build-application.mjs', application], {
    cwd: site, stdio: 'inherit',
    env: { ...process.env, SITE_AUDIENCE: 'public', SITE_BASE: '/roadmap/' },
  });
  test(application, sha256(await readFile(join(application, 'package.json'))));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
