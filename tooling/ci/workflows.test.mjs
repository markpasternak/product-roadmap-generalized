import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// Use the YAML parser already installed with the locked site tooling.
const { parse } = createRequire(new URL('../../site/package.json', import.meta.url))('yaml');
const workflow = (name) => parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const checks = workflow('checks');
const deploy = workflow('deploy');
const guarded = "steps.changes.outputs.build_required != 'false'";

test('check build starts independently and retains audits and CI regression tests', () => {
  const build = checks.jobs.build;
  assert.equal(build.needs, undefined);
  const classifier = build.steps.find((step) => step.id === 'changes');
  assert.equal(classifier.run, 'node tooling/ci/changes.mjs');
  assert.equal(classifier.env.GH_TOKEN, '${{ github.token }}');
  for (const command of [
    'npm --prefix site audit --audit-level=moderate',
    'node --test tooling/ci/*.test.mjs site/scripts/build-item-history.test.mjs',
  ]) {
    assert.ok(build.steps.some((step) => step.run === command && !step.if));
  }
});

test('only artifact work is conditional and missing classifier output builds by default', () => {
  const commands = [
    'python3 tooling/validate_items.py',
    'npm --prefix site run build',
    'node site/scripts/check-document-links.mjs',
    'node site/scripts/check-item-history.mjs',
  ];
  if (checks.jobs.security) commands.push('node site/scripts/check-demo.mjs');
  for (const command of commands) {
    assert.equal(checks.jobs.build.steps.find((step) => step.run === command)?.if, guarded, command);
  }
});

test('deployment owns unconditional validation and artifact checks before upload', () => {
  assert.deepEqual(deploy.on.push.branches, ['main']);
  const steps = deploy.jobs.deploy.steps;
  const upload = steps.findIndex((step) => step.name === 'Deploy to canvas-drop');
  const commands = [
    'python3 tooling/validate_items.py',
    'npm run build',
    'node site/scripts/check-document-links.mjs',
    'node site/scripts/check-item-history.mjs',
  ];
  if (checks.jobs.security) commands.push('node site/scripts/check-demo.mjs');
  for (const command of commands) {
    const index = steps.findIndex((step) => step.run === command);
    assert.ok(index >= 0 && index < upload, command);
    assert.equal(steps[index].if, undefined, command);
  }
  assert.ok(steps.findIndex((step) => step.run === 'node site/scripts/verify-deploy.mjs') > upload);
  assert.ok(!existsSync(new URL('../../.github/workflows/validate.yml', import.meta.url)));
});

test('aggregate verdict still requires the build and generalized security remains mandatory', () => {
  assert.ok(checks.jobs.check.needs.includes('build'));
  if (checks.jobs.security) {
    assert.equal(checks.jobs.security.if, undefined);
    assert.ok(checks.jobs.check.needs.includes('security'));
    const gate = deploy.jobs.deploy.steps.find((step) => step.run === 'node tooling/ci/changes.mjs wait');
    assert.ok(gate);
    assert.equal(gate.if, undefined);
  }
});
