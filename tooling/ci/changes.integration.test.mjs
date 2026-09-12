import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    // Exercise the real CLI output consumed by workflow step conditions, not
    // just the policy helper. GitHub lookup failure must restore the full build.
    const cliOutput = (event, name, lookupFails = false) => {
      const eventPath = join(root, 'event.json');
      const outputPath = join(root, 'outputs');
      writeFileSync(eventPath, JSON.stringify(event));
      writeFileSync(outputPath, '');
      execFileSync(process.execPath, ['--input-type=module', '-e', `
        globalThis.fetch = async () => ${lookupFails ? 'new Response("unavailable", {status: 503})' : `new Response(JSON.stringify({workflow_runs: [{head_sha: ${JSON.stringify(deployed)}}]}))`};
        process.argv[1] = ${JSON.stringify(fileURLToPath(moduleUrl))};
        await import(${JSON.stringify(moduleUrl)});
      `], {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: name,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
          GITHUB_REF: 'refs/heads/main',
        },
      });
      return readFileSync(outputPath, 'utf8');
    };
    assert.equal(cliOutput({}, 'push'), 'content_only=true\nbuild_required=false\n');
    assert.equal(cliOutput({ pull_request: { base: { sha: deployed } } }, 'pull_request'), 'content_only=true\nbuild_required=true\n');
    assert.equal(cliOutput({}, 'workflow_dispatch'), 'content_only=false\nbuild_required=true\n');
    assert.equal(cliOutput({}, 'push', true), 'content_only=false\nbuild_required=true\n');
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
