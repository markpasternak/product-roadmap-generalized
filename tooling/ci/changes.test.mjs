import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentOnly, classifyChanges, checkRunState, requiresApplicationBuild } from './changes.mjs';

test('only confirmed content pushes with an automatic deployment can omit the check build', () => {
  for (const event of ['push', 'pull_request', 'workflow_dispatch', undefined]) {
    for (const ref of ['refs/heads/main', 'refs/heads/feature', 'refs/pull/1/merge', undefined]) {
      for (const content of [true, false, undefined, 'true']) {
        assert.equal(
          requiresApplicationBuild(content, event, ref),
          !(content === true && event === 'push' && ref === 'refs/heads/main'),
          JSON.stringify({ content, event, ref }),
        );
      }
    }
  }
});

test('classifies files, not editor or author', () => {
  assert.equal(contentOnly(['content/items/studio/X.md']), true);
  assert.equal(
    contentOnly([
      'content/items/X.md',
      'content/assets/ast_x/asset.json',
      'content/assets/ast_x/rev_x/diagram.png',
      '.roadmap/publications/abc123.json',
    ]),
    true,
  );
  for (const files of [
    [],
    ['site/src/Board.vue'],
    ['content/items/X.md', 'edit-service/main.go'],
    ['presentations/demo/index.html'],
    ['unknown'],
    ['content/assets/ast_x/script.mjs'],
    ['content/assets/ast_x/rev_x/page.html'],
    ['content/items/../../site/package.json'],
  ])
    assert.equal(contentOnly(files), false);
});
test('uncertain ancestry and missing baselines require full checks', () => {
  assert.equal(
    classifyChanges({
      base: null,
      head: 'new',
      isAncestor: () => true,
      changed: () => ['content/items/X.md'],
    }).contentOnly,
    false,
  );
  assert.equal(
    classifyChanges({
      base: 'old',
      head: 'new',
      isAncestor: () => false,
      changed: () => ['content/items/X.md'],
    }).contentOnly,
    false,
  );
});
test('includes pending code since last successful deployment, not just the last push', () => {
  const result = classifyChanges({
    base: 'last-deployed',
    head: 'new-content',
    isAncestor: () => true,
    changed: (base, head) => {
      assert.equal(base, 'last-deployed');
      assert.equal(head, 'new-content');
      return ['site/src/Board.vue', 'content/items/X.md'];
    },
  });
  assert.equal(result.contentOnly, false);
});
test('deployment gate requires the exact commit and the newest check attempt', () => {
  const run = {
    id: 1,
    head_sha: 'wanted',
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  };
  assert.equal(checkRunState([run], 'wanted'), 'success');
  assert.equal(checkRunState([run], 'other'), 'pending');
  assert.equal(
    checkRunState(
      [run, { ...run, id: 2, status: 'in_progress', conclusion: null }],
      'wanted',
    ),
    'pending',
  );
  assert.equal(
    checkRunState([{ ...run, conclusion: 'failure' }], 'wanted'),
    'failure',
  );
  assert.equal(
    checkRunState([{ ...run, event: 'pull_request' }], 'wanted'),
    'pending',
  );
  for (const conclusion of [
    'cancelled',
    'timed_out',
    'skipped',
    'action_required',
    null,
  ]) {
    assert.equal(checkRunState([{ ...run, conclusion }], 'wanted'), 'failure');
  }
  assert.equal(checkRunState([], 'wanted'), 'pending');
  assert.equal(
    checkRunState([{ ...run, head_branch: 'feature' }], 'wanted'),
    'pending',
  );
});
