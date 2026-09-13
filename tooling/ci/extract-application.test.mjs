import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('artifact extraction rejects links, traversal, ambiguous paths and extra roots before writing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-artifact-extract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const extractor = fileURLToPath(new URL('../deploy/extract-application.py', import.meta.url));
  for (const scenario of ['valid', '../escape', '/absolute', 'private/../escape', 'private\\escape', 'secret.env', 'symlink', 'duplicate', 'case-collision', 'directory']) {
    const directory = join(root, `output-${scenario.replaceAll(/[^a-z0-9]/g, '-')}`);
    await mkdir(directory);
    const archive = join(root, 'fixture.zip');
    execFileSync('python3', ['-c', `
import sys, zipfile, stat
scenario = sys.argv[2]
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("package.json", "{}")
    z.writestr("private/renderer.mjs", "fixture")
    if scenario == "symlink":
        entry = zipfile.ZipInfo("private/link"); entry.create_system = 3; entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        z.writestr(entry, "renderer.mjs")
    elif scenario == "duplicate": z.writestr("private/renderer.mjs", "different")
    elif scenario == "case-collision": z.writestr("private/Renderer.mjs", "different")
    elif scenario == "directory": z.writestr("private/subdir/", "")
    elif scenario != "valid": z.writestr(scenario, "bad")
`, archive, scenario], { stdio: 'pipe' });
    const run = () => execFileSync('python3', [extractor, archive, directory], { stdio: 'pipe' });
    if (scenario === 'valid') { run(); assert.equal(await readFile(join(directory, 'private/renderer.mjs'), 'utf8'), 'fixture'); }
    else assert.throws(run);
  }
});
