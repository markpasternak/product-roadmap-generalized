import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('actual Git comparisons keep pending code in scope after a later content push', () => {
  const root = mkdtempSync(join(tmpdir(), 'roadmap-ci-test-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const moduleUrl = new URL('./changes.mjs', import.meta.url).href;
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.test');
    mkdirSync(join(root, 'content/items'), { recursive: true });
    writeFileSync(join(root, 'content/items/A.md'), 'First');
    git('add', '.');
    git('commit', '-qm', 'Deployed baseline');
    const deployed = git('rev-parse', 'HEAD');
    const classify = (event, name, baseline = deployed) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `
      import {classifyEvent} from ${JSON.stringify(moduleUrl)};
      globalThis.fetch = async () => new Response(JSON.stringify({workflow_runs: [{head_sha: ${JSON.stringify(baseline)}}]}));
      console.log(JSON.stringify(await classifyEvent(${JSON.stringify(event)}, ${JSON.stringify(name)})));
    `,
          ],
          { cwd: root, encoding: 'utf8' },
        ),
      );
    writeFileSync(join(root, 'content/items/A.md'), 'Content edit');
    git('add', '.');
    git('commit', '-qm', 'UI or file edit');
    assert.equal(classify({}, 'push').contentOnly, true);
    assert.equal(classify({}, 'push', null).contentOnly, false);
    assert.equal(classify({}, 'workflow_dispatch').contentOnly, false);
    assert.equal(
      classify({ pull_request: { base: { sha: deployed } } }, 'pull_request')
        .contentOnly,
      true,
    );
    writeFileSync(join(root, 'code.mjs'), 'export const changed = true;');
    git('add', '.');
    git('commit', '-qm', 'Code release that never deployed');
    writeFileSync(join(root, 'content/items/A.md'), 'Later content edit');
    git('add', '.');
    git('commit', '-qm', 'Later content');
    assert.equal(classify({}, 'push').contentOnly, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
