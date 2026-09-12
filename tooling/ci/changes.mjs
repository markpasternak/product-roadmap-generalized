import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function contentOnly(paths) {
  return (
    paths.length > 0 &&
    paths.every((path) => {
      if (
        path.split('/').some((part) => !part || part === '.' || part === '..')
      )
        return false;
      return (
        /^content\/(items|prds|technical-design|research)\/.+\.md$/.test(
          path,
        ) ||
        /^content\/assets\/ast_[a-z0-9_-]+\/asset\.json$/.test(path) ||
        /^content\/assets\/ast_[a-z0-9_-]+\/rev_[a-z0-9_-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(png|jpe?g|gif|webp|pdf|mp4|webm|txt|csv|md|json|zip|docx|pptx|xlsx)$/i.test(
          path,
        ) ||
        /^\.roadmap\/publications\/[a-f0-9]+\.json$/.test(path)
      );
    })
  );
}
export function classifyChanges({ base, head, isAncestor, changed }) {
  if (!base || !isAncestor(base, head))
    return { contentOnly: false, reason: 'No trusted ancestor baseline' };
  const paths = changed(base, head);
  return {
    contentOnly: contentOnly(paths),
    reason: `${paths.length} paths since baseline`,
    base,
  };
}
// Only main pushes have a production build in deploy.yml. PRs and manual
// checks must validate their own build, even when the files are content-only.
export function requiresApplicationBuild(content, event, ref) {
  return !(content === true && event === 'push' && ref === 'refs/heads/main');
}
const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
export async function github(path) {
  const res = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw Error(`GitHub lookup failed: HTTP ${res.status}`);
  return res.json();
}
export async function classifyEvent(event, name) {
  const head = git('rev-parse', 'HEAD');
  let base;
  if (name === 'pull_request')
    base = git('merge-base', event.pull_request.base.sha, head);
  else if (name === 'push') {
    // A later content push must not bypass checks for an earlier cancelled code release.
    const data = await github(
      'actions/workflows/deploy.yml/runs?branch=main&status=success&per_page=1',
    );
    base = data.workflow_runs?.[0]?.head_sha;
  }
  return classifyChanges({
    base,
    head,
    isAncestor: (a, b) => {
      try {
        git('merge-base', '--is-ancestor', a, b);
        return true;
      } catch {
        return false;
      }
    },
    changed: (a, b) =>
      git('diff', '--no-renames', '--name-only', '-z', a, b, '--')
        .split('\0')
        .filter(Boolean),
  });
}
export function checkRunState(runs, sha) {
  const run = runs
    .filter(
      (r) =>
        r.head_sha === sha &&
        r.head_branch === 'main' &&
        ['push', 'workflow_dispatch'].includes(r.event),
    )
    .sort((a, b) => b.id - a.id)[0];
  if (!run || run.status !== 'completed') return 'pending';
  return run.conclusion === 'success' ? 'success' : 'failure';
}
export async function waitForChecks() {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const data = await github(
      `actions/workflows/checks.yml/runs?head_sha=${process.env.GITHUB_SHA}&branch=main&per_page=30`,
    );
    const state = checkRunState(
      data.workflow_runs ?? [],
      process.env.GITHUB_SHA,
    );
    if (state === 'success') {
      console.log('Application checks passed for this exact commit.');
      return;
    }
    if (state === 'failure')
      throw Error('Application checks did not pass; refusing deployment.');
    console.log('Waiting for application checks for this commit…');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw Error('Timed out waiting for application checks; refusing deployment.');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === 'wait') await waitForChecks();
  else {
    let result;
    try {
      result = await classifyEvent(
        JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
        process.env.GITHUB_EVENT_NAME,
      );
    } catch (error) {
      result = { contentOnly: false, reason: error.message };
    }
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `content_only=${result.contentOnly}\nbuild_required=${requiresApplicationBuild(result.contentOnly, process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF)}\n`,
      );
  }
}
